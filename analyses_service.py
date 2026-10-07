"""
Analyses avancées du carnet : forme / fatigue (CTL, ATL, TSB), répartition des zones de FC,
indice de récupération (VFC, FC repos, sommeil), analyses de course (meilleurs efforts tirés
des tracés GPS, dérive cardiaque, prédictions, cadence), respect du plan, comparaison d'une
année sur l'autre et corrélations entre les données.

Tout est recalculé à la demande à partir du carnet ; seuls les meilleurs efforts d'une séance
(coûteux à tirer du tracé) sont mémorisés dans ses `details`.
"""
from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import date, datetime, timedelta
from statistics import mean, pstdev
from typing import Iterable, Optional

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
VERSION_EFFORTS = 1
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

    def reference(serie: dict[date, float], j: date):
        vals = [v for d, v in serie.items() if j - timedelta(days=REF_RECUP_JOURS) <= d < j]
        if len(vals) < REF_RECUP_MIN:
            return None, None
        sd = pstdev(vals)
        return mean(vals), (sd if sd > 0 else None)

    pts = []
    for k in range(jours - 1, -1, -1):
        j = auj - timedelta(days=k)
        p = {"jour": j.isoformat(), "vfc": vfc.get(j), "fc_repos": fcr.get(j), "sommeil": som.get(j)}
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
    return {
        "points": pts,
        "actuel": {"jour": actuel["jour"], "score": actuel["score"], "statut": actuel["statut"],
                   "message": STATUTS_RECUP[actuel["statut"]], "vfc": actuel["vfc"], "vfc_ref": actuel.get("vfc_ref"),
                   "fc_repos": actuel["fc_repos"], "fc_ref": actuel.get("fc_ref")} if actuel else None,
        "sommeil": {
            "derniere": {"jour": derniere_nuit.isoformat(), "heures": som[derniere_nuit]} if derniere_nuit else None,
            "moy_7j": _r(_moy(nuits), 2), "moy_28j": _r(_moy(nuits28), 2),
            "nuits_courtes_7j": sum(1 for h in nuits if h < 7), "nb_7j": len(nuits),
        },
    }


# ---------------------------------------------------------------------------
# Course à pied : meilleurs efforts, dérive cardiaque, prédictions, cadence
# ---------------------------------------------------------------------------

def meilleurs_efforts(points: list[list]) -> dict[str, int]:
    """Meilleur temps sur chaque distance par fenêtre glissante sur le tracé
    ([[lat, lon, alt, secondes], …]). Le temps est ramené à la distance exacte."""
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
    return res


def maj_efforts(db: Session, user_id: int, acts: list[Activite]) -> int:
    """Calcule (une fois par tracé) les meilleurs efforts des séances de course. Retourne le nombre calculé."""
    pied = {a.id: a for a in acts if a.sport in cs.SPORTS_PIED}
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
            "foulees": foulees[-120:]}


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
        "plan": _respect_plan(db, user.id, auj),
        "annuel": _annuel(acts, auj),
        "correlations": _correlations(acts, mesures, serie_complete, poids, auj),
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
    }
