"""
Calculs purs des analyses : aucune base de données, aucun modèle, seulement des nombres en entrée et en sortie.
C'est ce module que les tests automatiques (tests/) verrouillent avec des jeux d'essai figés.
analyses_service.py ré-exporte ces fonctions : `an.courbe_forme`, `an.vitesse_critique`… restent valables.
"""
from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Optional

CTL_JOURS = 42   # forme de fond (charge chronique)
ATL_JOURS = 7    # fatigue (charge aiguë)
DUREES_CS = (3, 5, 10, 20)   # minutes : durées retenues pour l'allure critique


def _moy(xs) -> Optional[float]:
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


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


def fraction_vma(t_min: float) -> float:
    """Fraction de la VMA tenable pendant t minutes (≈ 103 % sur 4 min, 92 % sur 20 min, 81 % sur un semi)."""
    return 1 - 0.0665 * math.log(max(t_min, 3) / 6)


def pearson(xs: list[float], ys: list[float]) -> Optional[float]:
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    return sxy / (sx * sy) if sx and sy else None


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
