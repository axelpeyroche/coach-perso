"""
Prédiction de course (piste 2.4).

Pour chaque objectif « course » à venir : temps estimé à partir de la VMA, de
la loi allure–durée, du profil du parcours lié (allure ajustée à la pente, avec
les facteurs personnels quand ils existent), et d'une marge d'endurance
(durabilité, plus longue sortie récente). Donne une fourchette
optimiste / visée / prudente et un tableau de passage par tronçon.
"""
from __future__ import annotations

import json
import math
from datetime import date, datetime, timedelta
from statistics import median
from typing import Optional

from sqlalchemy.orm import Session

import carnet_service as cs
from decoupage import facteur_pente
from models import Activite, ItineraireFavori, Objectif, Utilisateur

PAS_M = 50
BORNES = [("m3", 0.15, None), ("m2", 0.08, 0.15), ("m1", 0.03, 0.08), ("p", -0.03, 0.03), ("d1", -0.08, -0.03),
          ("d2", -0.15, -0.08), ("d3", None, -0.15)]
LIBELLES = {"m3": "Montée raide", "m2": "Montée", "m1": "Faux plat montant", "p": "Plat", "d1": "Faux plat descendant",
            "d2": "Descente", "d3": "Descente raide"}
COEF_OPTIMISTE = 0.97


def _fr(x: float, n: int = 1) -> str:
    return f"{x:.{n}f}".replace(".", ",")


def _mmss(sec: float) -> str:
    sec = round(sec)
    return f"{sec // 60}:{sec % 60:02d}"


def _hms(sec: float) -> str:
    sec = round(sec)
    h, r = divmod(sec, 3600)
    m, s = divmod(r, 60)
    return f"{h} h {m:02d}" if h else f"{m} min {s:02d}"


def _dist(a: list, b: list) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def _classe(i: float) -> str:
    for c, bas, haut in BORNES:
        if (bas is None or i >= bas) and (haut is None or i < haut):
            return c
    return "p"


def _profil(points: list) -> Optional[dict]:
    """Rééchantillonne le tracé tous les 50 m, lisse l'altitude ; None si l'altitude manque."""
    pts = [p for p in points or [] if isinstance(p, (list, tuple)) and len(p) >= 2 and p[0] is not None and p[1] is not None]
    if len(pts) < 2:
        return None
    alts = [p[2] if len(p) > 2 and isinstance(p[2], (int, float)) else None for p in pts]
    if sum(a is not None for a in alts) < len(pts) * 0.8:
        return None
    der = next(a for a in alts if a is not None)
    for k, a in enumerate(alts):
        if a is None:
            alts[k] = der
        der = alts[k]
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + _dist(a, b))
    total = cum[-1]
    if total < 500:
        return None
    n = max(2, int(total // PAS_M) + 1)
    xs = [min(total, k * PAS_M) for k in range(n)] + ([total] if total - (n - 1) * PAS_M > 5 else [])
    z, j = [], 0
    for x in xs:
        while j < len(cum) - 2 and cum[j + 1] < x:
            j += 1
        seg = cum[j + 1] - cum[j]
        f = (x - cum[j]) / seg if seg > 0 else 0
        z.append(alts[j] + (alts[j + 1] - alts[j]) * min(1, max(0, f)))
    lisse = [sum(z[max(0, k - 3):k + 4]) / len(z[max(0, k - 3):k + 4]) for k in range(len(z))]
    return {"x": xs, "z": lisse, "total_m": total}


def _facteurs(pentes: Optional[dict]) -> dict[str, float]:
    """Vitesse relative au plat, par classe de pente, tirée des sorties de l'année (au moins 2 km par classe)."""
    out = {}
    for c in (pentes or {}).get("classes") or []:
        ref = c.get("ref") or {}
        if c["cle"] != "p" and ref.get("rel_pct") and (ref.get("km") or 0) >= 2:
            out[c["cle"]] = ref["rel_pct"] / 100
    return out


def _vitesse_relative(i: float, perso: dict[str, float]) -> tuple[float, bool]:
    generique = 1 / facteur_pente(max(-0.45, min(0.45, i)))
    c = _classe(i)
    if c in perso:
        # Moitié personnel, moitié modèle : les sorties d'entraînement sous-estiment un peu l'allure de course en côte
        v = (perso[c] + generique) / 2
        return (min(1.0, max(0.2, v)) if i > 0 else min(1.3, max(0.55, v))), True
    return (min(1.0, max(0.2, generique)) if i > 0 else min(1.3, max(0.55, generique))), False


def _temps_plat(d_eq_km: float, vma: float) -> float:
    """Temps (s) pour d_eq km à plat : point fixe de T = d / (VMA × fraction tenable pendant T)."""
    from analyses_service import fraction_vma
    t = d_eq_km / (vma * 0.85) * 60
    for _ in range(40):
        t = d_eq_km / (vma * fraction_vma(t)) * 60
    return t * 60


def _marge_endurance(acts: list[Activite], course: dict, temps_sec: float, auj: date) -> tuple[float, list[str]]:
    notes, marge = [], 0.0
    debut = auj - timedelta(days=56)
    longues = [a.duree_sec for a in acts if a.sport in cs.SPORTS_PIED and a.duree_sec and debut < a.debut.date() <= auj]
    plus_longue = max(longues, default=0)
    if temps_sec > 3600:
        if not plus_longue:
            marge += 0.05
            notes.append("Aucune sortie à pied sur 8 semaines : marge de 5 % pour l'endurance.")
        elif temps_sec > plus_longue * 1.3:
            m = min(0.08, (temps_sec / plus_longue - 1.3) * 0.06 + 0.01)
            marge += m
            notes.append(f"Ta plus longue sortie des 8 dernières semaines dure {_hms(plus_longue)}, la course est estimée "
                         f"nettement plus longue : +{_fr(m * 100)} % de marge.")
        else:
            notes.append(f"Ta plus longue sortie récente ({_hms(plus_longue)}) couvre bien la durée de la course.")
        dur = [d["durabilite_pct"] for d in (course.get("durabilites") or [])
               if d.get("durabilite_pct") is not None and (auj - date.fromisoformat(d["date"])).days <= 180][-5:]
        if dur:
            v = median(dur)
            if v > 3:
                m = min(0.04, (v - 3) * 0.006)
                marge += m
                notes.append(f"Tu perds {_fr(v)} % d'efficacité en fin de sortie longue : +{_fr(m * 100)} % de marge.")
            else:
                notes.append(f"Endurance solide ({_fr(max(v, 0))} % de perte en fin de sortie longue) : pas de marge ajoutée.")
    return min(0.12, marge), notes


def _pas_troncon(km: float) -> float:
    return 1 if km <= 12 else 2 if km <= 30 else 5 if km <= 60 else 10


def _niveaux(sec: float, prudence: float, distance_km: float) -> dict:
    def f(s):
        return {"sec": round(s), "texte": _hms(s), "allure": f"{_mmss(s / distance_km)}/km" if distance_km else None}
    return {"optimiste": f(sec * COEF_OPTIMISTE), "visee": f(sec), "prudente": f(sec * prudence)}


def _un(o: Objectif, fav: Optional[ItineraireFavori], acts: list[Activite], vma_kmh: Optional[float], course: dict,
        perso: dict[str, float], auj: date) -> dict:
    base = {"id": o.id, "titre": o.titre, "date": o.date_cible.isoformat() if o.date_cible else None,
            "jours": (o.date_cible - auj).days if o.date_cible else None, "distance_km": o.distance_km, "dplus_m": o.dplus_m,
            "cible_sec": o.temps_cible_sec, "cible_texte": _hms(o.temps_cible_sec) if o.temps_cible_sec else None,
            "itineraire_id": fav.id if fav else None, "parcours": None, "disponible": False, "passages": [], "profil": [],
            "classes": [], "hypotheses": [], "alertes": []}
    profil = None
    if fav:
        try:
            profil = _profil((json.loads(fav.donnees) or {}).get("points"))
        except (ValueError, TypeError):
            profil = None
        base["parcours"] = {"id": fav.id, "nom": fav.nom, "distance_km": round(fav.distance_km, 1), "dplus_m": fav.dplus_m}
        if not profil:
            base["alertes"].append("Ce parcours n'a pas d'altitude exploitable : estimation d'après la distance et le dénivelé seulement.")

    distance_km = profil["total_m"] / 1000 if profil else (o.distance_km or (fav.distance_km if fav else None))
    if not distance_km:
        base["raison"] = "Indique la distance de la course dans l'objectif, ou lie un parcours."
        return base

    # Distance équivalente à plat
    pas, generiques = [], 0.0
    if profil:
        x, z = profil["x"], profil["z"]
        dplus = dmoins = 0.0
        for k in range(1, len(x)):
            d = x[k] - x[k - 1]
            if d <= 0:
                continue
            dz = z[k] - z[k - 1]
            i = dz / d
            rel, est_perso = _vitesse_relative(i, perso)
            if not est_perso and _classe(i) != "p":
                generiques += d
            dplus += max(0, dz)
            dmoins += max(0, -dz)
            pas.append((x[k], d, dz, d / rel, _classe(i)))
        d_eq_km = sum(p[3] for p in pas) / 1000
        base["parcours"].update({"distance_km": round(distance_km, 1), "dplus_m": round(dplus), "dmoins_m": round(dmoins)})
        if o.distance_km and abs(distance_km - o.distance_km) / o.distance_km > 0.1:
            base["alertes"].append(f"Le parcours lié fait {_fr(distance_km)} km, l'objectif en annonce {_fr(o.distance_km)} : "
                                   "vérifie que c'est le bon tracé.")
    else:
        dplus = (o.dplus_m if o.dplus_m is not None else (fav.dplus_m if fav else 0)) or 0
        d_eq_km = distance_km + dplus / 100

    # Temps de base
    if vma_kmh:
        t_plat = _temps_plat(d_eq_km, vma_kmh)
        base["base"] = f"VMA estimée à {_fr(vma_kmh)} km/h et loi allure–durée"
    else:
        p = cs.predire_temps(acts, distance_km, round(dplus), datetime.combine(auj - timedelta(days=365), datetime.min.time()))
        if not p:
            base["raison"] = "Pas encore assez de sorties à pied pour estimer un temps."
            return base
        t_plat = p["temps_sec"]
        base["base"] = f"Ta meilleure sortie de l'année ({p['base']}), extrapolée"
    marge, notes = _marge_endurance(acts, course, t_plat, auj)
    visee = t_plat * (1 + marge)

    prudence = 1.05
    if not profil:
        prudence += 0.03
    elif pas and generiques / profil["total_m"] > 0.15:
        prudence += 0.02
    if not vma_kmh:
        prudence += 0.02

    hyp = [base["base"] + f" : {_fr(d_eq_km)} km équivalents à plat."]
    if profil:
        hyp.append("Allure ajustée à la pente tous les 50 m" + (
            ", avec tes propres allures en côte et en descente sur 12 mois." if perso and generiques / profil["total_m"] <= 0.15
            else ", avec tes allures quand elles existent et un modèle général ailleurs." if perso
            else ", selon un modèle général (pas assez de dénivelé dans tes sorties pour le personnaliser)."))
    else:
        hyp.append("Sans tracé : 100 m de dénivelé positif comptés comme 1 km à plat.")
    hyp += notes
    hyp.append("Hors arrêts aux ravitaillements, météo et terrain technique : ajoute-les à la main.")

    base.update({"disponible": True, "distance_km": round(distance_km, 1), "dplus_m": round(dplus),
                 "km_effort": round(d_eq_km, 1), "temps": _niveaux(visee, prudence, distance_km),
                 "coefs": {"optimiste": COEF_OPTIMISTE, "visee": 1, "prudente": round(prudence, 3)},
                 "marge_pct": round(marge * 100, 1), "hypotheses": hyp})
    if o.temps_cible_sec:
        e = o.temps_cible_sec - visee
        niv = base["temps"]
        base["cible_lecture"] = (
            "plus rapide que l'estimation optimiste : objectif très ambitieux à ce jour" if o.temps_cible_sec < niv["optimiste"]["sec"]
            else "entre l'optimiste et la visée : ambitieux mais jouable un bon jour" if e < 0
            else "entre la visée et la prudente : réaliste" if o.temps_cible_sec <= niv["prudente"]["sec"]
            else "plus lent que l'estimation prudente : tu as de la marge")
        base["cible_ecart_sec"] = round(e)

    if not profil:
        return base

    # Passages par tronçon : le temps suit la distance équivalente, la fatigue ralentit la fin (1 → 1 + 2 × marge)
    eq_total = d_eq_km * 1000
    k_base = t_plat / eq_total
    taille = _pas_troncon(distance_km) * 1000
    passages, cumul_t, cumul_eq = [], 0.0, 0.0
    cour = {"d": 0.0, "t": 0.0, "dp": 0.0, "dm": 0.0}
    par_classe = {c: [0.0, 0.0] for c, _, _ in BORNES}
    borne = taille
    for k, (xk, d, dz, eq, c) in enumerate(pas):
        fatigue = 1 + 2 * marge * ((cumul_eq + eq / 2) / eq_total)
        t = eq * k_base * fatigue
        cumul_eq += eq
        cumul_t += t
        cour["d"] += d; cour["t"] += t; cour["dp"] += max(0, dz); cour["dm"] += max(0, -dz)
        par_classe[c][0] += d; par_classe[c][1] += t
        fin = k == len(pas) - 1
        if xk >= borne - 1 or fin:
            if fin and passages and cour["d"] < taille * 0.3:
                # Petit reste : fusionné avec le dernier tronçon
                der = passages[-1]
                der["_d"] += cour["d"]; der["_t"] += cour["t"]; der["_dp"] += cour["dp"]; der["_dm"] += cour["dm"]
            else:
                passages.append({"_d": cour["d"], "_t": cour["t"], "_dp": cour["dp"], "_dm": cour["dm"]})
            passages[-1].update({"km": round(xk / 1000, 1), "cumul_sec": round(cumul_t)})
            cour = {"d": 0.0, "t": 0.0, "dp": 0.0, "dm": 0.0}
            borne += taille
    # Recalage : la somme des tronçons doit donner exactement le temps visé
    k_fin = visee / cumul_t if cumul_t else 1
    base["passages"] = [{"km": p["km"], "longueur_km": round(p["_d"] / 1000, 1), "dplus_m": round(p["_dp"]), "dmoins_m": round(p["_dm"]),
                         "sec": round(p["_t"] * k_fin), "allure_sec_km": round(p["_t"] * k_fin / (p["_d"] / 1000)),
                         "cumul_sec": round(p["cumul_sec"] * k_fin)} for p in passages if p["_d"] > 0]
    base["classes"] = [{"cle": c, "label": LIBELLES[c], "km": round(v[0] / 1000, 1), "part_temps_pct": round(v[1] / cumul_t * 100),
                        "allure_sec_km": round(v[1] * k_fin / (v[0] / 1000)), "perso": c in perso}
                       for c, v in par_classe.items() if v[0] >= 100]
    x, z = profil["x"], profil["z"]
    saut = max(1, len(x) // 160)
    base["profil"] = [[round(x[k] / 1000, 2), round(z[k])] for k in range(0, len(x), saut)]
    if base["profil"][-1][0] != round(x[-1] / 1000, 2):
        base["profil"].append([round(x[-1] / 1000, 2), round(z[-1])])
    return base


def calculer(db: Session, user: Utilisateur, acts: list[Activite], vma: dict, course: dict, pentes: Optional[dict],
             objectifs: list[Objectif], auj: date) -> dict:
    favoris = (db.query(ItineraireFavori).filter(ItineraireFavori.utilisateur_id == user.id)
               .order_by(ItineraireFavori.maj_le.desc()).all())
    par_id = {f.id: f for f in favoris}
    vma_kmh = (vma.get("actuelle") or {}).get("vma")
    perso = _facteurs(pentes)
    cibles = sorted((o for o in objectifs if o.type == "course" and o.statut == "actif" and o.date_cible and o.date_cible >= auj
                     and (o.sport in (None, "") or o.sport in cs.SPORTS_PIED)), key=lambda o: o.date_cible)[:4]
    return {
        "objectifs": [_un(o, par_id.get(getattr(o, "itineraire_id", None)), acts, vma_kmh, course, perso, auj) for o in cibles],
        "parcours": [{"id": f.id, "nom": f.nom, "distance_km": round(f.distance_km, 1), "dplus_m": f.dplus_m} for f in favoris
                     if f.sport in ("course", "trail", "randonnee")],
    }


def resume(p: Optional[dict]) -> Optional[dict]:
    if not p:
        return None
    return {"objectifs": [{k: o.get(k) for k in ("titre", "disponible", "distance_km", "dplus_m", "parcours", "temps",
                                                 "cible_texte", "cible_lecture")} for o in p["objectifs"]]}


def markdown(p: Optional[dict]) -> list[str]:
    l = []
    for o in (p or {}).get("objectifs") or []:
        if not o["disponible"]:
            continue
        t = o["temps"]
        l.append(f"- Prédiction pour « {o['titre']} » ({_fr(o['distance_km'])} km, {o['dplus_m']} m D+"
                 + (f", parcours « {o['parcours']['nom']} »" if o["parcours"] else ", sans tracé") + ") : "
                 f"optimiste {t['optimiste']['texte']}, visée {t['visee']['texte']}, prudente {t['prudente']['texte']}"
                 + (f" ; temps visé par l'athlète {o['cible_texte']} ({o['cible_lecture']})" if o.get("cible_lecture") else "") + ".")
    return l
