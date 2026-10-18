"""
Découpage d'une séance : kilomètre par kilomètre, par tour (intervalles d'Intervals.icu),
et allure ajustée à la pente (« GAP »), calculés à partir des flux bruts — rien n'est stocké.

L'allure ajustée suit le coût énergétique de la course en pente mesuré par Minetti et al. (2002) :
C(i) = 155,4 i⁵ − 30,4 i⁴ − 43,3 i³ + 46,3 i² + 19,5 i + 3,6 J/kg/m, i = pente (fraction).
Une portion de pente i « compte » C(i) / C(0) fois sa longueur à plat. En descente, la formule
brute promet bien plus que ce qu'on gagne en pratique (le freinage musculaire n'y est pas) :
le gain est plafonné à DESCENTE_MAX.
"""
from __future__ import annotations

from typing import Optional

PENTE_MAX = 0.45          # au-delà, la formule n'est plus mesurée
DESCENTE_MAX = 0.15       # une descente vaut au mieux 15 % de longueur en moins à plat
FENETRE_PENTE_M = 30      # pente calculée sur ±15 m pour lisser le bruit de l'altitude
VITESSE_ARRET = 0.3       # m/s : en dessous, le temps n'est pas compté (arrêt, montre en pause)
SPORTS_GAP = {"course", "trail"}


def _num(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def cout_minetti(i: float) -> float:
    i = max(-PENTE_MAX, min(PENTE_MAX, i))
    return 155.4 * i**5 - 30.4 * i**4 - 43.3 * i**3 + 46.3 * i**2 + 19.5 * i + 3.6


def facteur_pente(i: float) -> float:
    """Longueur à plat équivalente à 1 m parcouru sur une pente i."""
    return max(1 - DESCENTE_MAX, cout_minetti(i) / 3.6)


def _combler(v: Optional[list], n: int) -> Optional[list]:
    """Remplit les trous par la valeur connue la plus proche (avant, sinon après)."""
    if not v or len(v) != n or not any(_num(x) for x in v):
        return None
    sortie, der = list(v), None
    for i, x in enumerate(sortie):
        if _num(x):
            der = x
        else:
            sortie[i] = der
    prem = next(x for x in v if _num(x))
    return [prem if x is None else x for x in sortie]


def _lisser(v: list, k: int = 5) -> list:
    """Moyenne glissante sur ±k points."""
    n, cumul = len(v), [0.0]
    for x in v:
        cumul.append(cumul[-1] + x)
    return [(cumul[min(n, i + k + 1)] - cumul[max(0, i - k)]) / (min(n, i + k + 1) - max(0, i - k)) for i in range(n)]


def pentes(dist: list, alt: Optional[list]) -> Optional[list]:
    """Pente (fraction) en chaque point, mesurée sur ±FENETRE_PENTE_M / 2."""
    if alt is None:
        return None
    n, a, b, demi = len(dist), 0, 0, FENETRE_PENTE_M / 2
    sortie = []
    for i in range(n):
        while dist[i] - dist[a] > demi:
            a += 1
        while b < n - 1 and dist[b + 1] - dist[i] <= demi:
            b += 1
        dd = dist[b] - dist[a]
        sortie.append(max(-PENTE_MAX, min(PENTE_MAX, (alt[b] - alt[a]) / dd)) if dd >= 5 else 0.0)
    return sortie


class Seance:
    """Flux bruts d'une séance, réalignés : temps (s), distance cumulée (m), altitude (m), FC, cadence."""

    def __init__(self, temps: list, dist_m: list, alt: Optional[list] = None, fc: Optional[list] = None,
                 cadence: Optional[list] = None, sport: str = ""):
        n = len(temps)
        self.n, self.sport = n, sport
        self.temps = _combler(temps, n) or [float(i) for i in range(n)]
        d = _combler(dist_m, n) or [0.0] * n
        for i in range(1, n):  # distance jamais décroissante
            d[i] = max(d[i], d[i - 1])
        self.dist = d
        alt_c = _combler(alt, n)
        self.alt = _lisser(alt_c) if alt_c else None
        self.fc = fc if fc and len(fc) == n else None
        self.cadence = cadence if cadence and len(cadence) == n else None
        self.pente = pentes(self.dist, self.alt)
        self.gap = sport in SPORTS_GAP and self.pente is not None

    def _mobile(self, i: int) -> float:
        """Durée comptée entre les points i-1 et i (0 à l'arrêt ou montre en pause)."""
        dt = self.temps[i] - self.temps[i - 1]
        dd = self.dist[i] - self.dist[i - 1]
        return dt if dt > 0 and dd / dt >= VITESSE_ARRET else 0.0

    def bilan(self, a: int, b: int) -> Optional[dict]:
        """Résumé de la portion de points [a, b]."""
        if b <= a:
            return None
        duree = dist = plat = 0.0
        dplus = dmoins = 0.0
        fc_s = fc_t = cad_s = cad_t = 0.0
        for i in range(a + 1, b + 1):
            t = self._mobile(i)
            dd = self.dist[i] - self.dist[i - 1]
            duree += t
            dist += dd
            if self.gap:
                plat += dd * facteur_pente(self.pente[i])
            if self.alt:
                da = self.alt[i] - self.alt[i - 1]
                dplus += max(0.0, da)
                dmoins += max(0.0, -da)
            if t and self.fc and _num(self.fc[i]):
                fc_s += self.fc[i] * t
                fc_t += t
            if t and self.cadence and _num(self.cadence[i]):
                cad_s += self.cadence[i] * t
                cad_t += t
        if dist < 20 or duree <= 0:
            return None
        res = {
            "distance_km": round(dist / 1000, 3),
            "duree_sec": round(duree),
            "allure_sec_km": round(duree / (dist / 1000), 1),
            "vitesse_kmh": round(dist / duree * 3.6, 2),
            "fc": round(fc_s / fc_t) if fc_t else None,
            "cadence": round(cad_s / cad_t) if cad_t else None,
            "dplus_m": round(dplus) if self.alt else None,
            "dmoins_m": round(dmoins) if self.alt else None,
            "debut_km": round(self.dist[a] / 1000, 3),
            "fin_km": round(self.dist[b] / 1000, 3),
        }
        if self.gap and plat > 0:
            res["gap_sec_km"] = round(duree / (plat / 1000), 1)
        return res

    def splits(self, pas_km: float) -> list[dict]:
        """Un bilan par tranche de `pas_km` (la dernière, partielle, si elle dépasse 100 m)."""
        pas, sortie, a = pas_km * 1000, [], 0
        borne = pas
        for i in range(1, self.n):
            if self.dist[i] >= borne:
                b = self.bilan(a, i)
                if b:
                    sortie.append({**b, "numero": len(sortie) + 1})
                a, borne = i, borne + pas
        if self.dist[-1] - self.dist[a] >= 100:
            b = self.bilan(a, self.n - 1)
            if b:
                sortie.append({**b, "numero": len(sortie) + 1, "partiel": self.dist[-1] - self.dist[a] < pas * 0.95})
        return sortie

    def vitesse_ajustee(self, vitesse_ms: Optional[list]) -> Optional[list]:
        """Vitesse à plat équivalente en chaque point (m/s), pour la courbe."""
        if not self.gap or not vitesse_ms or len(vitesse_ms) != self.n:
            return None
        return [v * facteur_pente(p) if _num(v) else None for v, p in zip(vitesse_ms, self.pente)]


def pas_split(sport: str) -> float:
    return 5.0 if sport == "velo" else 1.0


def decouper(s: Seance, intervalles: Optional[list] = None) -> dict:
    """{pas_km, splits, tours, resume} — `intervalles` = icu_intervals d'Intervals.icu."""
    if s.n < 10 or s.dist[-1] < 200 or s.sport == "natation":
        return {}
    pas = pas_split(s.sport)
    tours = []
    for iv in intervalles or []:
        a, b = iv.get("start_index"), iv.get("end_index")
        if not (isinstance(a, int) and isinstance(b, int)) or not 0 <= a < b < s.n:
            continue
        bl = s.bilan(a, b)
        if bl:
            tours.append({**bl, "type": (iv.get("type") or "").lower() or None, "label": iv.get("label")})
    tours.sort(key=lambda t: t["debut_km"])
    resume = s.bilan(0, s.n - 1)
    return {
        "pas_km": pas,
        "splits": s.splits(pas),
        # Un seul « tour » couvrant la séance n'apprend rien de plus
        "tours": [{**t, "numero": i + 1} for i, t in enumerate(tours)] if len(tours) >= 2 else [],
        "gap_sec_km": resume.get("gap_sec_km") if resume else None,
        # Rapport allure ajustée / allure réelle : appliqué à l'allure de la montre, il évite
        # l'écart dû au temps « en mouvement » recalculé depuis le tracé (dérive GPS à l'arrêt)
        "gap_ratio": round(resume["gap_sec_km"] / resume["allure_sec_km"], 4)
        if resume and resume.get("gap_sec_km") and resume.get("allure_sec_km") else None,
    }
