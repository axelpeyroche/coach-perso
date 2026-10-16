"""
Analyses avancées du carnet : forme / fatigue (CTL, ATL, TSB), répartition des zones de FC,
indice de récupération (VFC, FC repos, sommeil), analyses de course (meilleurs efforts tirés
des tracés GPS, dérive cardiaque, prédictions, cadence), évolution de la VMA, respect du plan, comparaison d'une
année sur l'autre et corrélations entre les données.

Tout est recalculé à la demande à partir du carnet ; seuls les meilleurs efforts d'une séance
(coûteux à tirer du tracé) sont mémorisés dans ses `details`.
"""
from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import date, datetime, timedelta
from statistics import mean, median, pstdev
from typing import Iterable, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

import carnet_service as cs
from models import Activite, MesureSante, Objectif, PoidsUtilisateur, SeancePrevue, TraceGPS, Utilisateur

CTL_JOURS = 42   # forme de fond (charge chronique)
ATL_JOURS = 7    # fatigue (charge aiguë)
REF_RECUP_JOURS = 60
REF_RECUP_MIN = 10       # mesures nécessaires pour établir la référence personnelle
DERIVE_MIN_MIN = 40      # durée minimale d'une sortie pour mesurer la dérive cardiaque
CORREL_MIN = 8           # points minimum pour calculer une corrélation
EFFORTS = [("1 km", 1000), ("5 km", 5000), ("10 km", 10000), ("Semi", 21097.5)]
DUREES_EFFORTS = [1, 3, 5, 10, 20, 30, 60]    # minutes : meilleure distance couverte sur chaque durée
DUREES_CS = (3, 5, 10, 20)                    # durées retenues pour l'allure critique
VERSION_EFFORTS = 2
SPORTS_EFFORTS = cs.SPORTS_PIED | {"randonnee"}
DURABILITE_MIN_MIN = 75  # durée minimale d'une sortie pour mesurer la durabilité
BESOIN_SOMMEIL_H = 8.0
ALLURE_MIN_PLAUSIBLE = 150   # s/km : plus rapide = saut GPS, pas un effort réel
PREDICTIONS = [("5 km", 5.0), ("10 km", 10.0), ("Semi", 21.0975), ("Marathon", 42.195)]


def _moy(xs) -> Optional[float]:
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def _r(x, n=1):
    return None if x is None else round(x, n)


# ---------------------------------------------------------------------------
# Forme / fatigue
# ---------------------------------------------------------------------------

def charges_quotidiennes(acts: Iterable[Activite]) -> dict[date, float]:
    par_jour: dict[date, float] = defaultdict(float)
    for a in acts:
        par_jour[a.debut.date()] += cs.charge(a)
    return par_jour


def courbe_forme(charges: dict[date, float], jusqu_a: date) -> list[dict]:
    """Moyennes exponentielles de la charge quotidienne (modèle de Banister, comme
    TrainingPeaks/Intervals) : CTL sur 42 j, ATL sur 7 j. TSB = CTL − ATL de la veille."""
    if not charges:
        return []
    j = min(charges)
    ctl = atl = 0.0
    out = []
    while j <= jusqu_a:
        tsb = ctl - atl
        c = charges.get(j, 0.0)
        ctl += (c - ctl) / CTL_JOURS
        atl += (c - atl) / ATL_JOURS
        out.append({"jour": j.isoformat(), "charge": round(c), "ctl": round(ctl, 1), "atl": round(atl, 1),
                    "tsb": round(tsb, 1)})
        j += timedelta(days=1)
    return out


def etat_forme(ctl: float, tsb: float) -> dict:
    """Interprétation du TSB rapporté à la CTL (indépendant de l'unité de charge)."""
    if ctl < 5:
        return {"code": "neutre", "label": "Pas assez d'historique"}
    r = tsb / ctl
    if r > 0.25:
        return {"code": "frais_plus", "label": "Très frais : la forme de fond s'érode"}
    if r > 0.05:
        return {"code": "frais", "label": "Frais : idéal avant une course"}
    if r > -0.10:
        return {"code": "neutre", "label": "Équilibré"}
    if r > -0.30:
        return {"code": "productif", "label": "Fatigue productive : tu progresses"}
    return {"code": "surcharge", "label": "Surcharge : risque de blessure, allège"}


def _forme_fatigue(acts: list[Activite], objectifs: list[Objectif], auj: date) -> dict:
    serie = courbe_forme(charges_quotidiennes(acts), auj)
    if not serie:
        return {"points": [], "actuel": None, "reperes": []}
    der = serie[-1]
    sem = serie[-8] if len(serie) >= 8 else serie[0]
    debut = (auj - timedelta(days=365)).isoformat()
    points = [p for p in serie if p["jour"] > debut]
    reperes = [{"jour": o.date_cible.isoformat(), "titre": o.titre} for o in objectifs
               if o.type == "course" and o.date_cible and o.date_cible.isoformat() > debut]
    return {
        "points": points,
        "actuel": {**der, "etat": etat_forme(der["ctl"], der["tsb"]),
                   "rampe_7j": round(der["ctl"] - sem["ctl"], 1),
                   "rampe_pct": round((der["ctl"] - sem["ctl"]) / sem["ctl"] * 100) if sem["ctl"] >= 5 else None},
        "reperes": reperes,
    }


# ---------------------------------------------------------------------------
# Zones de FC par semaine (polarisation 80/20)
# ---------------------------------------------------------------------------

def _zones_hebdo(acts: list[Activite], user: Utilisateur, auj: date, semaines: int = 26) -> dict:
    lundi0 = cs._lundi(auj) - timedelta(weeks=semaines - 1)
    par_sem = {lundi0 + timedelta(weeks=i): {"z": [0.0] * 5, "total": 0.0} for i in range(semaines)}
    for a in acts:
        w = cs._lundi(a.debut.date())
        if w not in par_sem or not a.duree_sec:
            continue
        par_sem[w]["total"] += a.duree_sec / 60
        zones = cs._details_dict(a).get("zones_fc")
        if isinstance(zones, list) and len(zones) == 5:
            for i, z in enumerate(zones):
                par_sem[w]["z"][i] += float(z.get("min_passees") or 0)
    lignes = []
    for w, s in par_sem.items():
        couvert = sum(s["z"])
        pct = lambda m: round(m / couvert * 100) if couvert else None
        lignes.append({
            "semaine": w.isoformat(), "zones_min": [round(m) for m in s["z"]],
            "bas_pct": pct(s["z"][0] + s["z"][1]), "modere_pct": pct(s["z"][2]), "haut_pct": pct(s["z"][3] + s["z"][4]),
            "couvert_min": round(couvert), "total_min": round(s["total"]),
        })

    def bilan(n):
        z = [sum(l["zones_min"][i] for l in lignes[-n:]) for i in range(5)]
        t = sum(z)
        return {"bas_pct": round((z[0] + z[1]) / t * 100) if t else None,
                "modere_pct": round(z[2] / t * 100) if t else None,
                "haut_pct": round((z[3] + z[4]) / t * 100) if t else None,
                "zones_min": z, "couvert_min": t,
                "total_min": sum(l["total_min"] for l in lignes[-n:])}

    bornes = None
    if user.fc_max and user.fc_repos and user.fc_max > user.fc_repos:
        res = user.fc_max - user.fc_repos
        b = [round(user.fc_repos + p * res) for p in (0.6, 0.7, 0.8, 0.9)]
        lim = [None] + b + [None]
        bornes = [{"zone": i + 1, "min": lim[i], "max": lim[i + 1]} for i in range(5)]
    return {"semaines": lignes, "bilan_4s": bilan(4), "bilan_12s": bilan(12), "bornes": bornes}


# ---------------------------------------------------------------------------
# Récupération : VFC, FC repos, sommeil
# ---------------------------------------------------------------------------

STATUTS_RECUP = {
    "vert": "Bien récupéré : feu vert pour la séance prévue",
    "orange": "Récupération incomplète : garde l'intensité sous contrôle",
    "rouge": "Signes de fatigue marqués : séance facile ou repos",
}


def _statut(score: Optional[float]) -> Optional[str]:
    if score is None:
        return None
    return "vert" if score >= -0.5 else "orange" if score >= -1.5 else "rouge"


def _recuperation(mesures: dict[str, dict[date, float]], auj: date, jours: int = 90) -> dict:
    vfc, fcr, som = mesures.get("vfc", {}), mesures.get("fc_repos", {}), mesures.get("sommeil", {})
    nuit = {t: mesures.get(t, {}) for t in ("fc_sommeil", "score_sommeil", "spo2", "respiration",
                                             "sommeil_profond", "sommeil_leger", "sommeil_paradoxal", "sommeil_eveil")}

    def reference(serie: dict[date, float], j: date):
        vals = [v for d, v in serie.items() if j - timedelta(days=REF_RECUP_JOURS) <= d < j]
        if len(vals) < REF_RECUP_MIN:
            return None, None
        sd = pstdev(vals)
        return mean(vals), (sd if sd > 0 else None)

    pts = []
    for k in range(jours - 1, -1, -1):
        j = auj - timedelta(days=k)
        p = {"jour": j.isoformat(), "vfc": vfc.get(j), "fc_repos": fcr.get(j), "sommeil": som.get(j),
             **{t: serie.get(j) for t, serie in nuit.items()}}
        fen7 = [vfc[d] for d in vfc if j - timedelta(days=6) <= d <= j]
        p["vfc_moy7"] = _r(_moy(fen7))
        zs = []
        m, sd = reference(vfc, j)
        if m is not None:
            p["vfc_ref"], p["vfc_bas"], p["vfc_haut"] = _r(m), _r(m - (sd or 0)), _r(m + (sd or 0))
            if p["vfc"] is not None and sd:
                zs.append((p["vfc"] - m) / sd)
        m, sd = reference(fcr, j)
        if m is not None:
            p["fc_ref"] = _r(m)
            if p["fc_repos"] is not None and sd:
                zs.append(-(p["fc_repos"] - m) / sd)
        p["score"] = _r(_moy(zs), 2) if zs else None
        p["statut"] = _statut(p["score"])
        pts.append(p)

    actuel = next((p for p in reversed(pts) if p["score"] is not None
                   and date.fromisoformat(p["jour"]) >= auj - timedelta(days=2)), None)
    nuits = [som[d] for d in som if d > auj - timedelta(days=7)]
    nuits28 = [som[d] for d in som if d > auj - timedelta(days=28)]
    derniere_nuit = max(som) if som else None

    def resume(serie: dict[date, float]) -> dict:
        d = max(serie) if serie else None
        return {"derniere": {"jour": d.isoformat(), "valeur": serie[d]} if d else None,
                "moy_7j": _r(_moy([v for j, v in serie.items() if j > auj - timedelta(days=7)])),
                "moy_28j": _r(_moy([v for j, v in serie.items() if j > auj - timedelta(days=28)]))}
    return {
        "points": pts,
        "actuel": {"jour": actuel["jour"], "score": actuel["score"], "statut": actuel["statut"],
                   "message": STATUTS_RECUP[actuel["statut"]], "vfc": actuel["vfc"], "vfc_ref": actuel.get("vfc_ref"),
                   "fc_repos": actuel["fc_repos"], "fc_ref": actuel.get("fc_ref")} if actuel else None,
        "sommeil": {
            "derniere": {"jour": derniere_nuit.isoformat(), "heures": som[derniere_nuit]} if derniere_nuit else None,
            "moy_7j": _r(_moy(nuits), 2), "moy_28j": _r(_moy(nuits28), 2),
            "nuits_courtes_7j": sum(1 for h in nuits if h < 7), "nb_7j": len(nuits),
            **{t: resume(serie) for t, serie in nuit.items()},
        },
    }


# ---------------------------------------------------------------------------
# Course à pied : meilleurs efforts, dérive cardiaque, prédictions, cadence
# ---------------------------------------------------------------------------

def meilleurs_efforts(points: list[list]) -> dict:
    """Meilleur temps sur chaque distance et meilleure distance sur chaque durée, par fenêtre
    glissante sur le tracé ([[lat, lon, alt, secondes], …]), plus la vitesse ascensionnelle
    (VAM) des montées. Le temps est ramené à la distance exacte."""
    points = [p for p in points if len(p) >= 4 and isinstance(p[3], (int, float))]
    if len(points) < 2:
        return {}
    cumul, temps = [0.0], [points[0][3]]
    for a, b in zip(points, points[1:]):
        cumul.append(cumul[-1] + cs._distance_m(a, b))
        temps.append(b[3])
    res = {}
    for label, d in EFFORTS:
        if cumul[-1] < d:
            continue
        meilleur, i = None, 0
        for j in range(1, len(cumul)):
            while i + 1 < j and cumul[j] - cumul[i + 1] >= d:
                i += 1
            dist = cumul[j] - cumul[i]
            if dist >= d and temps[j] > temps[i]:
                t = (temps[j] - temps[i]) * d / dist
                if t / (d / 1000) >= ALLURE_MIN_PLAUSIBLE and (meilleur is None or t < meilleur):
                    meilleur = t
        if meilleur:
            res[label] = int(round(meilleur))

    # Meilleure distance sur chaque durée (fenêtre de temps glissante)
    vmax = 1000 / ALLURE_MIN_PLAUSIBLE
    duree = temps[-1] - temps[0]
    par_duree = {}
    for m in DUREES_EFFORTS:
        d_s = m * 60
        if duree < d_s:
            continue
        meilleur, i = None, 0
        for j in range(1, len(temps)):
            while i + 1 < j and temps[j] - temps[i + 1] >= d_s:
                i += 1
            dt = temps[j] - temps[i]
            if dt >= d_s:
                dist = (cumul[j] - cumul[i]) * d_s / dt
                if dist / d_s <= vmax and (meilleur is None or dist > meilleur):
                    meilleur = dist
        if meilleur:
            par_duree[str(m)] = int(round(meilleur))
    if par_duree:
        res["d"] = par_duree

    # VAM : tronçons de ~200 m dont la pente dépasse 5 %
    gain = t_montee = 0.0
    k = 0
    for j in range(1, len(points)):
        if cumul[j] - cumul[k] < 200:
            continue
        a0, a1 = points[k][2], points[j][2]
        if isinstance(a0, (int, float)) and isinstance(a1, (int, float)):
            dz = a1 - a0
            if dz / (cumul[j] - cumul[k]) >= 0.05 and temps[j] > temps[k]:
                gain += dz
                t_montee += temps[j] - temps[k]
        k = j
    if gain >= 50 and t_montee > 0:
        res["vam"] = int(round(gain / t_montee * 3600))
        res["montee_m"] = int(round(gain))
    return res


def maj_efforts(db: Session, user_id: int, acts: list[Activite]) -> int:
    """Calcule (une fois par tracé) les meilleurs efforts des séances de course. Retourne le nombre calculé."""
    pied = {a.id: a for a in acts if a.sport in SPORTS_EFFORTS}
    if not pied:
        return 0
    traces = dict(db.query(TraceGPS.activite_id, TraceGPS.id)
                  .filter(TraceGPS.utilisateur_id == user_id, TraceGPS.activite_id.in_(list(pied))).all())
    a_faire = [tid for aid, tid in traces.items()
               if (cs._details_dict(pied[aid]).get("efforts") or {}).get("trace") != tid
               or (cs._details_dict(pied[aid]).get("efforts") or {}).get("v") != VERSION_EFFORTS]
    n = 0
    for i in range(0, len(a_faire), 50):
        for t in db.query(TraceGPS).filter(TraceGPS.id.in_(a_faire[i:i + 50])):
            try:
                pts = json.loads(t.points)
            except ValueError:
                pts = []
            cs.fusionner_details(pied[t.activite_id],
                                 {"efforts": {"v": VERSION_EFFORTS, "trace": t.id, **meilleurs_efforts(pts)}},
                                 ecraser=True)
            n += 1
    if n:
        db.flush()
    return n


def derive_cardiaque(temps: list, fc: list, distance: list, echauffement_s: int = 600) -> Optional[float]:
    """Découplage allure/FC (Pa:Hr) en % : efficacité (m par battement) de la 1re moitié
    comparée à la 2e, échauffement exclu. > 5 % = endurance de base à travailler."""
    idx = [i for i in range(min(len(temps), len(fc), len(distance)))
           if temps[i] is not None and fc[i] and distance[i] is not None and temps[i] >= echauffement_s]
    if len(idx) < 20:
        return None
    t0, t1 = temps[idx[0]], temps[idx[-1]]
    if t1 - t0 < 15 * 60:
        return None
    milieu = t0 + (t1 - t0) / 2
    moitie = lambda sel: sel and (distance[sel[-1]] - distance[sel[0]], _moy(fc[i] for i in sel), temps[sel[-1]] - temps[sel[0]])
    m1 = moitie([i for i in idx if temps[i] <= milieu])
    m2 = moitie([i for i in idx if temps[i] >= milieu])
    if not m1 or not m2 or m1[2] <= 0 or m2[2] <= 0 or m1[0] <= 0 or m2[0] <= 0:
        return None
    ef1 = m1[0] / m1[2] / m1[1]
    ef2 = m2[0] / m2[2] / m2[1]
    return round((ef1 - ef2) / ef1 * 100, 1)


def durabilite(temps: list, fc: list, distance: list, echauffement_s: int = 600) -> Optional[float]:
    """Perte d'efficacité (m par battement) entre le 1er et le dernier quart d'une sortie longue,
    échauffement exclu, en %. Proche de 0 = endurance solide ; > 5 % = le moteur s'use."""
    idx = [i for i in range(min(len(temps), len(fc), len(distance)))
           if temps[i] is not None and fc[i] and distance[i] is not None and temps[i] >= echauffement_s]
    if len(idx) < 40:
        return None
    t0, t1 = temps[idx[0]], temps[idx[-1]]
    if t1 - t0 < 40 * 60:
        return None
    q = (t1 - t0) / 4

    def ef(sel):
        if len(sel) < 5:
            return None
        d, t, f = distance[sel[-1]] - distance[sel[0]], temps[sel[-1]] - temps[sel[0]], _moy(fc[i] for i in sel)
        return d / t / f if d > 0 and t > 0 and f else None
    e1 = ef([i for i in idx if temps[i] <= t0 + q])
    e4 = ef([i for i in idx if temps[i] >= t1 - q])
    if not e1 or not e4:
        return None
    return round((e1 - e4) / e1 * 100, 1)


def _course(acts: list[Activite], auj: date) -> dict:
    pied = [a for a in acts if a.sport in cs.SPORTS_PIED]

    # Meilleurs efforts : records, top 5 et meilleur de chaque mois
    records, top, mensuel = {}, defaultdict(list), defaultdict(dict)
    for a in pied:
        eff = cs._details_dict(a).get("efforts") or {}
        mois = a.debut.strftime("%Y-%m")
        for label, d in EFFORTS:
            t = eff.get(label)
            if not t:
                continue
            e = {"temps_sec": t, "temps_str": cs.fmt_duree(t), "allure_str": cs.fmt_allure(t / (d / 1000)),
                 "date": a.debut.date().isoformat(), "activite_id": a.id, "titre": a.titre, "sport": a.sport}
            top[label].append(e)
            if label not in mensuel[mois] or t < mensuel[mois][label]:
                mensuel[mois][label] = t
    for label, _ in EFFORTS:
        top[label].sort(key=lambda e: e["temps_sec"])
        if top[label]:
            records[label] = top[label][0]
    debut_mois = (auj.replace(day=1) - timedelta(days=730)).strftime("%Y-%m")
    evolution = [{"mois": m, **v} for m, v in sorted(mensuel.items()) if m >= debut_mois]

    # Dérive cardiaque des sorties longues (calculée à la synchro Intervals)
    derives = []
    for a in pied:
        d = cs._details_dict(a).get("derive_fc")
        if d is not None and a.duree_sec and a.duree_sec >= DERIVE_MIN_MIN * 60:
            derives.append({"date": a.debut.date().isoformat(), "derive_pct": d, "duree_min": round(a.duree_sec / 60),
                            "activite_id": a.id, "titre": a.titre, "sport": a.sport})

    # Durabilité des sorties longues (1er quart contre dernier quart, calculée à la synchro Intervals)
    durabilites = []
    for a in pied:
        det = cs._details_dict(a)
        if det.get("durabilite_pct") is not None:
            al = cs.allure_sec_km(a)
            durabilites.append({"date": a.debut.date().isoformat(), "durabilite_pct": det["durabilite_pct"],
                                "derive_pct": det.get("derive_fc"), "duree_min": round((a.duree_sec or 0) / 60),
                                "distance_km": _r(a.distance_km), "allure_sec_km": round(al) if al else None,
                                "dplus_m": a.dplus_m, "activite_id": a.id, "titre": a.titre, "sport": a.sport})

    # Prédictions : chaque semaine, à partir des 90 jours précédents
    predictions = []
    for k in range(51, -1, -1):
        fin = cs._lundi(auj) - timedelta(weeks=k) + timedelta(days=7)
        borne = datetime.combine(fin, datetime.min.time())
        fen = [a for a in pied if a.debut < borne]
        ligne = {"semaine": (fin - timedelta(days=7)).isoformat()}
        for label, dist in PREDICTIONS:
            p = cs.predire_temps(fen, dist, 0, depuis=borne - timedelta(days=90))
            ligne[label] = p["temps_sec"] if p else None
        if any(ligne[l] for l, _ in PREDICTIONS):
            predictions.append(ligne)

    # Cadence et longueur de foulée
    foulees = []
    for a in pied:
        det = cs._details_dict(a)
        cad = det["pas"] / (a.duree_sec / 60) if det.get("pas") and a.duree_sec else None
        if cad is not None and not 120 <= cad <= 230:
            cad = None
        fl = det.get("foulee_m")
        if cad or fl:
            al = cs.allure_sec_km(a)
            foulees.append({"date": a.debut.date().isoformat(), "cadence": _r(cad, 0), "foulee_m": _r(fl, 2),
                            "allure_sec_km": round(al) if al else None, "activite_id": a.id})
    return {"records": records, "top": {k: v[:5] for k, v in top.items()}, "evolution": evolution,
            "distances": [l for l, _ in EFFORTS], "derives": derives[-60:], "predictions": predictions,
            "foulees": foulees[-120:], "durabilites": durabilites[-40:]}


# ---------------------------------------------------------------------------
# VMA : tests demi-Cooper + estimations continues (meilleurs efforts, FC de réserve)
# ---------------------------------------------------------------------------

VMA_FENETRE_EFFORTS = 56   # jours : enveloppe des meilleures performances
VMA_FENETRE_FC = 28        # jours : médiane des estimations par la FC
VMA_CALAGE_JOURS = 28      # jours autour d'un test pour caler les estimations
VMA_SEMAINES = 104
VMA_SAUT_GPS = 1.35       # effort jugé aberrant au-delà de 135 % de la médiane des séances voisines


def fraction_vma(t_min: float) -> float:
    """Fraction de la VMA tenable pendant t minutes (≈ 103 % sur 4 min, 92 % sur 20 min, 81 % sur un semi)."""
    return 1 - 0.0665 * math.log(max(t_min, 3) / 6)


def _est_test_vma(a: Activite) -> bool:
    t = (a.titre or "").lower()
    return bool(a.sport in cs.SPORTS_PIED and ("vma" in t or "cooper" in t) and a.distance_km
                and a.duree_sec and 330 <= a.duree_sec <= 390)


def _tests_anciens(db: Session, user_id: int) -> list[tuple[date, float]]:
    """Tests demi-Cooper enregistrés par l'ancien programme (tables conservées en base, non mappées)."""
    try:
        with db.begin_nested():
            rows = db.execute(text(
                "SELECT j.evalue_le, r.vma_calculee_kmh, r.distance_metres FROM resultats_demi_cooper r "
                "JOIN journaux_evaluation_seance j ON r.evaluation_id = j.id WHERE j.utilisateur_id = :u"),
                {"u": user_id}).fetchall()
    except Exception:
        return []
    out = []
    for jour, vma, dist in rows:
        v = vma or (dist / 100 if dist else None)
        if isinstance(jour, str):
            jour = datetime.fromisoformat(jour)
        if jour and v:
            out.append((jour.date() if isinstance(jour, datetime) else jour, float(v)))
    return out


def _vma(db: Session, user: Utilisateur, acts: list[Activite], mesures: dict[str, dict[date, float]],
         auj: date) -> dict:
    pied = [a for a in acts if a.sport in cs.SPORTS_PIED]

    # 1. Tests : demi-Cooper (6 min) → VMA = distance parcourue × 10
    tests = [{"date": a.debut.date().isoformat(), "vma": round(a.distance_km * 10, 1), "titre": a.titre,
              "activite_id": a.id, "source": "carnet"} for a in pied if _est_test_vma(a)]
    jours_tests = [date.fromisoformat(t["date"]) for t in tests]
    for j, v in _tests_anciens(db, user.id):
        if j <= auj and all(abs((j - d).days) > 14 for d in jours_tests):
            tests.append({"date": j.isoformat(), "vma": round(v, 1), "titre": "Demi-Cooper (ancien programme)",
                          "activite_id": None, "source": "ancien"})
            jours_tests.append(j)
    tests.sort(key=lambda t: t["date"])
    ids_tests = {t["activite_id"] for t in tests}

    # 2. Meilleurs efforts (tracés GPS) : vitesse / fraction de VMA tenable sur cette durée
    par_efforts: list[tuple[date, float, Activite]] = []
    for a in pied:
        if a.id in ids_tests:
            continue
        eff = cs._details_dict(a).get("efforts") or {}
        ests = [d / 1000 / (eff[l] / 3600) / fraction_vma(eff[l] / 60) for l, d in EFFORTS if eff.get(l)]
        if ests:
            par_efforts.append((a.debut.date(), max(ests), a))
    # Écarte les sauts GPS : effort > 35 % au-dessus de la médiane des séances voisines (± 90 jours)
    def plausible(j: date, v: float) -> bool:
        voisins = [x for d, x, _ in par_efforts if abs((d - j).days) <= 90 and d != j]
        return len(voisins) < 5 or v <= VMA_SAUT_GPS * median(voisins)
    par_efforts = [e for e in par_efforts if plausible(e[0], e[1])]

    # 3. FC de réserve : %VO2 de réserve ≈ %FC de réserve (Swain), vitesse corrigée du dénivelé
    fc_max = user.fc_max
    fc_rep = user.fc_repos or (median(mesures["fc_repos"].values()) if mesures.get("fc_repos") else None)
    par_fc: list[tuple[date, float, Activite]] = []
    if fc_max and fc_rep and fc_max > fc_rep:
        for a in pied:
            if (a.id in ids_tests or a.sport != "course" or not a.fc_moyenne_bpm or not a.distance_km
                    or not a.duree_sec or a.duree_sec < 900):
                continue
            h = a.duree_sec / 3600
            if not 6 <= a.distance_km / h <= 25:
                continue
            frac = (a.fc_moyenne_bpm - fc_rep) / (fc_max - fc_rep)
            if 0.5 <= frac <= 0.97:
                par_fc.append((a.debut.date(), (a.distance_km + 8 * (a.dplus_m or 0) / 1000) / h / frac, a))

    def enveloppe(j: date) -> Optional[float]:
        xs = [v for d, v, _ in par_efforts if j - timedelta(days=VMA_FENETRE_EFFORTS) < d <= j]
        return max(xs) if xs else None

    def mediane_fc(j: date, avant: int = VMA_FENETRE_FC, apres: int = 0) -> Optional[float]:
        xs = [v for d, v, _ in par_fc if j - timedelta(days=avant) < d <= j + timedelta(days=apres)]
        return median(xs) if len(xs) >= 3 else None

    # Calage : rapport moyen « VMA du test / estimation » autour des dates de test
    def calage(estimer) -> tuple[float, int]:
        r = [t["vma"] / e for t in tests if (e := estimer(date.fromisoformat(t["date"])))]
        return (min(1.25, max(0.85, mean(r))), len(r)) if r else (1.0, 0)
    k_eff, n_eff = calage(lambda j: enveloppe(j + timedelta(days=VMA_CALAGE_JOURS // 2)))
    k_fc, n_fc = calage(lambda j: mediane_fc(j, VMA_CALAGE_JOURS, VMA_CALAGE_JOURS))

    # 4. Série hebdomadaire : moyenne des estimations calées, lissée sur 3 semaines
    points = []
    debut = min([d for d, _, _ in par_efforts + par_fc] + jours_tests, default=None)
    if debut:
        lundi = max(cs._lundi(debut), cs._lundi(auj) - timedelta(weeks=VMA_SEMAINES - 1))
        while lundi <= auj:
            fin = min(lundi + timedelta(days=6), auj)
            e, f = enveloppe(fin), mediane_fc(fin)
            e, f = e and e * k_eff, f and f * k_fc
            ests = [x for x in (e, f) if x]
            t = [x["vma"] for x in tests if lundi <= date.fromisoformat(x["date"]) <= fin]
            points.append({"semaine": lundi.isoformat(), "vma_efforts": _r(e), "vma_fc": _r(f),
                           "estimee": mean(ests) if ests else None, "test": t[-1] if t else None})
            lundi += timedelta(weeks=1)
    brut = [p["estimee"] for p in points]
    for i, p in enumerate(points):
        xs = [x for x in brut[max(0, i - 2): i + 1] if x]
        p["estimee"] = _r(mean(xs)) if xs and brut[i] else None

    actuelle = next((p for p in reversed(points) if p["estimee"]), None)
    dernier = tests[-1] if tests else None
    premiere = points[0]["semaine"] if points else ""
    seances = sorted(
        [{"date": d.isoformat(), "vma": round(v * k_eff, 1), "source": "effort", "titre": a.titre, "activite_id": a.id}
         for d, v, a in par_efforts] +
        [{"date": d.isoformat(), "vma": round(v * k_fc, 1), "source": "fc", "titre": a.titre, "activite_id": a.id}
         for d, v, a in par_fc], key=lambda s: s["date"])
    return {
        "tests": tests, "points": points,
        "seances": [s for s in seances if s["date"] >= premiere],
        "actuelle": actuelle and {"vma": actuelle["estimee"], "semaine": actuelle["semaine"],
                                  "ecart_dernier_test": _r(actuelle["estimee"] - dernier["vma"]) if dernier else None},
        "dernier_test": dernier,
        "calage": {"efforts": round(k_eff, 3), "fc": round(k_fc, 3), "tests_efforts": n_eff, "tests_fc": n_fc},
        "fc_max": fc_max, "fc_repos": _r(fc_rep, 0),
    }


# ---------------------------------------------------------------------------
# Respect du plan
# ---------------------------------------------------------------------------

def _respect_plan(db: Session, user_id: int, auj: date, semaines: int = 26) -> dict:
    cs.rapprocher_plan(db, user_id, auj)
    debut = cs._lundi(auj) - timedelta(weeks=semaines - 1)
    prevues = (db.query(SeancePrevue)
               .filter(SeancePrevue.utilisateur_id == user_id, SeancePrevue.jour >= debut,
                       SeancePrevue.jour < cs._lundi(auj) + timedelta(days=7)).all())
    ids = [p.activite_id for p in prevues if p.activite_id]
    acts = {a.id: a for a in db.query(Activite).filter(Activite.id.in_(ids))} if ids else {}
    par_sem: dict[date, list] = defaultdict(list)
    for p in prevues:
        par_sem[cs._lundi(p.jour)].append(p)

    def agreger(ps: list[SeancePrevue]) -> dict:
        st = defaultdict(int)
        duree_p = duree_r = 0
        ecarts_rpe = []
        for p in ps:
            s = cs.statut_prevue(p, auj)
            st[s] += 1
            a = acts.get(p.activite_id)
            if a and p.duree_min and a.duree_sec:
                duree_p += p.duree_min
                duree_r += a.duree_sec / 60
            if a and p.rpe_cible is not None and a.rpe is not None:
                ecarts_rpe.append((p.rpe_cible, a.rpe))
        jouees = st["realisee"] + st["sautee"] + st["manquee"]
        return {
            "prevues": len(ps), "realisees": st["realisee"], "sautees": st["sautee"], "manquees": st["manquee"],
            "a_venir": st["a_venir"],
            "taux": round(st["realisee"] / jouees * 100) if jouees else None,
            "duree_prevue_min": round(duree_p), "duree_reelle_min": round(duree_r),
            "ecart_duree_pct": round((duree_r - duree_p) / duree_p * 100) if duree_p else None,
            "rpe_cible_moy": _r(_moy(c for c, _ in ecarts_rpe)), "rpe_reel_moy": _r(_moy(r for _, r in ecarts_rpe)),
            "nb_rpe": len(ecarts_rpe),
        }

    lignes = []
    for k in range(semaines):
        w = debut + timedelta(weeks=k)
        if par_sem.get(w):
            lignes.append({"semaine": w.isoformat(), **agreger(par_sem[w])})
    terminees = lambda n: [p for w, ps in par_sem.items() if cs._lundi(auj) - timedelta(weeks=n) <= w < cs._lundi(auj) for p in ps]
    sports = defaultdict(list)
    for p in terminees(12):
        sports[p.sport].append(p)
    return {
        "semaines": lignes,
        "bilan_4s": agreger(terminees(4)), "bilan_12s": agreger(terminees(12)),
        "par_sport": sorted(({"sport": s, "label": cs.SPORTS.get(s, cs.SPORTS["autre"])["label"], **agreger(ps)}
                             for s, ps in sports.items()), key=lambda x: -x["prevues"]),
    }


# ---------------------------------------------------------------------------
# Comparaison d'une année sur l'autre
# ---------------------------------------------------------------------------

def _annuel(acts: list[Activite], auj: date, nb_annees: int = 4) -> dict:
    annees = sorted({a.debut.year for a in acts})[-nb_annees:]
    metriques = {"heures": lambda a: (a.duree_sec or 0) / 3600,
                 "km_pied": lambda a: (a.distance_km or 0) if a.sport in cs.SPORTS_PIED else 0,
                 "km": lambda a: a.distance_km or 0,
                 "dplus": lambda a: a.dplus_m or 0,
                 "charge": cs.charge,
                 "seances": lambda a: 1}
    par = {y: {m: [0.0] * 53 for m in metriques} for y in annees}
    for a in acts:
        y = a.debut.year
        if y not in par:
            continue
        s = min(52, (a.debut.date() - date(y, 1, 1)).days // 7)
        for m, f in metriques.items():
            par[y][m][s] += f(a)
    courbes = {}
    sem_auj = min(52, (auj - date(auj.year, 1, 1)).days // 7)
    for m in metriques:
        lignes = []
        cumuls = {y: 0.0 for y in annees}
        for s in range(53):
            ligne = {"semaine": s + 1}
            for y in annees:
                cumuls[y] += par[y][m][s]
                if y < auj.year or s <= sem_auj:
                    ligne[str(y)] = round(cumuls[y], 1)
            lignes.append(ligne)
        courbes[m] = lignes
    # À date : même période (1er janvier → même jour) pour chaque année
    a_date = []
    for y in annees:
        try:
            borne = auj.replace(year=y)
        except ValueError:
            borne = auj.replace(year=y, day=28)
        sel = [a for a in acts if date(y, 1, 1) <= a.debut.date() <= borne]
        tot = {m: sum(f(a) for a in sel) for m, f in metriques.items()}
        a_date.append({"annee": y, **{m: round(v, 1) for m, v in tot.items()}})
    return {"annees": annees, "courbes": courbes, "a_date": a_date}


# ---------------------------------------------------------------------------
# Corrélations
# ---------------------------------------------------------------------------

def pearson(xs: list[float], ys: list[float]) -> Optional[float]:
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    return sxy / (sx * sy) if sx and sy else None


def _force(r: float) -> str:
    a = abs(r)
    return "aucun lien" if a < 0.1 else "lien faible" if a < 0.3 else "lien modéré" if a < 0.5 else "lien fort"


def _correlation(cle, titre, x_label, y_label, paires, attendu: int, explication: str) -> dict:
    paires = [(j, x, y) for j, x, y in paires if x is not None and y is not None]
    d = {"id": cle, "titre": titre, "x_label": x_label, "y_label": y_label, "n": len(paires),
         "points": [{"jour": j, "x": round(x, 2), "y": round(y, 2)} for j, x, y in paires],
         "r": None, "force": None, "conforme": None, "explication": explication}
    if len(paires) >= CORREL_MIN:
        r = pearson([x for _, x, _ in paires], [y for _, _, y in paires])
        if r is not None:
            d["r"] = round(r, 2)
            d["force"] = _force(r)
            d["conforme"] = None if abs(r) < 0.1 else (r > 0) == (attendu > 0)
    return d


def _correlations(acts: list[Activite], mesures: dict[str, dict[date, float]], forme: list[dict],
                  poids: list[PoidsUtilisateur], auj: date) -> list[dict]:
    debut = auj - timedelta(days=365)
    charges = charges_quotidiennes(acts)
    vfc, fcr, som = mesures.get("vfc", {}), mesures.get("fc_repos", {}), mesures.get("sommeil", {})
    fcs = mesures.get("fc_sommeil", {})
    atl = {date.fromisoformat(p["jour"]): p["atl"] for p in forme}
    jours = [debut + timedelta(days=i) for i in range((auj - debut).days + 1)]

    eff_jour: dict[date, list[float]] = defaultdict(list)
    for a in acts:
        al = cs.allure_sec_km(a)
        if a.sport == "course" and al and a.fc_moyenne_bpm and (a.dplus_m or 0) / (a.distance_km or 1) < 15:
            eff_jour[a.debut.date()].append((1000 / al) * 60 / a.fc_moyenne_bpm)
    eff = {j: mean(v) for j, v in eff_jour.items()}

    poids_sem: dict[date, list[float]] = defaultdict(list)
    for p in poids:
        poids_sem[cs._lundi(p.enregistre_le.date())].append(p.poids_kg)
    eff_sem: dict[date, list[float]] = defaultdict(list)
    for j, v in eff.items():
        eff_sem[cs._lundi(j)].append(v)

    fmt = lambda j: j.isoformat()
    return [
        _correlation("vfc_charge", "Charge de la veille → VFC du jour", "Charge de la veille (min×RPE)", "VFC (ms)",
                     [(fmt(j), charges.get(j - timedelta(days=1), 0.0), vfc.get(j)) for j in jours if j in vfc],
                     -1, "Une grosse journée d'entraînement fait souvent baisser la VFC le lendemain."),
        _correlation("sommeil_vfc", "Sommeil → VFC", "Sommeil (h)", "VFC (ms)",
                     [(fmt(j), som.get(j), vfc.get(j)) for j in jours], 1,
                     "Mieux dormir favorise une VFC plus haute, signe d'une bonne récupération."),
        _correlation("fc_sommeil_charge", "Charge de la veille → FC pendant le sommeil", "Charge de la veille (min×RPE)",
                     "FC sommeil (bpm)",
                     [(fmt(j), charges.get(j - timedelta(days=1), 0.0), fcs.get(j)) for j in jours if j in fcs], 1,
                     "Après une grosse journée, le cœur reste souvent plus rapide la nuit suivante."),
        _correlation("fc_repos_atl", "Fatigue (ATL) → FC au repos", "Fatigue ATL", "FC repos (bpm)",
                     [(fmt(j), atl.get(j - timedelta(days=1)), fcr.get(j)) for j in jours], 1,
                     "Une fatigue accumulée fait souvent monter la FC au repos."),
        _correlation("sommeil_efficacite", "Sommeil → efficacité de la sortie", "Sommeil (h)", "Efficacité (m/battement)",
                     [(fmt(j), som.get(j), eff.get(j)) for j in jours if j in eff], 1,
                     "Une bonne nuit permet de courir plus vite au même cœur."),
        _correlation("poids_efficacite", "Poids → efficacité aérobie (par semaine)", "Poids (kg)", "Efficacité (m/battement)",
                     [(fmt(w), mean(poids_sem[w]), mean(eff_sem[w])) for w in sorted(eff_sem)
                      if w in poids_sem and w >= cs._lundi(debut)], -1,
                     "Plus léger, on dépense moins pour la même allure."),
    ]


# ---------------------------------------------------------------------------
# Courbe des meilleurs efforts par durée et allure critique
# ---------------------------------------------------------------------------

def _allure(dist_m: float, duree_s: float) -> Optional[int]:
    return round(duree_s / (dist_m / 1000)) if dist_m else None


def vitesse_critique(meilleurs: dict[int, float]) -> Optional[dict]:
    """Modèle distance = VC × t + D' (Monod) ajusté sur les meilleures distances de 3 à 20 min.
    VC ≈ allure tenable environ 30 à 40 min ; D' = réserve anaérobie (m) au-dessus de cette allure."""
    pts = [(m * 60, meilleurs[m]) for m in DUREES_CS if meilleurs.get(m)]
    if len(pts) < 3:
        return None
    n = len(pts)
    mt, md = sum(t for t, _ in pts) / n, sum(d for _, d in pts) / n
    stt = sum((t - mt) ** 2 for t, _ in pts)
    if not stt:
        return None
    vc = sum((t - mt) * (d - md) for t, d in pts) / stt
    dp = md - vc * mt
    if vc <= 0 or not 0 < dp < 600:
        return None
    return {"vitesse_ms": round(vc, 3), "allure_sec_km": round(1000 / vc), "dprime_m": round(dp), "n": n}


def _efforts_duree(acts: list[Activite], auj: date) -> dict:
    pts: list[tuple[date, int, float, Activite]] = []
    for a in acts:
        if a.sport not in cs.SPORTS_PIED:
            continue
        d = (cs._details_dict(a).get("efforts") or {}).get("d") or {}
        for m, metres in d.items():
            if str(m).isdigit() and metres:
                pts.append((a.debut.date(), int(m), float(metres), a))

    def meilleurs(debut: date, fin: date) -> dict[int, tuple[float, date, Activite]]:
        out = {}
        for j, m, metres, a in pts:
            if debut < j <= fin and (m not in out or metres > out[m][0]):
                out[m] = (metres, j, a)
        return out

    def fiche(m, e):
        if not e:
            return None
        metres, j, a = e
        return {"metres": round(metres), "allure_sec_km": _allure(metres, m * 60),
                "vitesse_kmh": round(metres / (m * 60) * 3.6, 1), "date": j.isoformat(),
                "activite_id": a.id, "titre": a.titre}

    actuels = meilleurs(auj - timedelta(days=90), auj)
    an_dernier = meilleurs(auj - timedelta(days=455), auj - timedelta(days=365))
    records = meilleurs(date.min, auj)
    courbe = [{"minutes": m, "label": f"{m} min" if m < 60 else "1 h",
               "actuel": fiche(m, actuels.get(m)), "an_dernier": fiche(m, an_dernier.get(m)),
               "record": fiche(m, records.get(m))}
              for m in DUREES_EFFORTS if m in records]

    vc = vitesse_critique({m: e[0] for m, e in actuels.items()})
    vc_an = vitesse_critique({m: e[0] for m, e in an_dernier.items()})
    historique = []
    fins = [auj]
    for _ in range(11):
        fins.append(fins[-1].replace(day=1) - timedelta(days=1))
    for fin in reversed(fins):
        v = vitesse_critique({m: e[0] for m, e in meilleurs(fin - timedelta(days=90), fin).items()})
        historique.append({"mois": fin.strftime("%Y-%m"), "allure_sec_km": v and v["allure_sec_km"],
                           "dprime_m": v and v["dprime_m"]})
    return {"courbe": courbe, "vc": vc, "vc_an_dernier": vc_an,
            "historique": historique if any(h["allure_sec_km"] for h in historique) else []}


# ---------------------------------------------------------------------------
# Efficacité aérobie des sorties d'endurance
# ---------------------------------------------------------------------------

def _efficacite(acts: list[Activite], user: Utilisateur, mesures: dict[str, dict[date, float]], auj: date) -> dict:
    """Mètres parcourus par battement cardiaque sur les sorties faciles et peu vallonnées :
    une hausse au fil des mois = le moteur aérobie progresse."""
    fc_max = user.fc_max
    fc_rep = user.fc_repos or (median(mesures["fc_repos"].values()) if mesures.get("fc_repos") else None)
    debut = auj - timedelta(days=365)
    points = []
    for a in acts:
        if (a.sport != "course" or a.debut.date() <= debut or not a.fc_moyenne_bpm or not a.distance_km
                or not a.duree_sec or a.duree_sec < 20 * 60 or (a.dplus_m or 0) / a.distance_km >= 15):
            continue
        al = cs.allure_sec_km(a)
        if not al or al < ALLURE_MIN_PLAUSIBLE:
            continue
        zones = cs._details_dict(a).get("zones_fc")
        tot = sum(float(z.get("min_passees") or 0) for z in zones) if isinstance(zones, list) and len(zones) == 5 else 0
        if tot:
            if (float(zones[0].get("min_passees") or 0) + float(zones[1].get("min_passees") or 0)) / tot < 0.7:
                continue
        elif fc_max and fc_rep and fc_max > fc_rep:
            if (a.fc_moyenne_bpm - fc_rep) / (fc_max - fc_rep) > 0.75:
                continue
        points.append({"date": a.debut.date().isoformat(), "ef": round(1000 / al * 60 / a.fc_moyenne_bpm, 3),
                       "allure_sec_km": round(al), "fc": round(a.fc_moyenne_bpm), "duree_min": round(a.duree_sec / 60),
                       "activite_id": a.id, "titre": a.titre})
    par_mois: dict[str, list[float]] = defaultdict(list)
    for p in points:
        par_mois[p["date"][:7]].append(p["ef"])
    mois = [{"mois": m, "ef": round(median(v), 3), "n": len(v)} for m, v in sorted(par_mois.items())]

    def med(de: date, a: date):
        xs = [p["ef"] for p in points if de < date.fromisoformat(p["date"]) <= a]
        return median(xs) if len(xs) >= 3 else None
    recent, ancien = med(auj - timedelta(days=42), auj), med(auj - timedelta(days=132), auj - timedelta(days=90))
    return {"points": points, "mois": mois, "recent": _r(recent, 3), "ancien": _r(ancien, 3),
            "tendance_pct": _r((recent - ancien) / ancien * 100) if recent and ancien else None}


# ---------------------------------------------------------------------------
# Monotonie et contrainte (Foster)
# ---------------------------------------------------------------------------

def _monotonie(acts: list[Activite], auj: date, semaines: int = 26) -> dict:
    """Monotonie = charge moyenne du jour / écart type sur 7 jours ; contrainte = charge de la semaine × monotonie.
    Des semaines uniformes (monotonie > 2) et chargées exposent au surmenage et aux maladies."""
    charges = charges_quotidiennes(acts)

    def calcul(jours: list[date]) -> tuple[float, Optional[float], Optional[float]]:
        c = [charges.get(j, 0.0) for j in jours]
        total = sum(c)
        if not total:
            return 0.0, None, None
        sd = pstdev(c)
        mono = min(mean(c) / sd, 5.0) if sd else 5.0
        return total, round(mono, 2), round(total * mono)

    lundi = cs._lundi(auj)
    lignes = []
    for k in range(semaines, 0, -1):
        w = lundi - timedelta(weeks=k)
        total, mono, contrainte = calcul([w + timedelta(days=i) for i in range(7)])
        lignes.append({"semaine": w.isoformat(), "charge": round(total), "monotonie": mono, "contrainte": contrainte})
    total, mono, contrainte = calcul([auj - timedelta(days=i) for i in range(6, -1, -1)])
    refs = [l["contrainte"] for l in lignes[-12:] if l["contrainte"]]
    ref = mean(refs) if refs else None
    niveau = None if mono is None else "varie" if mono < 1.5 else "surveiller" if mono <= 2 else "uniforme"
    return {"semaines": lignes,
            "actuel": {"charge": round(total), "monotonie": mono, "contrainte": contrainte, "niveau": niveau,
                       "contrainte_ref": round(ref) if ref else None,
                       "contrainte_pct": round((contrainte - ref) / ref * 100) if contrainte and ref else None}}


# ---------------------------------------------------------------------------
# Foulée dans le temps (à allure comparable)
# ---------------------------------------------------------------------------

METRIQUES_FOULEE = [
    # clé, libellé, unité, décimales, sens (1 = une hausse est bon signe, -1 = une baisse l'est)
    ("cadence", "Cadence", "pas/min", 0, 1),
    ("foulee_m", "Longueur de foulée", "m", 2, 1),
    ("oscillation_cm", "Oscillation verticale", "cm", 1, -1),
    ("contact_sol_ms", "Temps de contact", "ms", 0, -1),
    ("ratio_vertical_pct", "Ratio vertical", "%", 1, -1),
    ("puissance_moy_w", "Puissance", "W", 0, 0),
]
ECART_ALLURE_FOULEE = 25   # s/km autour de l'allure habituelle


def _foulee(acts: list[Activite], auj: date) -> dict:
    debut = auj - timedelta(days=365)
    runs = []
    for a in acts:
        if a.sport != "course" or a.debut.date() <= debut:
            continue
        det = cs._details_dict(a)
        al = cs.allure_sec_km(a)
        cad = det["pas"] / (a.duree_sec / 60) if det.get("pas") and a.duree_sec else None
        v = {"cadence": cad if cad and 120 <= cad <= 230 else None}
        for cle in ("foulee_m", "oscillation_cm", "contact_sol_ms", "ratio_vertical_pct", "puissance_moy_w"):
            x = det.get(cle)
            v[cle] = float(x) if isinstance(x, (int, float)) and x > 0 else None
        if v["ratio_vertical_pct"] is None and v["oscillation_cm"] and v["foulee_m"]:
            v["ratio_vertical_pct"] = v["oscillation_cm"] / (v["foulee_m"] * 100) * 100
        if not al or al < ALLURE_MIN_PLAUSIBLE or not any(x is not None for x in v.values()):
            continue
        runs.append((a, al, v))
    if not runs:
        return {"metriques": [], "mois": [], "points": [], "allure_ref_sec": None, "n_comparables": 0}
    ref = median(al for _, al, _ in runs)
    comparables = [(a, al, v) for a, al, v in runs if abs(al - ref) <= ECART_ALLURE_FOULEE]

    def med(cle, de: date, a_: date):
        xs = [v[cle] for a, _, v in comparables if de < a.debut.date() <= a_ and v[cle] is not None]
        return median(xs) if len(xs) >= 2 else None
    metriques = []
    for cle, label, unite, dec, sens in METRIQUES_FOULEE:
        if not any(v[cle] is not None for _, _, v in comparables):
            continue
        recent = med(cle, auj - timedelta(days=56), auj)
        ancien = med(cle, auj - timedelta(days=236), auj - timedelta(days=56))
        metriques.append({"cle": cle, "label": label, "unite": unite, "dec": dec, "sens": sens,
                          "recent": _r(recent, dec), "ancien": _r(ancien, dec)})
    par_mois: dict[str, list] = defaultdict(list)
    for a, _, v in comparables:
        par_mois[a.debut.strftime("%Y-%m")].append(v)
    mois = []
    for m, vs in sorted(par_mois.items()):
        ligne = {"mois": m, "n": len(vs)}
        for cle, _, _, dec, _ in METRIQUES_FOULEE:
            xs = [v[cle] for v in vs if v[cle] is not None]
            ligne[cle] = round(median(xs), dec) if xs else None
        mois.append(ligne)
    points = [{"date": a.debut.date().isoformat(), "allure_sec_km": round(al),
               "comparable": abs(al - ref) <= ECART_ALLURE_FOULEE, "activite_id": a.id, "titre": a.titre,
               **{cle: _r(v[cle], dec) for cle, _, _, dec, _ in METRIQUES_FOULEE}} for a, al, v in runs]
    return {"metriques": metriques, "mois": mois, "points": points[-200:], "allure_ref_sec": round(ref),
            "n_comparables": len(comparables)}


# ---------------------------------------------------------------------------
# Dénivelé : volume hebdomadaire, km-effort, vitesse ascensionnelle
# ---------------------------------------------------------------------------

def _denivele(acts: list[Activite], auj: date, semaines: int = 26) -> dict:
    lundi0 = cs._lundi(auj) - timedelta(weeks=semaines - 1)
    par_sem = {lundi0 + timedelta(weeks=i): {"km": 0.0, "dplus": 0.0} for i in range(semaines)}
    vams = []
    for a in acts:
        if a.sport not in SPORTS_EFFORTS:
            continue
        w = cs._lundi(a.debut.date())
        if w in par_sem:
            par_sem[w]["km"] += a.distance_km or 0
            par_sem[w]["dplus"] += a.dplus_m or 0
        eff = cs._details_dict(a).get("efforts") or {}
        if eff.get("vam") and (a.dplus_m or 0) >= 100 and a.debut.date() > auj - timedelta(days=365):
            vams.append({"date": a.debut.date().isoformat(), "vam": eff["vam"], "montee_m": eff.get("montee_m"),
                         "dplus_m": a.dplus_m, "sport": a.sport, "activite_id": a.id, "titre": a.titre})
    lignes = [{"semaine": w.isoformat(), "km": round(s["km"], 1), "dplus": round(s["dplus"]),
               "km_effort": round(s["km"] + s["dplus"] / 100, 1),
               "m_par_km": round(s["dplus"] / s["km"]) if s["km"] >= 1 else None} for w, s in par_sem.items()]

    def bilan(sel):
        km, dp = sum(l["km"] for l in sel), sum(l["dplus"] for l in sel)
        return {"km": round(km, 1), "dplus": round(dp), "km_effort": round(km + dp / 100, 1),
                "m_par_km": round(dp / km) if km >= 1 else None}
    debut90 = (auj - timedelta(days=90)).isoformat()
    recentes = [v["vam"] for v in vams if v["date"] > debut90 and v["sport"] != "randonnee"]
    return {"semaines": lignes, "bilan_4s": bilan(lignes[-4:]), "bilan_4s_avant": bilan(lignes[-8:-4]),
            "vams": vams[-80:], "vam_90j": round(median(recentes)) if recentes else None,
            "vam_max_90j": max(recentes) if recentes else None}


# ---------------------------------------------------------------------------
# Sommeil : dette, régularité, effet des nuits courtes sur la VFC
# ---------------------------------------------------------------------------

def _sommeil(mesures: dict[str, dict[date, float]], user: Utilisateur, auj: date) -> dict:
    besoin = user.besoin_sommeil_h or BESOIN_SOMMEIL_H
    som, vfc = mesures.get("sommeil", {}), mesures.get("vfc", {})

    def dette(fin: date, jours: int) -> tuple[Optional[float], int]:
        """Heures manquantes par rapport au besoin (les grasses matinées en rattrapent une partie)."""
        nuits = [som[d] for d in som if fin - timedelta(days=jours) < d <= fin]
        return (round(max(0.0, sum(besoin - h for h in nuits)), 2) if nuits else None), len(nuits)
    d7, n7 = dette(auj, 7)
    d14, n14 = dette(auj, 14)
    recentes = [som[d] for d in sorted(som) if auj - timedelta(days=14) < d <= auj]
    regularite = round(pstdev(recentes) * 60) if len(recentes) >= 5 else None

    an = auj - timedelta(days=365)
    courtes = [vfc[d] for d, h in som.items() if d in vfc and d > an and h < besoin - 1]
    normales = [vfc[d] for d, h in som.items() if d in vfc and d > an and h >= besoin - 0.25]
    effet = None
    if len(courtes) >= 4 and len(normales) >= 4:
        mc, mn = mean(courtes), mean(normales)
        effet = {"vfc_courtes": round(mc), "vfc_normales": round(mn), "ecart_pct": round((mc - mn) / mn * 100),
                 "n_courtes": len(courtes), "n_normales": len(normales)}
    points = []
    for k in range(59, -1, -1):
        j = auj - timedelta(days=k)
        points.append({"jour": j.isoformat(), "heures": _r(som.get(j), 2), "dette_7j": dette(j, 7)[0]})
    return {"besoin_h": besoin, "dette_7j": d7, "nuits_7j": n7, "dette_14j": d14, "nuits_14j": n14,
            "regularite_min": regularite, "nuits_regularite": len(recentes), "effet_vfc": effet,
            "points": points if any(p["heures"] for p in points) else []}


# ---------------------------------------------------------------------------
# Signaux d'alerte de la nuit : respiration et SpO2 inhabituelles
# ---------------------------------------------------------------------------

SIGNAUX_NUIT = {
    "respiration": {"label": "Respiration", "unite": "/min"},
    "spo2": {"label": "SpO2", "unite": "%"},
}


def _reference_nuit(serie: dict[date, float], j: date) -> Optional[float]:
    vals = [v for d, v in serie.items() if j - timedelta(days=28) <= d < j]
    return mean(vals) if len(vals) >= 7 else None


def _signaux(mesures: dict[str, dict[date, float]], j: date) -> list[dict]:
    out = []
    for t, meta in SIGNAUX_NUIT.items():
        serie = mesures.get(t, {})
        v = serie.get(j)
        if v is None:
            continue
        ref = _reference_nuit(serie, j)
        if t == "respiration":
            alerte = ref is not None and v - ref >= 1.0
        else:
            alerte = v < 93 or (ref is not None and v <= ref - 2)
        out.append({"type": t, **meta, "valeur": round(v, 1), "ref": _r(ref),
                    "ecart": _r(v - ref) if ref is not None else None, "alerte": alerte})
    return out


def alertes_nuit(mesures: dict[str, dict[date, float]], auj: date) -> Optional[dict]:
    """Dernière nuit (2 jours max) comparée aux 28 nuits précédentes. Une respiration qui monte
    d'au moins 1 /min ou une SpO2 qui baisse de 2 points précèdent souvent une infection."""
    jours = [d for t in SIGNAUX_NUIT for d in mesures.get(t, {}) if auj - timedelta(days=2) <= d <= auj]
    if not jours:
        return None
    j = max(jours)
    signaux = _signaux(mesures, j)
    consecutives, d = 0, j
    while any(s["alerte"] for s in _signaux(mesures, d)):
        consecutives += 1
        d -= timedelta(days=1)
    if not any(s["alerte"] for s in signaux):
        message = "Respiration et oxygénation habituelles cette nuit"
    elif consecutives >= 2:
        message = f"{consecutives} nuits inhabituelles de suite : possible infection ou grosse fatigue, allège"
    else:
        message = "Nuit inhabituelle : guette les signes (gorge, fièvre) et reste prudent"
    return {"jour": j.isoformat(), "signaux": signaux, "alerte": consecutives > 0,
            "nuits_consecutives": consecutives, "message": message}


def _signaux_nuit(mesures: dict[str, dict[date, float]], auj: date, jours: int = 60) -> dict:
    points = []
    for k in range(jours - 1, -1, -1):
        j = auj - timedelta(days=k)
        p = {"jour": j.isoformat(), "alerte": False}
        for s in _signaux(mesures, j):
            p[s["type"]], p[s["type"] + "_ref"] = s["valeur"], s["ref"]
            p["alerte"] = p["alerte"] or s["alerte"]
        points.append(p)
    return {"actuel": alertes_nuit(mesures, auj),
            "points": points if any(len(p) > 2 for p in points) else [],
            "nuits_alerte_60j": sum(1 for p in points if p["alerte"])}


# ---------------------------------------------------------------------------
# Pas quotidiens
# ---------------------------------------------------------------------------

def _pas(pas: dict[date, float], auj: date, jours: int = 365) -> dict:
    """Pas quotidiens : 1 an de points journaliers (avec moyenne 7 j), puis moyennes
    par semaine et par mois sur tout l'historique pour les vues longues."""
    pas = {d: v for d, v in pas.items() if d <= auj}
    moy = lambda n: _r(_moy([v for d, v in pas.items() if auj - timedelta(days=n) < d]), 0)
    points = []
    for k in range(jours - 1, -1, -1):
        j = auj - timedelta(days=k)
        fen = [pas[d] for d in pas if j - timedelta(days=6) <= d <= j]
        points.append({"jour": j.isoformat(), "pas": pas.get(j), "moy7": _r(_moy(fen), 0)})
    # Points journaliers seulement à partir de la première mesure
    premier = min(pas, default=None)
    points = [p for p in points if premier and p["jour"] >= premier.isoformat()]
    semaines: dict[date, list] = defaultdict(list)
    mois: dict[str, list] = defaultdict(list)
    for d, v in pas.items():
        semaines[d - timedelta(days=d.weekday())].append(v)
        mois[d.strftime("%Y-%m")].append(v)
    der = max(pas, default=None)
    return {"points": points if any(p["pas"] for p in points) else [],
            "semaines": [{"jour": d.isoformat(), "pas": _r(_moy(v), 0), "jours": len(v)} for d, v in sorted(semaines.items())],
            "mois": [{"jour": f"{m}-01", "pas": _r(_moy(v), 0), "jours": len(v)} for m, v in sorted(mois.items())],
            "premier": premier.isoformat() if premier else None,
            "derniere": {"jour": der.isoformat(), "pas": round(pas[der])} if der else None,
            "moy_7j": moy(7), "moy_28j": moy(28), "moy_90j": moy(90), "moy_365j": moy(365),
            "moy_tout": _r(_moy(list(pas.values())), 0),
            "jours_10k_28j": sum(1 for d, v in pas.items() if auj - timedelta(days=28) < d and v >= 10000)}


# ---------------------------------------------------------------------------
# Assemblage
# ---------------------------------------------------------------------------

def _mesures_par_type(db: Session, user_id: int, depuis: date) -> dict[str, dict[date, float]]:
    out: dict[str, dict[date, float]] = defaultdict(dict)
    for m in db.query(MesureSante).filter(MesureSante.utilisateur_id == user_id, MesureSante.jour >= depuis):
        out[m.type][m.jour] = m.valeur
    return out


def calculer_analyses(db: Session, user: Utilisateur, aujourd_hui: Optional[date] = None) -> dict:
    auj = aujourd_hui or date.today()
    acts = (db.query(Activite).filter(Activite.utilisateur_id == user.id, Activite.debut
                                      < datetime.combine(auj + timedelta(days=1), datetime.min.time()))
            .order_by(Activite.debut).all())
    maj_efforts(db, user.id, acts)
    objectifs = db.query(Objectif).filter(Objectif.utilisateur_id == user.id).all()
    mesures = _mesures_par_type(db, user.id, auj - timedelta(days=365 + REF_RECUP_JOURS))
    poids = db.query(PoidsUtilisateur).filter(PoidsUtilisateur.utilisateur_id == user.id).all()
    forme = _forme_fatigue(acts, objectifs, auj)
    serie_complete = courbe_forme(charges_quotidiennes(acts), auj)
    return {
        "genere_le": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "forme": forme,
        "zones": _zones_hebdo(acts, user, auj),
        "recuperation": _recuperation(mesures, auj),
        "course": _course(acts, auj),
        "vma": _vma(db, user, acts, mesures, auj),
        "plan": _respect_plan(db, user.id, auj),
        "annuel": _annuel(acts, auj),
        "correlations": _correlations(acts, mesures, serie_complete, poids, auj),
        "efforts_duree": _efforts_duree(acts, auj),
        "efficacite": _efficacite(acts, user, mesures, auj),
        "monotonie": _monotonie(acts, auj),
        "foulee": _foulee(acts, auj),
        "denivele": _denivele(acts, auj),
        "sommeil": _sommeil(mesures, user, auj),
        "signaux_nuit": _signaux_nuit(mesures, auj),
        "pas": _pas({m.jour: m.valeur for m in db.query(MesureSante.jour, MesureSante.valeur).filter(
            MesureSante.utilisateur_id == user.id, MesureSante.type == "pas")}, auj),
    }


def resume(analyses: dict) -> dict:
    """Synthèse compacte pour l'export (plan hebdomadaire de Claude)."""
    f = analyses["forme"].get("actuel")
    r = analyses["recuperation"]
    z = analyses["zones"]
    p = analyses["plan"]
    c = analyses["course"]
    return {
        "forme": f and {k: f[k] for k in ("ctl", "atl", "tsb", "rampe_7j", "rampe_pct")} | {"etat": f["etat"]["label"]},
        "recuperation": r["actuel"],
        "sommeil": r["sommeil"],
        "zones_4s": z["bilan_4s"], "zones_12s": z["bilan_12s"],
        "plan_4s": p["bilan_4s"], "plan_12s": p["bilan_12s"],
        "meilleurs_efforts": {k: {"temps": v["temps_str"], "date": v["date"]} for k, v in c["records"].items()},
        "derives_recentes": c["derives"][-5:],
        "vma": analyses["vma"]["actuelle"] and {"estimee": analyses["vma"]["actuelle"]["vma"],
                                                "dernier_test": analyses["vma"]["dernier_test"]},
        "allure_critique": analyses["efforts_duree"]["vc"],
        "efficacite_aerobie": {k: analyses["efficacite"][k] for k in ("recent", "ancien", "tendance_pct")},
        "monotonie": analyses["monotonie"]["actuel"],
        "durabilite_recente": c["durabilites"][-5:],
        "denivele_4s": analyses["denivele"]["bilan_4s"],
        "dette_sommeil": {k: analyses["sommeil"][k] for k in ("besoin_h", "dette_7j", "dette_14j", "regularite_min")},
        "signaux_nuit": analyses["signaux_nuit"]["actuel"],
        "pas": {k: analyses["pas"][k] for k in ("moy_7j", "moy_28j")},
    }
