"""
Capacités, suite : courbe allure–durée complète, profil de vitesse, équilibre des charges,
aptitude en montée et en descente, seuil aérobie, repères par âge et données du simulateur « et si ».

Tout part de ce que le carnet a déjà : meilleurs efforts de chaque tracé (`details.efforts`),
dérive cardiaque des sorties longues, mesures de la montre, plan des semaines à venir.
Résultats ajoutés à `res["capacites"]` de `analyses_service.calculer_analyses`.
"""
from collections import defaultdict
from datetime import date, timedelta
from statistics import median
from typing import Optional

from sqlalchemy.orm import Session

import carnet_service as cs
from models import Activite, Objectif, SeancePrevue, Utilisateur

SAISON_J = 365
RECENT_J = 90

DUREES = [(10, "10 s"), (20, "20 s"), (30, "30 s"), (60, "1 min"), (120, "2 min"), (180, "3 min"), (300, "5 min"),
          (600, "10 min"), (1200, "20 min"), (1800, "30 min"), (3600, "1 h"), (5400, "1 h 30"), (7200, "2 h"),
          (10800, "3 h")]


def _r(x, n=1):
    return None if x is None else round(x, n)


def _fr(x: float, n: int = 1) -> str:
    s = f"{x:.{n}f}"
    if n and s.endswith("0" * n):
        s = s[:-n - 1]
    return s.replace(".", ",")


def _mmss(sec) -> str:
    sec = int(round(sec))
    return f"{sec // 60}:{sec % 60:02d}"


def _efforts(a: Activite) -> dict:
    return cs._details_dict(a).get("efforts") or {}


# ---------------------------------------------------------------------------
# 2.5 Courbe allure–durée, de 10 s à 3 h
# ---------------------------------------------------------------------------

def _par_duree(a: Activite) -> dict[int, float]:
    """Meilleure distance (m) de la séance sur chaque durée (s)."""
    eff = _efforts(a)
    out = {}
    for m, metres in (eff.get("d") or {}).items():
        if str(m).isdigit() and metres:
            out[int(m) * 60] = float(metres)
    for s, metres in (eff.get("s") or {}).items():
        if str(s).isdigit() and metres:
            out[int(s)] = float(metres)
    return out


def _meilleurs(pts: list, debut: date, fin: date) -> dict[int, tuple]:
    """Meilleure distance par durée sur ]debut, fin]. Une durée plus courte ne peut pas être plus lente
    qu'une durée plus longue : si c'est le cas (tracé peu dense), on reprend l'effort long."""
    out: dict[int, tuple] = {}
    for j, sec, metres, a in pts:
        if debut < j <= fin and (sec not in out or metres > out[sec][0]):
            out[sec] = (metres, j, a)
    secs = sorted(out, reverse=True)
    for long, court in zip(secs, secs[1:]):
        v_long = out[long][0] / long
        if out[court][0] / court < v_long:
            out[court] = (v_long * court, out[long][1], out[long][2])
    return out


def _fiche_effort(sec: int, e: Optional[tuple]) -> Optional[dict]:
    if not e:
        return None
    metres, j, a = e
    v = metres / sec
    return {"kmh": round(v * 3.6, 2), "allure_sec_km": round(1000 / v), "metres": round(metres),
            "date": j.isoformat(), "activite_id": a.id, "titre": a.titre}


def courbe(acts: list[Activite], efforts: dict, auj: date) -> dict:
    pts = []
    for a in acts:
        if a.sport in cs.SPORTS_PIED:
            for sec, metres in _par_duree(a).items():
                pts.append((a.debut.date(), sec, metres, a))
    saison = _meilleurs(pts, auj - timedelta(days=SAISON_J), auj)
    avant = _meilleurs(pts, auj - timedelta(days=2 * SAISON_J), auj - timedelta(days=SAISON_J))
    record = _meilleurs(pts, date.min, auj)
    recent = _meilleurs(pts, auj - timedelta(days=RECENT_J), auj)
    vc = efforts.get("vc")
    points, non_testees, jamais = [], [], []
    for sec, label in DUREES:
        ref = saison.get(sec) or record.get(sec)
        teste = bool(ref and recent.get(sec) and recent[sec][0] >= 0.93 * ref[0])
        if not record.get(sec):
            jamais.append(label)
        elif not teste:
            non_testees.append(label)
        modele = None
        if vc and 120 <= sec <= 1800:
            modele = round((vc["vitesse_ms"] + vc["dprime_m"] / sec) * 3.6, 2)
        points.append({"sec": sec, "label": label, "saison": _fiche_effort(sec, saison.get(sec)),
                       "precedente": _fiche_effort(sec, avant.get(sec)), "record": _fiche_effort(sec, record.get(sec)),
                       "recent": _fiche_effort(sec, recent.get(sec)), "teste": teste, "modele_kmh": modele})
    # Progression de la saison par rapport à la précédente, là où les deux existent
    ecarts = [(p["saison"]["kmh"] / p["precedente"]["kmh"] - 1) * 100
              for p in points if p["saison"] and p["precedente"]]
    return {"points": points if any(p["record"] for p in points) else [],
            "modele": vc and {"allure_sec_km": vc["allure_sec_km"], "dprime_m": vc["dprime_m"]},
            "non_testees": non_testees, "jamais": jamais,
            "progression_pct": _r(sum(ecarts) / len(ecarts)) if ecarts else None,
            "a_precedente": bool(avant)}


# ---------------------------------------------------------------------------
# 2.6 Profil de vitesse : réserve de vitesse anaérobie
# ---------------------------------------------------------------------------

IMPLICATIONS = {
    "endurant": ["Ton point fort est de durer : les longues répétitions (1000 m, seuil, tempo) te conviennent.",
                 "Les fractions très courtes (200–300 m) te coûtent cher : garde-les rares, avec de longues récupérations.",
                 "Pour gagner en aisance, ajoute des lignes droites et des côtes courtes (8 à 10 s) en fin de footing."],
    "equilibre": ["Profil polyvalent : tu peux alterner séances courtes et longues sans point faible marqué.",
                  "Répartis le travail : une séance de VMA courte et une séance au seuil se complètent bien.",
                  "Des lignes droites régulières entretiennent ta vitesse sans fatigue."],
    "rapide": ["Ta vitesse est ton atout : les fractions courtes (200–400 m) passent bien.",
               "Le temps soutenu est ton chantier : seuil, tempo et sorties longues progressives.",
               "Allonge les répétitions peu à peu plutôt que d'accélérer encore celles que tu maîtrises."],
}
TYPES = {"endurant": "Plutôt endurant", "equilibre": "Équilibré", "rapide": "Plutôt rapide"}


def vitesse(acts: list[Activite], vma: dict, auj: date) -> dict:
    vma_kmh = (vma.get("actuelle") or {}).get("vma")
    debut = auj - timedelta(days=SAISON_J)
    meilleurs: dict[int, tuple] = {}
    for a in acts:
        if a.sport in cs.SPORTS_PIED and a.debut.date() > debut:
            for sec, metres in _par_duree(a).items():
                if sec <= 60 and (sec not in meilleurs or metres > meilleurs[sec][0]):
                    meilleurs[sec] = (metres, a)
    source = next((s for s in (10, 20, 30, 60) if s in meilleurs), None)
    if not vma_kmh or not source:
        return {"disponible": False,
                "raison": "Il faut une VMA estimée et au moins une séance de course avec tracé GPS sur les 12 derniers mois."}
    metres, a = meilleurs[source]
    vmax = metres / source * 3.6
    v60 = meilleurs[60][0] / 60 * 3.6 if 60 in meilleurs else None
    # Sprint franc : la vitesse sur 10–20 s se détache nettement de celle tenue 1 min
    franc = source <= 20 and vmax >= vma_kmh * 1.2 and (v60 is None or vmax >= v60 * 1.12)
    ratio = vmax / vma_kmh
    cle = "endurant" if ratio < 1.45 else "equilibre" if ratio < 1.6 else "rapide"
    label_source = {10: "10 s", 20: "20 s", 30: "30 s", 60: "1 min"}[source]
    if franc:
        note = None
    elif source > 20:
        note = (f"Vitesse max prise sur {label_source}, faute d'effort plus court dans tes tracés : elle est "
                "sous-estimée et le profil penche artificiellement vers « endurant ».")
    else:
        note = ("Aucun sprint franc dans tes tracés des 12 derniers mois : la vitesse max est sans doute "
                "sous-estimée. Trois lignes droites lancées de 10 s à fond, bien échauffé, suffisent à la mesurer.")
    return {
        "disponible": True, "vmax_kmh": round(vmax, 1), "vma_kmh": round(vma_kmh, 1),
        "reserve_kmh": round(vmax - vma_kmh, 1), "ratio": round(ratio, 2),
        "type": cle, "type_label": TYPES[cle], "fiable": franc, "note": note,
        "source": label_source, "date": a.debut.date().isoformat(), "activite_id": a.id, "titre": a.titre,
        "allure_vmax": _mmss(3600 / vmax), "position_pct": round(min(100, max(0, (ratio - 1.2) / 0.7 * 100))),
        "implications": IMPLICATIONS[cle],
    }


# ---------------------------------------------------------------------------
# 2.8 Équilibre des charges : par discipline, jambes contre cœur
# ---------------------------------------------------------------------------

SPORTS_IMPACT = cs.SPORTS_PIED | {"randonnee"}


def _dmoins(a: Activite) -> tuple[float, bool]:
    """D− de la séance (m) et s'il est estimé (pris égal au D+, faute de tracé)."""
    d = _efforts(a).get("dmoins")
    if d is None:
        d = cs._details_dict(a).get("dmoins_m")
    if d is not None:
        return float(d), False
    return float(a.dplus_m or 0), bool(a.dplus_m)


def charges(acts: list[Activite], auj: date, blocs: int = 12) -> dict:
    debut = auj - timedelta(days=7 * blocs)
    sem = [{"debut": (auj - timedelta(days=7 * (blocs - k) - 1)).isoformat(),
            "fin": (auj - timedelta(days=7 * (blocs - k - 1))).isoformat(),
            "course": 0.0, "muscu": 0.0, "autre": 0.0, "km": 0.0, "dmoins": 0.0} for k in range(blocs)]
    estime = False
    for a in acts:
        j = a.debut.date()
        if not debut < j <= auj:
            continue
        s = sem[blocs - 1 - (auj - j).days // 7]
        c = cs.charge(a)
        s["course" if a.sport in cs.SPORTS_PIED else "muscu" if a.sport == "muscu" else "autre"] += c
        if a.sport in SPORTS_IMPACT:
            s["km"] += a.distance_km or 0
            d, est = _dmoins(a)
            s["dmoins"] += d
            estime = estime or est
    for s in sem:
        s["meca"] = s["km"] + s["dmoins"] / 100
        s["cardio"] = s["course"] + s["autre"]
    if not any(s["course"] + s["muscu"] + s["autre"] for s in sem):
        return {"semaines": []}

    def moyenne(cle, lot):
        return sum(x[cle] for x in lot) / len(lot) if lot else 0

    base_m, base_c = moyenne("meca", sem[:-1]), moyenne("cardio", sem[:-1])
    for s in sem:
        s["idx_meca"] = round(s["meca"] / base_m * 100) if base_m else None
        s["idx_cardio"] = round(s["cardio"] / base_c * 100) if base_c else None
        for k in ("course", "muscu", "autre", "dmoins"):
            s[k] = round(s[k])
        s["km"], s["meca"], s["cardio"] = round(s["km"], 1), round(s["meca"], 1), round(s["cardio"])
    der, avant = sem[-1], sem[-5:-1]
    hab_m, hab_c = moyenne("meca", avant), moyenne("cardio", avant)
    r_m = der["meca"] / hab_m if hab_m else None
    r_c = der["cardio"] / hab_c if hab_c else None
    tot4 = {k: sum(x[k] for x in sem[-4:]) for k in ("course", "muscu", "autre")}
    total = sum(tot4.values())
    parts = {k: round(v / total * 100) for k, v in tot4.items()} if total else None

    ton, texte = "", None
    if r_m is not None and r_c is not None:
        pm, pc = round((r_m - 1) * 100), round((r_c - 1) * 100)
        signe = lambda p: f"{'+' if p >= 0 else '−'}{abs(p)} %"
        if r_m >= 1.3 and r_m - r_c >= 0.2:
            ton, texte = "alerte", (f"Tes jambes ont encaissé {signe(pm)} par rapport à ton habitude, pour une charge cardiaque à "
                                    f"{signe(pc)}. Les tendons s'adaptent plus lentement que le cœur : garde la semaine "
                                    "suivante plus plate ou plus courte.")
        elif r_c >= 1.3 and r_m <= 1.1:
            ton, texte = "bien", (f"Charge cardiaque à {signe(pc)} sans surcroît pour les jambes ({signe(pm)}) : "
                                  "tu as monté le volume par des séances sans impact.")
        elif r_m <= 0.6 and r_c <= 0.6:
            texte = f"Semaine légère : jambes à {signe(pm)}, cœur à {signe(pc)} par rapport à ton habitude."
        else:
            texte = (f"Sur 7 jours : jambes à {signe(pm)}, cœur à {signe(pc)} par rapport à ta moyenne des 4 semaines "
                     "précédentes. Les deux évoluent ensemble.")
    return {"semaines": sem, "parts": parts, "dmoins_estime": estime,
            "dernier": {"km": der["km"], "dmoins": der["dmoins"], "meca": der["meca"], "cardio": der["cardio"],
                        "habitude_meca": _r(hab_m), "habitude_cardio": round(hab_c) if hab_c else None,
                        "ecart_meca_pct": round((r_m - 1) * 100) if r_m is not None else None,
                        "ecart_cardio_pct": round((r_c - 1) * 100) if r_c is not None else None},
            "message": texte and {"ton": ton, "texte": texte}}


# ---------------------------------------------------------------------------
# 2.9 Aptitude en montée et en descente
# ---------------------------------------------------------------------------

CLASSES = [("m3", "Montée raide", "15 % et plus"), ("m2", "Montée", "8 à 15 %"), ("m1", "Faux plat montant", "3 à 8 %"),
           ("p", "Plat", "−3 à +3 %"), ("d1", "Faux plat descendant", "3 à 8 %"), ("d2", "Descente", "8 à 15 %"),
           ("d3", "Descente raide", "15 % et plus")]
DUREES_VAM = [(5, "5 min"), (10, "10 min"), (20, "20 min"), (30, "30 min"), (60, "1 h")]


def _agrege_pentes(acts: list[Activite], debut: date, fin: date) -> dict:
    tot = {c: [0.0, 0.0, 0.0] for c, _, _ in CLASSES}
    for a in acts:
        if a.sport in cs.SPORTS_PIED and debut < a.debut.date() <= fin:
            for c, v in (_efforts(a).get("pentes") or {}).items():
                if c in tot and isinstance(v, list) and len(v) == 3:
                    for i in range(3):
                        tot[c][i] += v[i]
    return tot


def _stat_pente(v: list, plat: list, mini_m: float) -> Optional[dict]:
    dist, t, dz = v
    if dist < mini_m or t <= 0:
        return None
    out = {"km": round(dist / 1000, 1), "allure_sec_km": round(t / (dist / 1000)), "kmh": round(dist / t * 3.6, 1),
           "vv_mh": round(dz / t * 3600), "rel_pct": None}
    if plat[0] >= 1000 and plat[1] > 0:
        out["rel_pct"] = round((dist / t) / (plat[0] / plat[1]) * 100)
    return out


def pentes(acts: list[Activite], auj: date) -> dict:
    recent = _agrege_pentes(acts, auj - timedelta(days=RECENT_J), auj)
    ref = _agrege_pentes(acts, auj - timedelta(days=SAISON_J), auj)
    classes = []
    for c, label, pente in CLASSES:
        r, f = _stat_pente(recent[c], recent["p"], 500), _stat_pente(ref[c], ref["p"], 1000)
        ecart = r["rel_pct"] - f["rel_pct"] if r and f and r["rel_pct"] and f["rel_pct"] and c != "p" else None
        classes.append({"cle": c, "label": label, "pente": pente, "sens": "plat" if c == "p" else "montee" if c[0] == "m" else "descente",
                        "recent": r, "ref": f, "ecart": ecart})
    # Meilleure montée par durée : saison contre record
    vam = []
    debut = auj - timedelta(days=SAISON_J)
    for m, label in DUREES_VAM:
        saison = rec = None
        for a in acts:
            if a.sport not in SPORTS_IMPACT:
                continue
            v = (_efforts(a).get("vam_d") or {}).get(str(m))
            if not v:
                continue
            e = {"mh": v, "date": a.debut.date().isoformat(), "activite_id": a.id, "titre": a.titre}
            if rec is None or v > rec["mh"]:
                rec = e
            if a.debut.date() > debut and (saison is None or v > saison["mh"]):
                saison = e
        if rec:
            vam.append({"minutes": m, "label": label, "saison": saison, "record": rec})
    if not any(x["ref"] for x in classes if x["cle"] != "p") and not vam:
        return {"classes": [], "vam": [], "messages": []}

    messages = []
    par = {x["cle"]: x for x in classes}
    montee = [x["ecart"] for x in classes if x["sens"] == "montee" and x["ecart"] is not None]
    descente = [x["ecart"] for x in classes if x["sens"] == "descente" and x["ecart"] is not None]
    if montee and sum(montee) / len(montee) >= 3:
        messages.append({"ton": "bien", "texte": "Ces 3 derniers mois, tu perds moins de vitesse en montée que sur l'année : tu grimpes mieux."})
    elif montee and sum(montee) / len(montee) <= -3:
        messages.append({"ton": "", "texte": "Ces 3 derniers mois, tu perds plus de vitesse en montée que sur l'année : fatigue, ou des sorties plus faciles en côte."})
    if descente and sum(descente) / len(descente) >= 3:
        messages.append({"ton": "bien", "texte": "Tu descends plus vite qu'en moyenne sur l'année."})
    d1 = (par["d1"]["ref"] or {}).get("rel_pct")
    d2 = (par["d2"]["ref"] or {}).get("rel_pct")
    if d2 is not None and d2 < 95:
        messages.append({"ton": "", "texte": f"En descente (8 à 15 %), tu vas à {d2} % de ta vitesse sur le plat : il y a de la marge "
                                             "technique (regard loin, pas courts et rapides, buste légèrement en avant)."})
    elif d1 is not None and d1 < 102:
        messages.append({"ton": "", "texte": "En faux plat descendant tu ne vas pas plus vite que sur le plat : tu te retiens. "
                                             "Laisser dérouler y fait gagner du temps sans effort."})
    return {"classes": classes, "vam": vam, "messages": messages}


# ---------------------------------------------------------------------------
# 2.10 Seuil aérobie par la dérive cardiaque
# ---------------------------------------------------------------------------

DERIVE_STABLE = 5.0


def _centile(xs: list[float], q: float) -> float:
    xs = sorted(xs)
    pos = (len(xs) - 1) * q
    bas = int(pos)
    haut = min(bas + 1, len(xs) - 1)
    return xs[bas] + (xs[haut] - xs[bas]) * (pos - bas)


def seuil_aerobie(acts: list[Activite], zones: Optional[dict], user: Utilisateur, auj: date) -> dict:
    debut = auj - timedelta(days=SAISON_J)
    pts = []
    for a in acts:
        if a.sport not in cs.SPORTS_PIED or a.debut.date() <= debut or not a.fc_moyenne_bpm:
            continue
        d = cs._details_dict(a).get("derive_fc")
        if d is None or not a.duree_sec or a.duree_sec < 40 * 60:
            continue
        if a.distance_km and (a.dplus_m or 0) / a.distance_km >= 25:
            continue        # trop vallonné : la dérive mesure le relief, pas l'endurance
        pts.append({"date": a.debut.date().isoformat(), "fc": a.fc_moyenne_bpm, "derive_pct": d,
                    "duree_min": round(a.duree_sec / 60), "activite_id": a.id, "titre": a.titre,
                    "stable": d < DERIVE_STABLE})
    stables = [p["fc"] for p in pts if p["stable"]]
    z2 = None
    for z in (zones or {}).get("zones") or []:
        if z.get("zone") == 2:
            z2 = z.get("fc_max")
    out = {"points": pts, "nb": len(pts), "nb_stables": len(stables), "seuil_derive": DERIVE_STABLE, "z2_max": z2,
           "fc": None}
    if len(stables) < 3:
        out["raison"] = ("Il faut au moins 3 sorties régulières de 40 min et plus dont la dérive reste sous 5 %"
                         f" (tu en as {len(stables)} sur 12 mois). Une sortie longue à allure constante, sur le plat, suffit à en ajouter une.")
        return out
    fc = round(_centile(stables, 0.8))
    au_dessus = [p for p in pts if not p["stable"] and p["fc"] >= fc]
    contredit = [p for p in pts if not p["stable"] and p["fc"] < fc - 3]
    borne = not au_dessus
    confiance = "haute" if len(stables) >= 8 and not borne and len(contredit) <= len(stables) / 2 else \
        "moyenne" if len(stables) >= 4 else "faible"
    out.update({"fc": fc, "borne_basse": borne, "confiance": confiance, "nb_contredit": len(contredit),
                "pct_fc_max": round(fc / user.fc_max * 100) if user.fc_max else None})
    if z2:
        e = z2 - fc
        if e >= 5:
            out["message"] = {"ton": "alerte", "texte": f"Ta zone 2 monte jusqu'à {z2} bpm, mais tes sorties ne restent stables que jusqu'à "
                                                        f"{fc} bpm environ. Pour les sorties longues, vise plutôt sous {fc} bpm."}
        elif e <= -5 and not borne:
            out["message"] = {"ton": "bien", "texte": f"Tu restes stable jusqu'à {fc} bpm, au-dessus du haut de ta zone 2 ({z2} bpm) : "
                                                      "ton endurance de base est solide, la zone 2 a de la marge."}
        else:
            out["message"] = {"ton": "bien" if not borne else "", "texte": f"Ton seuil aérobie estimé ({fc} bpm) colle au haut de ta zone 2 ({z2} bpm) : "
                                                                          "tes zones sont bien calées pour l'endurance."}
    if borne:
        out["note"] = (f"Aucune sortie longue plus soutenue que {fc} bpm n'a dérivé : ton seuil aérobie est au moins à ce niveau, "
                       "peut-être plus haut.")
    return out


# ---------------------------------------------------------------------------
# 2.11 Repères par âge (un repère, pas une note)
# ---------------------------------------------------------------------------

# VO2max (ml/kg/min) par décennie, centiles 5, 10, 25, 50, 75, 90, 95 — registre FRIEND
# (tests d'effort sur tapis, États-Unis ; Kaminsky et al., 2015).
CENTILES = [5, 10, 25, 50, 75, 90, 95]
VO2_REF = {
    "homme": {20: [29.0, 32.1, 40.1, 48.0, 55.2, 61.8, 66.3], 30: [27.2, 30.2, 35.9, 42.4, 49.2, 56.5, 59.8],
              40: [24.2, 26.8, 31.9, 37.8, 45.0, 52.1, 55.6], 50: [20.9, 22.8, 27.1, 32.6, 39.7, 45.6, 50.7],
              60: [17.4, 19.8, 23.7, 28.2, 34.5, 40.3, 43.0], 70: [16.3, 17.1, 20.4, 24.4, 30.4, 36.6, 39.7]},
    "femme": {20: [21.7, 23.9, 30.5, 37.6, 44.7, 51.3, 56.0], 30: [19.0, 20.9, 25.3, 30.2, 36.1, 41.4, 45.8],
              40: [17.0, 18.8, 22.1, 26.7, 32.4, 38.4, 41.7], 50: [16.0, 17.3, 19.9, 23.4, 27.6, 32.0, 35.9],
              60: [13.4, 14.6, 17.2, 20.0, 23.8, 27.0, 29.4], 70: [13.1, 13.6, 15.6, 18.3, 20.8, 23.1, 24.1]},
}
RECORD_10K = {"homme": 1584, "femme": 1726}          # record du monde sur route (s)
PELOTON_10K = {"homme": (55, 60), "femme": (63, 68)}  # médiane des pelotons, ordre de grandeur (min)


def _sexe(user: Utilisateur) -> Optional[str]:
    s = (user.sexe or "").strip().lower()
    return "homme" if s[:1] in ("m", "h") else "femme" if s[:1] == "f" else None


def _centile_vo2(v: float, table: list[float]) -> int:
    if v <= table[0]:
        return 5
    if v >= table[-1]:
        return 95
    for (c0, v0), (c1, v1) in zip(zip(CENTILES, table), zip(CENTILES[1:], table[1:])):
        if v0 <= v <= v1:
            return round(c0 + (c1 - c0) * (v - v0) / (v1 - v0))
    return 50


def _age_forme(v: float, ref: dict) -> tuple[int, Optional[str]]:
    """Âge auquel la médiane vaut `v` (interpolation entre les milieux de décennie)."""
    ages = [(d + 5, ref[d][3]) for d in sorted(ref)]
    if v >= ages[0][1]:
        return 25, "min"
    if v <= ages[-1][1]:
        return 75, "max"
    for (a0, m0), (a1, m1) in zip(ages, ages[1:]):
        if m1 <= v <= m0:
            return round(a0 + (a1 - a0) * (m0 - v) / (m0 - m1)), None
    return 50, None


def reperes(user: Utilisateur, acts: list[Activite], mesures: dict, vma: dict, auj: date) -> dict:
    sexe = _sexe(user)
    age = None
    if user.date_naissance:
        n = user.date_naissance
        age = auj.year - n.year - ((auj.month, auj.day) < (n.month, n.day))
    lignes = []

    # VO2max
    serie = {j: v for j, v in (mesures.get("vo2max") or {}).items() if j > auj - timedelta(days=60)}
    vo2, source = None, None
    if serie:
        vo2, source = median([v for j, v in sorted(serie.items())[-14:]]), "mesure de ta montre"
    elif (vma.get("actuelle") or {}).get("vma"):
        vo2, source = 3.5 * vma["actuelle"]["vma"], "estimée depuis ta VMA (3,5 × VMA)"
    if vo2 and sexe and age:
        ref = VO2_REF[sexe]
        dec = min(70, max(20, age // 10 * 10))
        table = ref[dec]
        c = _centile_vo2(vo2, table)
        af, borne = _age_forme(vo2, ref)
        niveau = "très élevé" if c >= 90 else "élevé" if c >= 75 else "au-dessus de la médiane" if c >= 50 else \
            "sous la médiane" if c >= 25 else "bas"
        texte_c = "au-dessus de 95 % des" if c >= 95 else "sous 95 % des" if c <= 5 else f"au-dessus d'environ {c} % des"
        lignes.append({
            "cle": "vo2max", "label": "VO2max", "valeur": f"{_fr(vo2)} ml/kg/min", "source": source,
            "niveau": niveau, "centile": c, "mediane": table[3], "bornes": [table[0], table[-1]],
            "valeur_num": round(vo2, 1),
            "texte": f"Médiane {('des hommes' if sexe == 'homme' else 'des femmes')} de {dec} à {dec + 9} ans : {_fr(table[3])}. "
                     f"Tu es {texte_c} personnes de ton âge.",
            "age_forme": af, "age_borne": borne,
        })

    # FC de repos
    fcr = user.fc_repos
    recents = [v for j, v in (mesures.get("fc_repos") or {}).items() if j > auj - timedelta(days=30)]
    if recents:
        fcr = round(median(recents))
    if fcr:
        niveau = "celle d'une personne très entraînée en endurance" if fcr < 50 else "celle d'une personne bien entraînée" if fcr < 60 else \
            "dans la moyenne des adultes" if fcr < 72 else "plutôt haute" if fcr < 82 else "haute"
        lignes.append({"cle": "fc_repos", "label": "FC de repos", "valeur": f"{fcr} bpm", "valeur_num": fcr,
                       "source": "médiane des 30 derniers jours" if recents else "valeur du Profil",
                       "niveau": niveau, "echelle": [40, 50, 60, 72, 82, 95],
                       "texte": "Repères : 60 à 80 bpm chez la plupart des adultes, 40 à 60 chez les sportifs d'endurance. "
                                "Elle baisse avec l'entraînement, peu avec l'âge."})

    # 10 km
    meilleur = None
    for a in acts:
        if a.sport in cs.SPORTS_PIED and a.debut.date() > auj - timedelta(days=SAISON_J):
            t = _efforts(a).get("10 km")
            if t and (meilleur is None or t < meilleur[0]):
                meilleur = (t, a)
    if meilleur and sexe:
        t, a = meilleur
        facteur = 1.0 if not age or age <= 35 else max(0.5, 1 - 0.0073 * (age - 35))
        pct = round(RECORD_10K[sexe] / (t * facteur) * 100)
        niveau = "niveau national" if pct >= 80 else "niveau régional" if pct >= 70 else "bon niveau de club" if pct >= 60 else \
            "coureur régulier" if pct >= 50 else "niveau loisir"
        bas, haut = PELOTON_10K[sexe]
        pos = "plus rapide que la médiane des pelotons" if t < bas * 60 else "plus lent que la médiane des pelotons" \
            if t > haut * 60 else "dans la médiane des pelotons"
        lignes.append({"cle": "dix_km", "label": "10 km", "valeur": cs.fmt_duree(t), "valeur_num": t,
                       "source": f"ton meilleur 10 km des 12 derniers mois ({a.debut.date().strftime('%d/%m/%Y')})",
                       "niveau": niveau, "pct_age": pct, "activite_id": a.id,
                       "texte": f"{pct} % du record du monde" + (", corrigé de l'âge" if facteur < 1 else "")
                                + f". Tu es {pos} (environ {bas} à {haut} min, tous âges)."})

    manque = None
    if not sexe or not age:
        manque = "Renseigne ta date de naissance et ton sexe dans le Profil pour situer ta VO2max et ton 10 km."
    return {"age": age, "sexe": sexe, "lignes": lignes, "manque": manque}


# ---------------------------------------------------------------------------
# 2.12 Simulateur « et si » : données de départ (la projection se fait à l'écran)
# ---------------------------------------------------------------------------

def simulateur(db: Session, user: Utilisateur, acts: list[Activite], serie: list[dict], objectifs: list[Objectif],
               auj: date) -> dict:
    if not serie:
        return {"disponible": False}
    der = serie[-1]
    plan: dict[date, float] = defaultdict(float)
    seances = db.query(SeancePrevue).filter(SeancePrevue.utilisateur_id == user.id, SeancePrevue.jour >= auj,
                                            SeancePrevue.statut == "prevue", SeancePrevue.activite_id.is_(None)).all()
    for s in seances:
        if s.duree_min:
            plan[s.jour] += s.duree_min * (s.rpe_cible or 5)
    debut = auj - timedelta(days=28)
    habitude = sum(cs.charge(a) for a in acts if debut < a.debut.date() <= auj) / 4
    cible = None
    for o in sorted((o for o in objectifs if o.type == "course" and o.date_cible and auj < o.date_cible
                     <= auj + timedelta(days=365)), key=lambda o: o.date_cible):
        cible = {"titre": o.titre, "jour": o.date_cible.isoformat(), "jours": (o.date_cible - auj).days}
        break
    return {
        "disponible": True, "auj": auj.isoformat(), "ctl": der["ctl"], "atl": der["atl"],
        "plan": [{"jour": j.isoformat(), "charge": round(c)} for j, c in sorted(plan.items())],
        "plan_jusqua": max(plan).isoformat() if plan else None,
        "habitude_hebdo": round(habitude), "objectif": cible,
        "passe": [{"jour": p["jour"], "ctl": p["ctl"], "tsb": p["tsb"]} for p in serie[-28:]],
    }


# ---------------------------------------------------------------------------
# Assemblage et export
# ---------------------------------------------------------------------------

def calculer(db: Session, user: Utilisateur, acts: list[Activite], mesures: dict, vma: dict, efforts: dict,
             zones: Optional[dict], serie: list[dict], objectifs: list[Objectif], auj: date) -> dict:
    return {
        "courbe": courbe(acts, efforts, auj),
        "vitesse": vitesse(acts, vma, auj),
        "charges": charges(acts, auj),
        "pentes": pentes(acts, auj),
        "seuil_aerobie": seuil_aerobie(acts, zones, user, auj),
        "reperes": reperes(user, acts, mesures, vma, auj),
        "simulateur": simulateur(db, user, acts, serie, objectifs, auj),
    }


def resume(c: Optional[dict]) -> Optional[dict]:
    """Synthèse pour l'export lu par le plan hebdomadaire."""
    if not c or "courbe" not in c:
        return None
    v, ch, s, p = c["vitesse"], c["charges"], c["seuil_aerobie"], c["pentes"]
    return {
        "non_testees": c["courbe"]["non_testees"],
        "vitesse": v["disponible"] and {k: v[k] for k in ("vmax_kmh", "vma_kmh", "reserve_kmh", "ratio", "type_label", "fiable")},
        "charges": ch.get("dernier") and {**ch["dernier"], "parts": ch.get("parts"),
                                          "message": (ch.get("message") or {}).get("texte")},
        "seuil_aerobie": s["fc"] and {"fc": s["fc"], "confiance": s["confiance"], "borne_basse": s["borne_basse"],
                                      "z2_max": s["z2_max"], "sorties_stables": s["nb_stables"]},
        "pentes": [{"label": f"{x['label']} ({x['pente']})", "allure": _mmss(x["ref"]["allure_sec_km"]),
                    "rel_pct": x["ref"]["rel_pct"], "km": x["ref"]["km"]} for x in p["classes"] if x["ref"]],
        "vam": [{"duree": x["label"], "saison": (x["saison"] or {}).get("mh"), "record": x["record"]["mh"]} for x in p["vam"]],
    }


def markdown(r: Optional[dict]) -> list[str]:
    if not r:
        return []
    l = []
    v = r["vitesse"]
    if v:
        l.append(f"- Profil de vitesse : {v['type_label'].lower()} (vitesse max {_fr(v['vmax_kmh'])} km/h pour une VMA de "
                 f"{_fr(v['vma_kmh'])}, réserve {_fr(v['reserve_kmh'])} km/h, rapport {_fr(v['ratio'], 2)})"
                 + ("" if v["fiable"] else " — vitesse max sans doute sous-estimée, pas de sprint franc mesuré") + ".")
    s = r["seuil_aerobie"]
    if s:
        l.append(f"- Seuil aérobie (dérive cardiaque < 5 % sur {s['sorties_stables']} sorties longues) : "
                 + ("au moins " if s["borne_basse"] else "environ ") + f"{s['fc']} bpm, confiance {s['confiance']}"
                 + (f" ; haut de la zone 2 actuelle : {s['z2_max']} bpm" if s["z2_max"] else "") + ".")
    ch = r["charges"]
    if ch:
        parts = ch.get("parts")
        l.append(f"- Charge des 7 derniers jours : jambes {_fr(ch['meca'])} km-impact ({_fr(ch['km'])} km, D− {ch['dmoins']} m ; "
                 f"habitude {_fr(ch['habitude_meca'] or 0)}), cœur {ch['cardio']} (habitude {ch['habitude_cardio'] or 0})."
                 + (f" Répartition sur 4 semaines : course {parts['course']} %, musculation {parts['muscu']} %, autre {parts['autre']} %."
                    if parts else "")
                 + (f" {ch['message']}" if ch.get("message") else ""))
    if r["pentes"]:
        l.append("- Allure selon la pente (12 mois, % de la vitesse sur le plat) : "
                 + " ; ".join(f"{x['label']} {x['allure']}/km" + (f" ({x['rel_pct']} %)" if x["rel_pct"] else "") for x in r["pentes"]) + ".")
    if r["vam"]:
        l.append("- Meilleure montée par durée, saison (record) en m/h : "
                 + ", ".join(f"{x['duree']} {x['saison'] or '—'} ({x['record']})" for x in r["vam"]) + ".")
    if r["non_testees"]:
        l.append("- Durées sans effort récent proche du meilleur niveau (90 jours) : " + ", ".join(r["non_testees"]) + ".")
    return l
