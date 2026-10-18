"""
Terrain (route, chemin, sentier) le long d'un tracé GPS enregistré.

Les itinéraires calculés reçoivent le type de voie de BRouter ; une sortie enregistrée n'a que
des positions. On rapproche donc chaque portion du tracé de la voie OSM la plus proche, lue
dans les tuiles vectorielles gratuites d'OpenFreeMap (zoom 14, couche « transportation »),
avec les mêmes règles que pour les itinéraires. Les tuiles sont lues une par une et oubliées
aussitôt (mémoire limitée sur Render) ; seul le résultat par tracé est gardé en mémoire.
"""
from __future__ import annotations

import gzip
import logging
import math
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from itineraires_zones import _UA, _champs, _gabarit, _paquet, _voies, _zz

_log = logging.getLogger(__name__)

Z = 14
PAS_M = 20          # un échantillon tous les 20 m
RAYON_M = 25        # au-delà, la portion reste « inconnue » (hors carte, GPS dérivé)
MAX_ECHANTILLONS = 3000

_ROUTES = {"motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "busway"}
_TROTTOIRS = {"footway", "pedestrian", "cycleway", "platform"}
_cache: dict[tuple, dict] = {}


def _type(prop: dict) -> Optional[str]:
    """« bitume », « chemin » ou « sentier » ; None pour ce qui ne se parcourt pas (rail, ferry…)."""
    classe, sous, revet = prop.get("class"), prop.get("subclass"), prop.get("surface")
    if classe not in _ROUTES and classe not in ("track", "path"):
        return None
    if revet:
        pave = revet == "paved"
    elif classe == "track":
        pave = False
    elif classe == "path":
        pave = sous in _TROTTOIRS  # trottoirs, voies piétonnes et pistes cyclables sans revêtement indiqué
    else:
        pave = True
    if pave:
        return "bitume"
    return "sentier" if classe == "path" else "chemin"


def _parties(geom: list[int]) -> list[list[tuple[int, int]]]:
    """Lignes d'une géométrie encodée (une multi-ligne en donne plusieurs)."""
    x = y = 0
    res: list[list[tuple[int, int]]] = []
    i = 0
    while i < len(geom):
        cmd, cnt = geom[i] & 7, geom[i] >> 3
        i += 1
        if cmd == 7:
            continue
        for _ in range(cnt):
            x += _zz(geom[i])
            y += _zz(geom[i + 1])
            i += 2
            if cmd == 1:
                res.append([])
            if res:
                res[-1].append((x, y))
    return [r for r in res if len(r) >= 2]


def _xy(lat: float, lon: float) -> tuple[float, float]:
    n = 2 ** Z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def _dist_m(a, b) -> float:
    x = math.radians(b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    return 6371000 * math.hypot(x, math.radians(b[0] - a[0]))


def _echantillons(points: list) -> tuple[list[tuple[float, float, float]], float]:
    """Positions régulières (km, lat, lon) le long du tracé, et sa longueur en km."""
    pas = PAS_M
    total = sum(_dist_m(points[i - 1], points[i]) for i in range(1, len(points)))
    if total / pas > MAX_ECHANTILLONS:
        pas = total / MAX_ECHANTILLONS
    res, d, cible = [], 0.0, 0.0
    for i in range(1, len(points)):
        a, b = points[i - 1], points[i]
        l = _dist_m(a, b)
        while l > 0 and cible <= d + l:
            f = (cible - d) / l
            res.append((cible / 1000, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
            cible += pas
        d += l
    return res, total / 1000


def _lire(gabarit: str, x: int, y: int) -> Optional[bytes]:
    try:
        url = gabarit.replace("{z}", str(Z)).replace("{x}", str(x)).replace("{y}", str(y))
        with urllib.request.urlopen(urllib.request.Request(url, headers=_UA), timeout=10) as r:
            b = r.read()
    except Exception as e:  # tuile absente ou réseau : ces portions restent inconnues
        _log.info("Tuile %s/%s indisponible : %s", x, y, e)
        return None
    return gzip.decompress(b) if b[:2] == b"\x1f\x8b" else b


def _classer_tuile(b: bytes, x: int, y: int, ech: list[tuple[int, float, float]], m_par_unite: float) -> dict[int, str]:
    """Type de la voie la plus proche de chaque échantillon (indice, fx, fy) de la tuile."""
    CASE = 64
    grille: dict[tuple[int, int], list] = {}
    ext = 4096
    for prop, geom, e in _voies(b):
        t = _type(prop)
        if not t:
            continue
        ext = e
        for ligne in _parties(geom):
            for (x0, y0), (x1, y1) in zip(ligne, ligne[1:]):
                seg = (x0, y0, x1, y1, t)
                for cx in range(min(x0, x1) // CASE, max(x0, x1) // CASE + 1):
                    for cy in range(min(y0, y1) // CASE, max(y0, y1) // CASE + 1):
                        grille.setdefault((cx, cy), []).append(seg)
    rayon = RAYON_M / m_par_unite * (ext / 4096)
    res: dict[int, str] = {}
    for k, fx, fy in ech:
        px, py = fx * ext, fy * ext
        mieux, d2min = None, rayon * rayon
        cx0, cy0 = int(px // CASE), int(py // CASE)
        r = int(rayon // CASE) + 1
        for cx in range(cx0 - r, cx0 + r + 1):
            for cy in range(cy0 - r, cy0 + r + 1):
                for x0, y0, x1, y1, t in grille.get((cx, cy), ()):
                    dx, dy = x1 - x0, y1 - y0
                    l2 = dx * dx + dy * dy
                    f = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - x0) * dx + (py - y0) * dy) / l2))
                    ex, ey = x0 + f * dx - px, y0 + f * dy - py
                    d2 = ex * ex + ey * ey
                    if d2 < d2min:
                        mieux, d2min = t, d2
        if mieux:
            res[k] = mieux
    return res


def terrains(cle: tuple, points: list) -> dict:
    """{"terrains": [[début km, fin km, type], …], "repartition": {type: %}} ; listes vides si rien n'est reconnu."""
    if cle in _cache:
        return _cache[cle]
    vide = {"terrains": [], "repartition": None}
    if len(points) < 2:
        return vide
    ech, total = _echantillons(points)
    if not ech:
        return vide
    # Échantillons regroupés par tuile
    par_tuile: dict[tuple[int, int], list] = {}
    for k, (_, lat, lon) in enumerate(ech):
        tx, ty = _xy(lat, lon)
        par_tuile.setdefault((int(tx), int(ty)), []).append((k, tx - int(tx), ty - int(ty)))
    gabarit = _gabarit()
    types: list[Optional[str]] = [None] * len(ech)

    def traiter(item):
        (x, y), liste = item
        b = _lire(gabarit, x, y)
        if not b:
            return {}
        lat = ech[liste[0][0]][1]
        m_par_unite = 40075016.686 * math.cos(math.radians(lat)) / 2 ** Z / 4096
        return _classer_tuile(b, x, y, liste, m_par_unite)

    with ThreadPoolExecutor(6) as pool:
        for res in pool.map(traiter, par_tuile.items()):
            for k, t in res.items():
                types[k] = t
    connus = sum(t is not None for t in types)
    if connus < 0.3 * len(types):
        _cache[cle] = vide
        return vide
    # Lissage : type majoritaire sur ±3 échantillons (le GPS hésite entre deux voies parallèles)
    lisses: list[Optional[str]] = []
    for k in range(len(types)):
        fen = [t for t in types[max(0, k - 3):k + 4] if t]
        lisses.append(max(sorted(set(fen)), key=lambda t: (fen.count(t), t == types[k])) if fen else None)
    # Portions inconnues : rattachées à la voie qui précède (ou qui suit, au départ)
    dernier = next((t for t in lisses if t), None)
    for k, t in enumerate(lisses):
        if t:
            dernier = t
        else:
            lisses[k] = dernier
    # Tronçons, puis bouts de moins de 50 m absorbés par le précédent
    bornes = [e[0] for e in ech[1:]] + [total]
    res: list[list] = []
    debut = 0.0
    for k, t in enumerate(lisses):
        if res and res[-1][2] == t:
            res[-1][1] = bornes[k]
        else:
            res.append([debut, bornes[k], t])
        debut = bornes[k]
    fus: list[list] = []
    for t in res:
        if fus and (fus[-1][2] == t[2] or t[1] - t[0] < 0.05):
            fus[-1][1] = t[1]
        else:
            fus.append(t)
    parts = {"bitume": 0.0, "chemin": 0.0, "sentier": 0.0}
    for a, b, t in fus:
        parts[t] += b - a
    somme = sum(parts.values()) or 1
    sortie = {"terrains": [[round(a, 3), round(b, 3), t] for a, b, t in fus],
              "repartition": {k: round(100 * v / somme) for k, v in parts.items()}}
    if len(_cache) > 300:
        _cache.clear()
    _cache[cle] = sortie
    return sortie
