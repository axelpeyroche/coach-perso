"""Analyses du corps sur la durée : tendance de la VFC, fenêtre de sommeil, effet des séances sur la
nuit, temps de récupération personnel, chaleur, tendances par saison.

Tout est appris sur l'historique de l'athlète ; chaque bloc renvoie None (ou `suffisant: False`)
tant que les données ne suffisent pas, plutôt qu'un chiffre fragile."""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, datetime, timedelta
from statistics import mean, median, pstdev
from typing import Optional

from sqlalchemy.orm import Session

import carnet_service as cs
from models import Activite, MesureSante, MeteoActivite, PoidsUtilisateur, SeancePrevue, TraceGPS, Utilisateur


def _r(x, n=1):
    return None if x is None else round(x, n) + 0.0   # + 0.0 : jamais de « -0.0 »


def _moy(xs) -> Optional[float]:
    xs = [x for x in xs if x is not None]
    return mean(xs) if xs else None


# ---------------------------------------------------------------------------
# 1.6 Tendance de la VFC sur 7 jours et coefficient de variation
# ---------------------------------------------------------------------------

VFC_FENETRE_MIN = 4     # mesures nécessaires sur 7 jours
CV_ELEVE = 1.3          # variabilité jugée élevée au-delà de 130 % de l'habituelle

MESSAGES_VFC = {
    ("dans", False): "Stable et dans ta plage : tu assimiles bien la charge.",
    ("dans", True): "Moyenne normale mais valeurs en dents de scie : ton corps encaisse quelque chose "
                    "(charge, stress, sommeil). À surveiller quelques jours.",
    ("sous", False): "Moyenne 7 jours sous ta plage : fatigue installée, pas un simple mauvais matin. Allège quelques jours.",
    ("sous", True): "Moyenne 7 jours sous ta plage et valeurs instables : fatigue installée. Allège et dors.",
    ("dessus", False): "Au-dessus de ta plage et stable : bonne fraîcheur.",
    ("dessus", True): "Au-dessus de ta plage mais irrégulière : à confirmer sur quelques jours.",
}


def _fenetre(serie: dict[date, float], j: date) -> list[float]:
    return [serie[d] for d in (j - timedelta(days=k) for k in range(7)) if d in serie]


def _cv(vals: list[float]) -> Optional[float]:
    if len(vals) < VFC_FENETRE_MIN or not mean(vals):
        return None
    return pstdev(vals) / mean(vals) * 100


def tendance_vfc(vfc: dict[date, float], points: list[dict], auj: date) -> Optional[dict]:
    """Moyenne glissante 7 j comparée à la plage normale (référence 60 j ± ½ écart-type : le plus
    petit changement qui compte) et coefficient de variation des 7 jours comparé à l'habituel."""
    fen = _fenetre(vfc, auj)
    if len(fen) < VFC_FENETRE_MIN:
        return None
    ref = next((p for p in reversed(points) if p.get("vfc_ref") is not None and p.get("vfc_haut") is not None), None)
    if not ref:
        return None
    sd = ref["vfc_haut"] - ref["vfc_ref"]
    bas, haut = ref["vfc_ref"] - sd / 2, ref["vfc_ref"] + sd / 2
    moy7, prec = mean(fen), _fenetre(vfc, auj - timedelta(days=7))
    cv7 = _cv(fen)
    cvs = [c for c in (_cv(_fenetre(vfc, auj - timedelta(days=k))) for k in range(7, 60)) if c is not None]
    cv_hab = mean(cvs) if len(cvs) >= 10 else None
    position = "sous" if moy7 < bas else "dessus" if moy7 > haut else "dans"
    instable = bool(cv7 and cv_hab and cv7 > cv_hab * CV_ELEVE)
    serie = []
    for k in range(89, -1, -1):
        j = auj - timedelta(days=k)
        serie.append({"jour": j.isoformat(), "cv7": _r(_cv(_fenetre(vfc, j)))})
    return {
        "moy7": _r(moy7), "moy7_prec": _r(mean(prec)) if len(prec) >= VFC_FENETRE_MIN else None,
        "plage": [_r(bas), _r(haut)], "ref": ref["vfc_ref"], "position": position,
        "cv7": _r(cv7), "cv_habituel": _r(cv_hab), "instable": instable, "n": len(fen),
        "message": MESSAGES_VFC[(position, instable)], "points": serie,
    }


# ---------------------------------------------------------------------------
# 1.8 Chronotype et fenêtre de sommeil
# ---------------------------------------------------------------------------

CHRONO_JOURS = 56
CHRONO_MIN = 7
ENDORMISSEMENT_H = 0.25
CHRONOTYPES = [(3.25, "matinal", "Plutôt du matin"), (4.75, "intermediaire", "Intermédiaire"), (99, "tardif", "Plutôt du soir")]


def chronotype(mesures: dict[str, dict[date, float]], besoin: float, dette_7j: Optional[float],
               auj: date, seance_cle: Optional[dict] = None) -> Optional[dict]:
    """Heures habituelles, décalage semaine / week-end (jet-lag social) et heure de coucher conseillée.
    Le jour d'une nuit est celui du réveil ; une nuit « libre » se termine un samedi ou un dimanche."""
    c, l = mesures.get("coucher", {}), mesures.get("lever", {})
    nuits = [(j, c[j], l[j]) for j in c if j in l and auj - timedelta(days=CHRONO_JOURS) < j <= auj
             and 18 <= c[j] <= 30 and 3 <= l[j] <= 14]
    if len(nuits) < CHRONO_MIN:
        return None

    def bloc(ns):
        if not ns:
            return None
        mc, ml = mean(n[1] for n in ns), mean(n[2] for n in ns)
        return {"coucher": _r(mc, 2), "lever": _r(ml, 2), "milieu": _r((mc + ml + 24) / 2 - 24, 2),
                "duree": _r(ml + 24 - mc, 2), "n": len(ns)}
    sem = bloc([n for n in nuits if n[0].weekday() < 5])
    we = bloc([n for n in nuits if n[0].weekday() >= 5])
    tout = bloc(nuits)
    jetlag = round((we["milieu"] - sem["milieu"]) * 60) if sem and we and sem["n"] >= 4 and we["n"] >= 2 else None
    milieu_libre = (we if we and we["n"] >= 2 else tout)["milieu"]
    _, cle, label = next(x for x in CHRONOTYPES if milieu_libre < x[0])

    lever_ref = (sem or tout)["lever"]
    conseille = lever_ref + 24 - besoin - ENDORMISSEMENT_H
    avance = 0
    if dette_7j and dette_7j >= 1.5:
        nuits_restantes = max(1, (date.fromisoformat(seance_cle["jour"]) - auj).days) if seance_cle else 3
        avance = min(60, round(dette_7j * 60 / nuits_restantes / 5) * 5)
    habituel = (sem or tout)["coucher"]
    if avance:
        cible = f"avant « {seance_cle['titre']} »" if seance_cle else "cette semaine"
        conseil = (f"Tu as {cs_hm(dette_7j)} de dette : couche-toi {avance} min plus tôt ces prochains soirs "
                   f"pour la combler {cible}.")
    elif habituel - conseille > 0.33:
        conseil = (f"Avec un réveil vers {cs_heure(lever_ref)}, il faudrait te coucher vers {cs_heure(conseille)} "
                   f"pour tes {cs_hm(besoin)} : tu te couches en moyenne {round((habituel - conseille) * 60)} min trop tard.")
    else:
        conseil = f"Ton heure de coucher couvre ton besoin de {cs_hm(besoin)}."
    if jetlag is not None and abs(jetlag) >= 60:
        conseil += (f" Le week-end, ton sommeil se décale de {cs_hm(abs(jetlag) / 60)} : au-delà d'une heure, "
                    "le lundi ressemble à un petit décalage horaire.")
    return {
        "nuits": len(nuits), "semaine": sem, "weekend": we, "tout": tout, "jetlag_min": jetlag,
        "chronotype": cle, "chronotype_label": label, "milieu_libre": milieu_libre,
        "coucher_conseille": _r(conseille, 2), "coucher_ce_soir": _r(conseille - avance / 60, 2),
        "avance_min": avance, "seance_cle": seance_cle if avance else None, "besoin_h": besoin, "conseil": conseil,
    }


def cs_heure(h: float) -> str:
    m = round(h * 60) % 1440
    return f"{m // 60} h {m % 60:02d}"


def cs_hm(h: float) -> str:
    m = round(h * 60)
    return f"{m // 60} h {m % 60:02d}" if m >= 60 else f"{m} min"


# ---------------------------------------------------------------------------
# Classement des journées d'entraînement (1.9 et 1.10)
# ---------------------------------------------------------------------------

SOIR_H = 19
LONGUE_MIN = 90
SPORTS_ENDURANCE = {"course", "trail", "velo", "randonnee", "natation", "marche"}
CATEGORIES = {
    "intense_soir": f"Intense, finie après {SOIR_H} h",
    "intense": f"Intense, finie avant {SOIR_H} h",
    "longue": "Sortie longue (1 h 30 et plus)",
    "muscu": "Musculation",
    "facile": "Séance facile",
    "repos": "Jour sans séance",
}


def _est_intense(a: Activite) -> bool:
    if a.est_competition or (a.rpe and a.rpe >= 7):
        return True
    zones = cs._details_dict(a).get("zones_fc")
    if isinstance(zones, list) and len(zones) == 5:
        return sum(float(z.get("min_passees") or 0) for z in zones[3:]) >= 10
    return False


def classer_jours(acts: list[Activite], depuis: date) -> dict[date, dict]:
    jours: dict[date, dict] = {}
    for a in acts:
        j = a.debut.date()
        if j < depuis or not a.duree_sec or a.duree_sec < 600:
            continue
        d = jours.setdefault(j, {"intense": False, "longue": False, "course": False, "muscu": False,
                                 "autre": False, "fin_h": 0.0})
        fin = a.debut + timedelta(seconds=a.duree_sec)
        intense = _est_intense(a)
        d["intense"] |= intense
        d["course"] |= bool(a.est_competition)
        d["longue"] |= a.sport in SPORTS_ENDURANCE and a.sport != "marche" and a.duree_sec >= LONGUE_MIN * 60
        d["muscu"] |= a.sport == "muscu"
        d["autre"] |= a.sport != "muscu"
        if intense or not d["intense"]:
            d["fin_h"] = max(d["fin_h"], fin.hour + fin.minute / 60 + (24 if fin.date() > j else 0))
    for d in jours.values():
        d["categorie"] = ("intense_soir" if d["intense"] and d["fin_h"] >= SOIR_H else "intense" if d["intense"]
                          else "longue" if d["longue"] else "muscu" if d["muscu"] and not d["autre"] else "facile")
        d["dure"] = "course" if d["course"] else "longue" if d["longue"] else "intense" if d["intense"] else None
    return jours


# ---------------------------------------------------------------------------
# 1.9 Effet de chaque type de séance sur la nuit suivante
# ---------------------------------------------------------------------------

EFFET_MIN = 4
METRIQUES_NUIT = [   # (clé, mesure, facteur, unité, sens : +1 = plus haut est mieux)
    ("vfc", "vfc", 1, "ms", 1),
    ("fc_nuit", "fc_sommeil", 1, "bpm", -1),
    ("profond", "sommeil_profond", 60, "min", 1),
    ("duree", "sommeil", 60, "min", 1),
]


def _base(serie: dict[date, float], j: date, exclus: set[date]) -> Optional[float]:
    vals = [v for d, v in serie.items() if j - timedelta(days=28) <= d <= j and d not in exclus]
    return mean(vals) if len(vals) >= 7 else None


def effet_nuit(jours: dict[date, dict], mesures: dict[str, dict[date, float]], exclus: set[date],
               auj: date, periode: int = 365) -> Optional[dict]:
    """Écart moyen, la nuit qui suit, entre la mesure et sa moyenne des 28 jours précédents."""
    ecarts: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for k in range(1, periode):
        j = auj - timedelta(days=k)
        lendemain = j + timedelta(days=1)
        if lendemain in exclus or j in exclus:
            continue
        cat = jours[j]["categorie"] if j in jours else "repos"
        for cle, mesure, facteur, _, _ in METRIQUES_NUIT:
            serie = mesures.get(mesure, {})
            if lendemain not in serie:
                continue
            base = _base(serie, j, exclus)
            if base is not None:
                ecarts[cat][cle].append((serie[lendemain] - base) * facteur)
    lignes = []
    for cat, label in CATEGORIES.items():
        e = ecarts.get(cat) or {}
        ligne = {"cle": cat, "label": label, "n": max((len(v) for v in e.values()), default=0)}
        for cle, *_ in METRIQUES_NUIT:
            ligne[cle] = _r(mean(e[cle])) if len(e.get(cle, [])) >= EFFET_MIN else None
        if ligne["n"] >= EFFET_MIN:
            lignes.append(ligne)
    if not any(l["cle"] != "repos" for l in lignes):
        return None
    par = {l["cle"]: l for l in lignes}
    phrase = None
    soir, jour_ = par.get("intense_soir"), par.get("intense")
    if soir and soir["vfc"] is not None and soir["vfc"] <= -2:
        phrase = f"Tes séances intenses finies après {SOIR_H} h coûtent en moyenne {abs(soir['vfc']):.0f} ms de VFC la nuit suivante"
        if jour_ and jour_["vfc"] is not None:
            phrase += f", contre {abs(jour_['vfc']):.0f} ms" if jour_["vfc"] < 0 else ", alors qu'avant 19 h elles ne la font pas baisser"
            phrase += " plus tôt dans la journée." if jour_["vfc"] < 0 else "."
        else:
            phrase += "."
    else:
        pire = min((l for l in lignes if l["cle"] != "repos" and l["vfc"] is not None), key=lambda l: l["vfc"], default=None)
        if pire and pire["vfc"] <= -2:
            phrase = f"Ce qui pèse le plus sur ta nuit : « {pire['label'].lower()} », {abs(pire['vfc']):.0f} ms de VFC en moins le lendemain matin."
        elif pire:
            phrase = "Aucun type de séance ne fait nettement baisser ta VFC la nuit suivante : tu encaisses bien ta charge actuelle."
    return {"lignes": lignes, "phrase": phrase,
            "metriques": [{"cle": c, "unite": u, "sens": s} for c, _, _, u, s in METRIQUES_NUIT]}


# ---------------------------------------------------------------------------
# 1.10 Temps de récupération personnel
# ---------------------------------------------------------------------------

RECUP_MAX = 7
RECUP_MIN_N = 3
TYPES_DURS = {"intense": "Séance intense", "longue": "Sortie longue", "course": "Course, compétition"}


def temps_recuperation(jours: dict[date, dict], scores: dict[date, Optional[float]], exclus: set[date],
                       auj: date) -> Optional[dict]:
    """Jours nécessaires pour que VFC et FC de repos reviennent dans la normale (indice ≥ −0,5) après
    une journée dure. Une autre journée dure avant le retour à la normale écarte la mesure."""
    delais: dict[str, list[int]] = defaultdict(list)
    for j, d in jours.items():
        if not d["dure"] or j >= auj - timedelta(days=1):
            continue
        for k in range(1, RECUP_MAX + 1):
            jk = j + timedelta(days=k)
            if jk > auj or jk in exclus:
                break
            s = scores.get(jk)
            if s is not None and s >= -0.5:
                delais[d["dure"]].append(k)
                break
            if jours.get(jk, {}).get("dure"):
                break
            if k == RECUP_MAX and s is not None:
                delais[d["dure"]].append(RECUP_MAX)
    types = []
    for cle, label in TYPES_DURS.items():
        v = delais.get(cle, [])
        if len(v) >= RECUP_MIN_N:
            types.append({"cle": cle, "label": label, "n": len(v), "mediane": median(v), "moyenne": _r(mean(v)),
                          "lendemain_pct": round(sum(1 for x in v if x == 1) / len(v) * 100),
                          "lent_pct": round(sum(1 for x in v if x >= 3) / len(v) * 100)})
    if not types:
        return None
    lent = max(types, key=lambda t: t["moyenne"])
    if lent["moyenne"] < 1.4:
        message = "Tes mesures reviennent dans ta normale dès le lendemain, quel que soit le type de séance."
    else:
        message = (f"C'est après « {lent['label'].lower()} » que tu mets le plus de temps à revenir dans ta normale : "
                   f"{str(lent['moyenne']).replace('.', ',')} jour(s) en moyenne. Garde au moins ce délai avant la prochaine séance dure.")
    return {"types": types, "message": message}


# ---------------------------------------------------------------------------
# 1.11 Chaleur (et altitude) : FC à allure égale selon la température
# ---------------------------------------------------------------------------

TEMP_NEUTRE = 15.0
CHALEUR_MIN_N = 12
CHALEUR_MIN_CHAUD = 4
ALTITUDE_HAUTE = 1000
TRANCHES_TEMP = [(-50, 5, "Moins de 5 °C"), (5, 10, "5 à 10 °C"), (10, 15, "10 à 15 °C"), (15, 20, "15 à 20 °C"),
                 (20, 25, "20 à 25 °C"), (25, 60, "25 °C et plus")]


def _resoudre3(m: list[list[float]], y: list[float]) -> Optional[list[float]]:
    def det(a):
        return (a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
                + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]))
    d = det(m)
    if abs(d) < 1e-9:
        return None
    out = []
    for i in range(3):
        mi = [ligne[:] for ligne in m]
        for k in range(3):
            mi[k][i] = y[k]
        out.append(det(mi) / d)
    return out


def _candidates(acts: list[Activite], auj: date, jours: int = 730) -> list[Activite]:
    return [a for a in acts if a.sport in cs.SPORTS_PIED and a.debut.date() >= auj - timedelta(days=jours)
            and a.duree_sec and a.duree_sec >= 1200 and a.distance_km and a.distance_km >= 3 and a.fc_moyenne_bpm
            and (a.dplus_m or 0) / a.distance_km <= 20]


def sorties_a_completer(db: Session, acts: list[Activite], auj: date) -> list[Activite]:
    """Sorties utiles à l'analyse dont le tracé existe mais dont la météo (ou l'altitude) n'a pas été lue."""
    cand = [a for a in _candidates(acts, auj) if a.debut.date() < auj]
    if not cand:
        return []
    ids = [a.id for a in cand]
    complets = {m.activite_id for m in db.query(MeteoActivite).filter(MeteoActivite.activite_id.in_(ids))
                if '"altitude_m"' in m.donnees}
    traces = {t for (t,) in db.query(TraceGPS.activite_id).filter(TraceGPS.activite_id.in_(ids))}
    return [a for a in cand if a.id in traces and a.id not in complets]


def sorties_meteo(db: Session, user_id: int, acts: list[Activite], auj: date) -> tuple[list[dict], int]:
    """Sorties de course à plat avec FC, vitesse et météo ; et nombre de sorties dont la météo reste à lire."""
    cand = _candidates(acts, auj)
    if not cand:
        return [], 0
    ids = [a.id for a in cand]
    meteo = {m.activite_id: m.donnees for m in db.query(MeteoActivite).filter(MeteoActivite.activite_id.in_(ids))}
    out = []
    for a in cand:
        if a.id not in meteo:
            continue
        try:
            m = json.loads(meteo[a.id])
        except ValueError:
            continue
        temp = m.get("temperature")
        duree = cs._details_dict(a).get("duree_mouvement_sec") or a.duree_sec
        v = a.distance_km / (duree / 3600)
        if temp is None or not (6 <= v <= 22) or not (90 <= a.fc_moyenne_bpm <= 200):
            continue
        out.append({"id": a.id, "jour": a.debut.date().isoformat(), "temp": float(temp), "v": v,
                    "fc": float(a.fc_moyenne_bpm), "altitude": m.get("altitude_m"), "humidite": m.get("humidite")})
    return out, len(sorties_a_completer(db, acts, auj))


def chaleur(sorties: list[dict], manquantes: int) -> dict:
    """Régression FC = a + b·vitesse + c·(°C au-dessus de 15) : c est le coût personnel d'un degré."""
    base = {"n": len(sorties), "manquantes": manquantes, "suffisant": False, "temp_neutre": TEMP_NEUTRE}
    chaud = [s for s in sorties if s["temp"] >= 20]
    if len(sorties) < CHALEUR_MIN_N or len(chaud) < CHALEUR_MIN_CHAUD:
        return {**base, "n_chaud": len(chaud), "min_n": CHALEUR_MIN_N, "min_chaud": CHALEUR_MIN_CHAUD}
    xs = [(1.0, s["v"], max(0.0, s["temp"] - TEMP_NEUTRE)) for s in sorties]
    ys = [s["fc"] for s in sorties]
    m = [[sum(x[i] * x[j] for x in xs) for j in range(3)] for i in range(3)]
    coefs = _resoudre3(m, [sum(x[i] * y for x, y in zip(xs, ys)) for i in range(3)])
    if not coefs:
        return {**base, "n_chaud": len(chaud), "min_n": CHALEUR_MIN_N, "min_chaud": CHALEUR_MIN_CHAUD}
    a, b, c = coefs
    v_moy = mean(s["v"] for s in sorties)
    points = [{"jour": s["jour"], "temp": _r(s["temp"]), "fc": _r(s["fc"] - b * (s["v"] - v_moy)),
               "allure": round(3600 / s["v"])} for s in sorties]
    tranches = []
    for bas, haut, label in TRANCHES_TEMP:
        g = [p["fc"] for p in points if bas <= p["temp"] < haut]
        if g:
            tranches.append({"label": label, "n": len(g), "fc": _r(mean(g), 0)})
    # Ralentissement qui garde la même FC : c·ΔT bpm « rachetés » par b bpm par km/h
    perte = None
    if b > 0.5 and c > 0:
        dv = c * 10 / b
        if dv < v_moy * 0.4:
            perte = round(3600 / (v_moy - dv) - 3600 / v_moy)
    altitude = None
    haut_ = [s for s in sorties if s["altitude"] is not None and s["altitude"] >= ALTITUDE_HAUTE]
    bas_ = [s for s in sorties if s["altitude"] is not None and s["altitude"] < ALTITUDE_HAUTE]
    if len(haut_) >= 4 and len(bas_) >= 4:
        res = lambda s: s["fc"] - (a + b * s["v"] + c * max(0.0, s["temp"] - TEMP_NEUTRE))  # noqa: E731
        altitude = {"n": len(haut_), "seuil_m": ALTITUDE_HAUTE, "ecart_bpm": _r(mean(map(res, haut_)) - mean(map(res, bas_)))}
    cout = _r(c, 2)
    if c >= 0.3:
        message = (f"Chaque degré au-dessus de {TEMP_NEUTRE:.0f} °C te coûte environ {str(_r(c)).replace('.', ',')} bpm à allure égale : "
                   f"à 25 °C, compte {round(c * 10)} bpm de plus")
        message += f", ou {perte} s/km de moins pour le même effort." if perte else "."
    elif c > -0.3:
        message = "La chaleur change peu ta FC à allure égale sur les températures que tu as rencontrées."
    else:
        message = "Pas d'effet mesurable de la chaleur pour l'instant : trop peu de sorties vraiment chaudes."
    return {**base, "suffisant": True, "n_chaud": len(chaud), "cout_bpm_par_degre": cout,
            "bpm_par_kmh": _r(b), "bpm_a_25": round(c * 10) if c > 0 else 0, "perte_allure_25": perte,
            "allure_moy": round(3600 / v_moy), "tranches": tranches, "points": points, "altitude": altitude,
            "message": message}


# ---------------------------------------------------------------------------
# 1.12 Tendances longues : moyenne par saison, tendance annuelle
# ---------------------------------------------------------------------------

SAISONS = ["Hiver", "Printemps", "Été", "Automne"]
SAISONS_COURT = ["Hiv.", "Print.", "Été", "Aut."]
METRIQUES_LONGUES = [   # (clé, libellé, unité, décimales, sens : +1 = plus haut est mieux, 0 = neutre, minimum de mesures)
    ("fc_repos", "FC au repos", "bpm", 0, -1, 10),
    ("vfc", "VFC", "ms", 0, 1, 10),
    ("vo2max", "VO2max", "ml/kg/min", 1, 1, 5),
    ("poids", "Poids", "kg", 1, 0, 2),
]


def _saison(j: date) -> tuple[int, int]:
    """(année, index de saison) ; décembre compte dans l'hiver de l'année suivante."""
    if j.month == 12:
        return j.year + 1, 0
    return j.year, 0 if j.month <= 2 else 1 if j.month <= 5 else 2 if j.month <= 8 else 3


def _pente(xs: list[float], ys: list[float]) -> Optional[float]:
    if len(xs) < 3 or max(xs) - min(xs) < 0.7:
        return None
    mx, my = mean(xs), mean(ys)
    den = sum((x - mx) ** 2 for x in xs)
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den if den else None


def tendances_longues(db: Session, user_id: int, auj: date) -> dict:
    series: dict[str, dict[date, float]] = defaultdict(dict)
    for m in db.query(MesureSante).filter(MesureSante.utilisateur_id == user_id,
                                          MesureSante.type.in_(("fc_repos", "vfc", "vo2max")), MesureSante.jour <= auj):
        series[m.type][m.jour] = m.valeur
    for p in db.query(PoidsUtilisateur).filter(PoidsUtilisateur.utilisateur_id == user_id):
        if p.enregistre_le:
            series["poids"][p.enregistre_le.date()] = p.poids_kg
    out = []
    for cle, label, unite, dec, sens, mini in METRIQUES_LONGUES:
        groupes: dict[tuple[int, int], list[float]] = defaultdict(list)
        for j, v in series.get(cle, {}).items():
            groupes[_saison(j)].append(v)
        saisons = [{"cle": f"{an}-{s}", "annee": an, "saison": s, "label": f"{SAISONS[s]} {an}",
                    "court": f"{SAISONS_COURT[s]} {str(an)[2:]}", "moy": _r(mean(v), dec), "n": len(v),
                    "x": an + s / 4}
                   for (an, s), v in sorted(groupes.items()) if len(v) >= mini]
        if len(saisons) < 2:
            continue
        pente = _pente([s["x"] for s in saisons], [s["moy"] for s in saisons])
        # Même saison un an plus tôt : la comparaison qui neutralise l'effet de la saison
        der = saisons[-1]
        avant = next((s for s in saisons if s["saison"] == der["saison"] and s["annee"] == der["annee"] - 1), None)
        out.append({"cle": cle, "label": label, "unite": unite, "decimales": dec, "sens": sens,
                    "saisons": [{k: v for k, v in s.items() if k != "x"} for s in saisons],
                    "tendance_an": _r(pente, 2 if abs(pente or 0) < 1 else 1),
                    "sur_un_an": _r(der["moy"] - avant["moy"], dec) if avant else None,
                    "min": min(s["moy"] for s in saisons), "max": max(s["moy"] for s in saisons)})
    return {"metriques": out}


# ---------------------------------------------------------------------------
# Assemblage
# ---------------------------------------------------------------------------

def _seance_cle(db: Session, user: Utilisateur, auj: date) -> Optional[dict]:
    import suivi_service as sv   # import local : suivi_service s'appuie sur les analyses
    prevues = (db.query(SeancePrevue)
               .filter(SeancePrevue.utilisateur_id == user.id, SeancePrevue.jour > auj,
                       SeancePrevue.jour <= auj + timedelta(days=3), SeancePrevue.activite_id.is_(None),
                       SeancePrevue.statut != "sautee")
               .order_by(SeancePrevue.jour, SeancePrevue.ordre, SeancePrevue.id).all())
    p = next((p for p in prevues if sv._intensite(p) >= 6), None)
    return {"jour": p.jour.isoformat(), "titre": p.titre} if p else None


def calculer(db: Session, user: Utilisateur, acts: list[Activite], mesures: dict[str, dict[date, float]],
             marqueurs: dict[date, list[str]], recuperation: dict, sommeil: dict, auj: date,
             recuperation_longue: Optional[dict] = None) -> dict:
    import corps_service as co
    exclus = co.jours_exclus(marqueurs)
    jours = classer_jours(acts, auj - timedelta(days=400))
    scores = {date.fromisoformat(p["jour"]): p["score"] for p in (recuperation_longue or recuperation)["points"]}
    sorties, manquantes = sorties_meteo(db, user.id, acts, auj)
    return {
        "vfc_tendance": tendance_vfc(mesures.get("vfc", {}), recuperation["points"], auj),
        "chronotype": chronotype(mesures, sommeil["besoin_h"], sommeil.get("dette_7j"), auj, _seance_cle(db, user, auj)),
        "effet_nuit": effet_nuit(jours, mesures, exclus, auj),
        "temps_recuperation": temps_recuperation(jours, scores, exclus, auj),
        "chaleur": chaleur(sorties, manquantes),
        "tendances": tendances_longues(db, user.id, auj),
    }


def resume(c: Optional[dict]) -> Optional[dict]:
    """Version compacte pour l'export lu par le plan hebdomadaire."""
    if not c:
        return None
    v, ch, e, t, h = (c.get(k) for k in ("vfc_tendance", "chronotype", "effet_nuit", "temps_recuperation", "chaleur"))
    return {
        "vfc_7j": v and {k: v[k] for k in ("moy7", "plage", "cv7", "cv_habituel", "message")},
        "sommeil_fenetre": ch and {"coucher_habituel": cs_heure(ch["tout"]["coucher"]), "lever_habituel": cs_heure(ch["tout"]["lever"]),
                                   "chronotype": ch["chronotype_label"], "jetlag_social_min": ch["jetlag_min"],
                                   "conseil": ch["conseil"]},
        "effet_seances_sur_nuit": e and {"phrase": e["phrase"], "lignes": [
            {k: l[k] for k in ("label", "n", "vfc", "fc_nuit", "profond")} for l in e["lignes"]]},
        "temps_recuperation": t and {"message": t["message"], "types": [
            {k: x[k] for k in ("label", "n", "moyenne", "mediane")} for x in t["types"]]},
        "chaleur": h["message"] if h and h.get("suffisant") else None,
    }


def markdown(r: Optional[dict]) -> list[str]:
    """Lignes de l'export à partir de `resume()`."""
    if not r or not any(r.values()):
        return []
    l = ["## Corps sur la durée (appris sur l'historique)", ""]
    v = r.get("vfc_7j")
    if v:
        l.append(f"- VFC, moyenne 7 j : {v['moy7']} ms (plage normale {v['plage'][0]}–{v['plage'][1]}), "
                 f"variabilité {v['cv7']} % (habituelle {v['cv_habituel'] or '—'} %). {v['message']}")
    s = r.get("sommeil_fenetre")
    if s:
        l.append(f"- Fenêtre de sommeil : coucher {s['coucher_habituel']}, lever {s['lever_habituel']} · {s['chronotype'].lower()}"
                 + (f" · décalage du week-end {s['jetlag_social_min']:+d} min" if s.get("jetlag_social_min") is not None else "")
                 + f". {s['conseil']}")
    e = r.get("effet_seances_sur_nuit")
    if e:
        if e.get("phrase"):
            l.append(f"- Effet des séances sur la nuit suivante : {e['phrase']}")
        for x in e["lignes"]:
            det = [f"{lab} {x[k]:+.1f} {u}" for k, lab, u in (("vfc", "VFC", "ms"), ("fc_nuit", "FC de nuit", "bpm"),
                                                              ("profond", "sommeil profond", "min")) if x.get(k) is not None]
            if det:
                l.append(f"  - {x['label']} ({x['n']} nuits) : " + ", ".join(det))
    t = r.get("temps_recuperation")
    if t:
        l.append("- Temps de récupération personnel (retour de la VFC et de la FC de repos dans la normale) : "
                 + " ; ".join(f"{x['label'].lower()} {str(x['moyenne']).replace('.', ',')} j en moyenne ({x['n']} fois)" for x in t["types"]))
    if r.get("chaleur"):
        l.append(f"- Chaleur : {r['chaleur']}")
    l.append("")
    return l
