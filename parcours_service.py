"""
Parcours répétés : sorties sur le même parcours qu'une séance, et segments personnels
(portions de tracé chronométrées à chaque passage). Tout est calculé à partir des tracés GPS
[[lat, lon, alt|null, secondes depuis le début], …] ; seuls les segments eux-mêmes sont stockés.
"""
from __future__ import annotations

import json
from math import cos, hypot, radians
from typing import Optional

from sqlalchemy.orm import Session

from models import Activite, Segment, TraceGPS

R = 6_371_000
PAS_SEGMENT = 10.0          # un point tous les 10 m dans un segment
SEGMENT_MIN_M, SEGMENT_MAX_M = 100, 30_000
RAYON_BORNE = 30.0          # passage au départ / à l'arrivée du segment à moins de 30 m
ECART_MAX = 40.0            # tout le segment doit être suivi à moins de 40 m
MEME_DEPART = 200.0         # même parcours : départ et arrivée à moins de 200 m…
MEME_ECART_MOYEN = 100.0    # … et tracés distants de 100 m en moyenne au plus
MEME_DISTANCE = 0.05        # … et distances à ±5 %

FAMILLES = [{"course", "trail"}, {"marche", "randonnee"}]


def famille(sport: Optional[str]) -> set[str]:
    return next((f for f in FAMILLES if sport in f), {sport} if sport else set())


# ---------------------------------------------------------------------------
# Géométrie (projection plane locale : précise à quelques mètres sur quelques dizaines de km)
# ---------------------------------------------------------------------------

class Plan:
    def __init__(self, lat0: float):
        self.kx, self.ky = radians(1) * R * cos(radians(lat0)), radians(1) * R

    def xy(self, p) -> tuple[float, float]:
        return p[1] * self.kx, p[0] * self.ky


def _cumul(xy: list) -> list[float]:
    c = [0.0]
    for (x0, y0), (x1, y1) in zip(xy, xy[1:]):
        c.append(c[-1] + hypot(x1 - x0, y1 - y0))
    return c


def _projection(p, a, b) -> tuple[float, float]:
    """(distance de p au segment [a, b], position 0..1 du point le plus proche)."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    f = 0.0 if l2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    return hypot(a[0] + f * dx - p[0], a[1] + f * dy - p[1]), f


def _points_valides(points: list) -> list:
    return [p for p in points if p and len(p) >= 2 and p[0] is not None and p[1] is not None]


def reechantillonner(points: list, pas: float) -> list[list]:
    """[[lat, lon, alt|null], …] tous les `pas` mètres le long du tracé."""
    pts = _points_valides(points)
    if len(pts) < 2:
        return []
    plan = Plan(pts[0][0])
    cum = _cumul([plan.xy(p) for p in pts])
    sortie, k = [], 0
    n = int(cum[-1] // pas)
    for j in range(n + 1):
        d = j * pas
        while k < len(pts) - 2 and cum[k + 1] < d:
            k += 1
        seg = cum[k + 1] - cum[k]
        f = 0.0 if seg <= 0 else min(1.0, (d - cum[k]) / seg)
        a, b = pts[k], pts[k + 1]
        alt = None
        if len(a) > 2 and len(b) > 2 and a[2] is not None and b[2] is not None:
            alt = round(a[2] + f * (b[2] - a[2]), 1)
        sortie.append([round(a[0] + f * (b[0] - a[0]), 6), round(a[1] + f * (b[1] - a[1]), 6), alt])
    if cum[-1] - n * pas > pas / 3:
        p = pts[-1]
        sortie.append([round(p[0], 6), round(p[1], 6), p[2] if len(p) > 2 else None])
    return sortie


def portion(points: list, debut_km: float, fin_km: float) -> list:
    """Points du tracé entre deux distances (km) depuis le départ."""
    pts = _points_valides(points)
    if len(pts) < 2:
        return []
    plan = Plan(pts[0][0])
    cum = _cumul([plan.xy(p) for p in pts])
    a, b = debut_km * 1000, fin_km * 1000
    return [p for p, c in zip(pts, cum) if a <= c <= b]


def denivele(points: list) -> Optional[int]:
    alts = [p[2] for p in points if len(p) > 2 and p[2] is not None]
    if len(alts) < 2:
        return None
    return round(sum(max(0.0, b - a) for a, b in zip(alts, alts[1:])))


# ---------------------------------------------------------------------------
# Passages sur un segment
# ---------------------------------------------------------------------------

class Trace:
    """Tracé d'une séance prêt pour la recherche de passages."""

    def __init__(self, activite_id: int, date: str, sport: str, points: list):
        self.activite_id, self.date, self.sport = activite_id, date, sport
        self.pts = [p for p in _points_valides(points) if len(p) >= 4 and p[3] is not None]
        lats = [p[0] for p in self.pts] or [0]
        lons = [p[1] for p in self.pts] or [0]
        self.bbox = (min(lats), min(lons), max(lats), max(lons))
        self._plan: Optional[Plan] = None

    def contient(self, p, marge_deg: float = 0.0005) -> bool:
        a, b, c, d = self.bbox
        return a - marge_deg <= p[0] <= c + marge_deg and b - marge_deg <= p[1] <= d + marge_deg

    def projete(self, plan: Plan):
        if self._plan is not plan:
            self._plan, self.xy = plan, [plan.xy(p) for p in self.pts]
            self.cum = _cumul(self.xy)
        return self.xy, self.cum


def _proches(xy: list, cible, rayon: float) -> list[tuple[int, float, float]]:
    """Passages près de `cible` : un (indice, fraction, distance) par approche, le plus proche."""
    res, groupe = [], None
    for k in range(len(xy) - 1):
        d, f = _projection(cible, xy[k], xy[k + 1])
        if d <= rayon:
            if groupe is None or d < groupe[2]:
                groupe = (k, f, d)
        elif groupe is not None:
            res.append(groupe)
            groupe = None
    if groupe is not None:
        res.append(groupe)
    return res


def passages(seg_xy: list, longueur: float, t: Trace, plan: Plan) -> list[dict]:
    if len(t.pts) < 2:
        return []
    xy, cum = t.projete(plan)
    departs = _proches(xy, seg_xy[0], RAYON_BORNE)
    if not departs:
        return []
    arrivees = _proches(xy, seg_xy[-1], RAYON_BORNE)
    controles = seg_xy[:: max(1, len(seg_xy) // 25)] + [seg_xy[-1]]
    res, apres = [], -1.0
    pos = lambda k, f: cum[k] + f * (cum[k + 1] - cum[k])                            # noqa: E731
    temps = lambda k, f: t.pts[k][3] + f * (t.pts[k + 1][3] - t.pts[k][3])            # noqa: E731
    for (k0, f0, _) in departs:
        d0 = pos(k0, f0)
        if d0 < apres:
            continue
        for (k1, f1, _) in arrivees:
            d1 = pos(k1, f1)
            if d1 - d0 < longueur * 0.8:
                continue
            if d1 - d0 > longueur * 1.3 + 50:
                break
            # Le chemin suivi entre les deux colle-t-il au segment ?
            if all(min(_projection(c, xy[k], xy[k + 1])[0] for k in range(k0, k1 + 1)) <= ECART_MAX
                   for c in controles):
                duree = temps(k1, f1) - temps(k0, f0)
                if duree > 0:
                    res.append({"activite_id": t.activite_id, "date": t.date, "duree_sec": round(duree),
                                "vitesse_kmh": round(longueur / duree * 3.6, 2)})
                    apres = d1
            break
    return res


def _segment_xy(s: Segment) -> tuple[list, Plan]:
    pts = json.loads(s.points)
    plan = Plan(pts[0][0])
    return [plan.xy(p) for p in pts], plan


def chercher(segments: list[Segment], traces: list[Trace]) -> dict[int, list[dict]]:
    """Passages de chaque segment sur chaque tracé (du plus rapide au plus lent)."""
    res: dict[int, list[dict]] = {}
    for s in segments:
        pts = json.loads(s.points)
        seg_xy, plan = _segment_xy(s)
        fam = famille(s.sport)
        trouves = []
        for t in traces:
            if fam and t.sport not in fam:
                continue
            if t.contient(pts[0]) and t.contient(pts[-1]):
                trouves += passages(seg_xy, s.distance_m, t, plan)
        res[s.id] = sorted(trouves, key=lambda p: p["duree_sec"])
    return res


# Passages gardés en mémoire tant que les tracés et segments ne changent pas
_cache: dict[int, tuple[str, dict]] = {}


def _signature(db: Session, user_id: int, segments: list[Segment]) -> str:
    ids = [i for (i,) in db.query(TraceGPS.id).filter(TraceGPS.utilisateur_id == user_id,
                                                      TraceGPS.activite_id.isnot(None))]
    return f"{len(ids)}:{sum(ids)}|" + ",".join(f"{s.id}:{s.distance_m}" for s in segments)


def _traces(db: Session, user_id: int, activite_id: Optional[int] = None) -> list[Trace]:
    q = (db.query(TraceGPS.points, Activite.id, Activite.debut, Activite.sport)
         .join(Activite, Activite.id == TraceGPS.activite_id)
         .filter(TraceGPS.utilisateur_id == user_id))
    if activite_id is not None:
        q = q.filter(Activite.id == activite_id)
    return [Trace(aid, debut.isoformat(), sport, json.loads(pts)) for pts, aid, debut, sport in q]


def tous_les_passages(db: Session, user_id: int) -> dict[int, list[dict]]:
    segments = db.query(Segment).filter(Segment.utilisateur_id == user_id).order_by(Segment.id).all()
    if not segments:
        return {}
    sig = _signature(db, user_id, segments)
    deja = _cache.get(user_id)
    if deja and deja[0] == sig:
        return deja[1]
    res = chercher(segments, _traces(db, user_id))
    _cache[user_id] = (sig, res)
    return res


def oublier(user_id: int) -> None:
    _cache.pop(user_id, None)


def segments_de_activite(db: Session, user_id: int, a: Activite) -> list[dict]:
    """Segments traversés par une séance, avec le rang de ce passage parmi tous."""
    segments = db.query(Segment).filter(Segment.utilisateur_id == user_id).order_by(Segment.id).all()
    if not segments:
        return []
    ici = chercher(segments, _traces(db, user_id, a.id))
    if not any(ici.values()):
        return []
    tous = tous_les_passages(db, user_id)
    res = []
    for s in segments:
        for p in ici.get(s.id) or []:
            autres = tous.get(s.id) or [p]
            rang = 1 + sum(1 for x in autres if x["duree_sec"] < p["duree_sec"])
            res.append({**resume_segment(s, autres), "passage": p, "rang": rang})
    return res


def resume_segment(s: Segment, pas: list[dict]) -> dict:
    return {"id": s.id, "nom": s.nom, "sport": s.sport, "distance_m": round(s.distance_m),
            "dplus_m": s.dplus_m, "activite_id": s.activite_id,
            "nb_passages": len(pas), "record": pas[0] if pas else None}


# ---------------------------------------------------------------------------
# Même parcours
# ---------------------------------------------------------------------------

def _forme(points: list, n: int = 40) -> list:
    """`n` points répartis régulièrement le long du tracé."""
    pts = _points_valides(points)
    if len(pts) < 2:
        return []
    plan = Plan(pts[0][0])
    cum = _cumul([plan.xy(p) for p in pts])
    if cum[-1] <= 0:
        return []
    sortie, k = [], 0
    for j in range(n):
        d = cum[-1] * j / (n - 1)
        while k < len(pts) - 2 and cum[k + 1] < d:
            k += 1
        seg = cum[k + 1] - cum[k]
        f = 0.0 if seg <= 0 else min(1.0, (d - cum[k]) / seg)
        sortie.append([pts[k][0] + f * (pts[k + 1][0] - pts[k][0]), pts[k][1] + f * (pts[k + 1][1] - pts[k][1])])
    return sortie


def meme_parcours(db: Session, user_id: int, a: Activite) -> list[dict]:
    """Séances du même sport sur le même parcours (même sens), de la plus ancienne à la plus récente."""
    t = db.query(TraceGPS).filter(TraceGPS.activite_id == a.id).first()
    if not t or not a.distance_km:
        return []
    ref = _forme(json.loads(t.points))
    if not ref:
        return []
    plan = Plan(ref[0][0])
    ref_xy = [plan.xy(p) for p in ref]
    d = a.distance_km
    cands = (db.query(Activite, TraceGPS.points).join(TraceGPS, TraceGPS.activite_id == Activite.id)
             .filter(Activite.utilisateur_id == user_id, Activite.id != a.id,
                     Activite.sport.in_(famille(a.sport)),
                     Activite.distance_km.between(d * (1 - MEME_DISTANCE), d * (1 + MEME_DISTANCE)))
             .order_by(Activite.debut.desc()).limit(500).all())
    res = []
    for b, pts in cands:
        f = _forme(json.loads(pts))
        if not f:
            continue
        xy = [plan.xy(p) for p in f]
        if hypot(xy[0][0] - ref_xy[0][0], xy[0][1] - ref_xy[0][1]) > MEME_DEPART:
            continue
        if hypot(xy[-1][0] - ref_xy[-1][0], xy[-1][1] - ref_xy[-1][1]) > MEME_DEPART:
            continue
        ecart = sum(hypot(p[0] - q[0], p[1] - q[1]) for p, q in zip(xy, ref_xy)) / len(xy)
        if ecart <= MEME_ECART_MOYEN:
            res.append(_ligne(b))
    if not res:
        return []
    return sorted(res + [{**_ligne(a), "courante": True}], key=lambda r: r["date"])


def _ligne(b: Activite) -> dict:
    return {"id": b.id, "date": b.debut.isoformat(), "titre": b.titre, "sport": b.sport,
            "distance_km": b.distance_km, "duree_sec": b.duree_sec, "fc": b.fc_moyenne_bpm,
            "allure_sec_km": round(b.duree_sec / b.distance_km, 1) if b.duree_sec and b.distance_km else None}
