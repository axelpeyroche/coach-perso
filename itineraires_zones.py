"""
Zones de départ riches en chemins autour d'un point (rayon choisi par l'utilisateur).

Source gratuite et sans clé : les tuiles vectorielles OpenFreeMap (schéma OpenMapTiles,
couche « transportation »). Au zoom 13, une tuile couvre environ 3,4 km et donne les
sentiers (path), chemins (track) et routes avec leur revêtement. On mesure, tuile par
tuile, la longueur de chemins et de routes, on lisse sur les tuiles voisines (une boucle
déborde de sa tuile), on pénalise l'éloignement, puis on vérifie le relief des meilleures
zones (altitudes OpenTopoData) quand un D+ est visé. Le départ retenu est le point de
sentier de la zone le plus proche du départ demandé.
"""
from __future__ import annotations

import gzip
import json
import logging
import math
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

_log = logging.getLogger(__name__)

TILEJSON = "https://tiles.openfreemap.org/planet"
ALTITUDES = "https://api.opentopodata.org/v1/srtm90m"
Z = 13
_UA = {"User-Agent": "Carnet (carnet d'entrainement personnel)"}

_ROUTES = {"minor", "service", "tertiary", "secondary", "primary", "trunk", "motorway", "busway"}
_TROTTOIRS = {"footway", "pedestrian", "cycleway", "steps", "platform"}

_url_tuiles: tuple[float, str] | None = None
_cache: dict[tuple, dict] = {}  # (url, x, y) → mesures de la tuile


# ── Lecture minimale du format Mapbox Vector Tile (protobuf) ─────────────────

def _varint(b: bytes, i: int) -> tuple[int, int]:
    r = s = 0
    while True:
        c = b[i]
        i += 1
        r |= (c & 0x7F) << s
        s += 7
        if c < 0x80:
            return r, i


def _champs(b: bytes):
    i = 0
    while i < len(b):
        k, i = _varint(b, i)
        n, t = k >> 3, k & 7
        if t == 0:
            v, i = _varint(b, i)
        elif t == 2:
            l, i = _varint(b, i)
            v = b[i:i + l]
            i += l
        elif t == 5:
            v, i = b[i:i + 4], i + 4
        elif t == 1:
            v, i = b[i:i + 8], i + 8
        else:
            raise ValueError(f"type protobuf {t}")
        yield n, t, v


def _paquet(b: bytes) -> list[int]:
    out, i = [], 0
    while i < len(b):
        v, i = _varint(b, i)
        out.append(v)
    return out


def _zz(n: int) -> int:
    return (n >> 1) ^ -(n & 1)


def _trace(geom: list[int]) -> tuple[float, list[tuple[int, int]]]:
    """Longueur (unités de tuile) et sommets d'une ligne encodée."""
    x = y = 0
    tot, pts, i = 0.0, [], 0
    while i < len(geom):
        cmd, cnt = geom[i] & 7, geom[i] >> 3
        i += 1
        if cmd == 7:
            continue
        for _ in range(cnt):
            dx, dy = _zz(geom[i]), _zz(geom[i + 1])
            i += 2
            if cmd == 2:
                tot += math.hypot(dx, dy)
            x += dx
            y += dy
            pts.append((x, y))
    return tot, pts


def _voies(b: bytes):
    """(propriétés, géométrie encodée, étendue) des lignes de la couche transportation."""
    for n, _, couche in _champs(b):
        if n != 3:
            continue
        nom, cles, vals, feats, ext = None, [], [], [], 4096
        for m, _, v in _champs(couche):
            if m == 1:
                nom = v.decode()
            elif m == 3:
                cles.append(v.decode())
            elif m == 4:
                val = None
                for p, _, w in _champs(v):
                    val = w.decode() if p == 1 else w
                    break
                vals.append(val)
            elif m == 2:
                feats.append(v)
            elif m == 5:
                ext = v
        if nom != "transportation":
            continue
        for f in feats:
            tags, geom = [], []
            for p, _, w in _champs(f):
                if p == 2:
                    tags = _paquet(w)
                elif p == 4:
                    geom = _paquet(w)
            prop = {cles[tags[j]]: vals[tags[j + 1]] for j in range(0, len(tags) - 1, 2)}
            yield prop, geom, ext
        return


# ── Tuiles ───────────────────────────────────────────────────────────────────

def _tuile_xy(lat: float, lon: float) -> tuple[float, float]:
    n = 2 ** Z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def _latlon(x: float, y: float) -> tuple[float, float]:
    n = 2 ** Z
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n)))), x / n * 360 - 180


def _dist_km(a, b) -> float:
    x = math.radians(b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    return 6371 * math.hypot(x, math.radians(b[0] - a[0]))


def _cap(a, b) -> int:
    """Direction (degrés, 0 = nord) de a vers b."""
    x = math.radians(b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    return round(math.degrees(math.atan2(x, math.radians(b[0] - a[0])))) % 360


def _gabarit() -> str:
    global _url_tuiles
    if _url_tuiles and time.time() - _url_tuiles[0] < 86400:
        return _url_tuiles[1]
    with urllib.request.urlopen(urllib.request.Request(TILEJSON, headers=_UA), timeout=10) as r:
        url = json.loads(r.read())["tiles"][0]
    _url_tuiles = (time.time(), url)
    return url


def _mesurer(gabarit: str, x: int, y: int) -> Optional[dict]:
    cle = (gabarit, x, y)
    if cle in _cache:
        return _cache[cle]
    try:
        url = gabarit.replace("{z}", str(Z)).replace("{x}", str(x)).replace("{y}", str(y))
        with urllib.request.urlopen(urllib.request.Request(url, headers=_UA), timeout=10) as r:
            b = r.read()
    except Exception as e:  # tuile absente (mer) ou réseau : la zone est simplement ignorée
        _log.info("Tuile %s/%s indisponible : %s", x, y, e)
        return None
    if b[:2] == b"\x1f\x8b":
        b = gzip.decompress(b)
    lat0, lon0 = _latlon(x, y)
    lat1, lon1 = _latlon(x + 1, y + 1)
    largeur = _dist_km((lat0, lon0), (lat0, lon1))
    chemins = routes = 0.0
    sommets: list[tuple[float, float]] = []
    for prop, geom, ext in _voies(b):
        longueur, pts = _trace(geom)
        classe, sous, revet = prop.get("class"), prop.get("subclass"), prop.get("surface")
        km = longueur / ext * largeur
        if classe in ("path", "track"):
            chemin = revet == "unpaved" or (revet is None and (classe == "track" or sous not in _TROTTOIRS))
        else:
            chemin = False
        if chemin:
            chemins += km
            # Quelques sommets du chemin : candidats pour le point de départ
            for px, py in pts[:: max(1, len(pts) // 3)]:
                if 0 <= px <= ext and 0 <= py <= ext:
                    sommets.append(_latlon(x + px / ext, y + py / ext))
        elif classe in _ROUTES or classe in ("path", "track"):
            routes += km
    m = {"chemins": chemins, "routes": routes, "sommets": sommets[:400],
         "centre": _latlon(x + 0.5, y + 0.5)}
    if len(_cache) > 3000:
        _cache.clear()
    _cache[cle] = m
    return m


def _reliefs(centres: list[tuple[float, float]], rayon_km: float = 1.5) -> list[Optional[float]]:
    """Écart d'altitude (max − min) autour de chaque centre, en un seul appel OpenTopoData."""
    pts = []
    for lat, lon in centres:
        dlat = rayon_km / 111.2
        dlon = dlat / max(0.2, math.cos(math.radians(lat)))
        pts += [(lat, lon), (lat + dlat, lon), (lat - dlat, lon), (lat, lon + dlon), (lat, lon - dlon)]
    try:
        q = urllib.parse.urlencode({"locations": "|".join(f"{a:.5f},{b:.5f}" for a, b in pts)}, safe=",|")
        with urllib.request.urlopen(urllib.request.Request(f"{ALTITUDES}?{q}", headers=_UA), timeout=10) as r:
            alt = [p.get("elevation") for p in json.loads(r.read()).get("results", [])]
    except Exception as e:
        _log.info("Altitudes indisponibles : %s", e)
        return [None] * len(centres)
    res = []
    for i in range(len(centres)):
        v = [a for a in alt[5 * i:5 * i + 5] if a is not None]
        res.append(max(v) - min(v) if len(v) >= 3 else None)
    return res


def departs(depart: list[float], rayon_km: float, distance_km: float, dplus_m: Optional[int],
            nombre: int = 3) -> list[dict]:
    """Jusqu'à `nombre` départs : {"pos": [lat, lon], "direction": cap vers le cœur de la zone}.

    Le départ demandé est gardé en tête s'il est déjà dans une zone de chemins comparable."""
    debut = time.monotonic()
    gabarit = _gabarit()
    cx, cy = _tuile_xy(*depart)
    lat0 = math.radians(depart[0])
    largeur = 40075 * math.cos(lat0) / 2 ** Z
    n = int(math.ceil(rayon_km / largeur)) + 1
    cases = [(int(cx) + i, int(cy) + j) for i in range(-n, n + 1) for j in range(-n, n + 1)]
    with ThreadPoolExecutor(max_workers=8) as ex:
        mesures = dict(zip(cases, ex.map(lambda c: _mesurer(gabarit, *c), cases)))

    def valeur(m):  # beaucoup de chemins, et des chemins qui dominent les routes
        if not m:
            return 0.0
        return m["chemins"] * m["chemins"] / (m["chemins"] + m["routes"] + 0.5)

    # Une boucle déborde de sa tuile : on lisse sur les voisines (le cœur compte double)
    lisse = {c: 2 * valeur(m) + sum(valeur(mesures.get((c[0] + i, c[1] + j)))
                                   for i in (-1, 0, 1) for j in (-1, 0, 1) if i or j)
             for c, m in mesures.items() if m}
    if not lisse:
        return []
    ici = (int(cx), int(cy))
    zones = []
    for c, s in lisse.items():
        d = _dist_km(depart, mesures[c]["centre"])
        if d > rayon_km + largeur / 2 and c != ici:
            continue
        zones.append({"case": c, "score": s * (1 - 0.35 * min(1.0, d / max(rayon_km, 0.1))), "brut": s})
    zones.sort(key=lambda z: -z["score"])

    # Relief des meilleures zones quand un D+ est visé (une montée tous les 5 km environ)
    if dplus_m and zones:
        tete = zones[:8]
        besoin = dplus_m / max(1.0, distance_km / 5)
        for z, rel in zip(tete, _reliefs([mesures[z["case"]]["centre"] for z in tete])):
            if rel is not None:
                z["relief"] = rel
                z["score"] *= min(1.0, (rel + 20) / max(besoin, 40)) ** 0.7
        zones = sorted(tete, key=lambda z: -z["score"]) + zones[8:]

    ecart = max(2.5, rayon_km / 3)
    choisies: list[dict] = []
    for z in zones:
        if all(_dist_km(mesures[z["case"]]["centre"], mesures[c["case"]]["centre"]) >= ecart for c in choisies):
            choisies.append(z)
        if len(choisies) >= nombre:
            break

    res = []
    meilleur = choisies[0]["score"] if choisies else 0
    ici_zone = next((z for z in zones if z["case"] == ici), None)
    if ici_zone and ici_zone["score"] >= 0.85 * meilleur:
        res.append({"pos": list(depart), "direction": None})
        choisies = [z for z in choisies if z["case"] != ici][: nombre - 1]
    for z in choisies:
        m = mesures[z["case"]]
        # Cœur de la zone : barycentre des tuiles voisines pondéré par leurs chemins
        poids = [(valeur(mesures.get((z["case"][0] + i, z["case"][1] + j))),
                  _latlon(z["case"][0] + i + 0.5, z["case"][1] + j + 0.5)) for i in (-1, 0, 1) for j in (-1, 0, 1)]
        tot = sum(p for p, _ in poids) or 1
        coeur = (sum(p * c[0] for p, c in poids) / tot, sum(p * c[1] for p, c in poids) / tot)
        pos = min(m["sommets"], key=lambda s: _dist_km(depart, s)) if m["sommets"] else m["centre"]
        res.append({"pos": [round(pos[0], 6), round(pos[1], 6)], "direction": _cap(pos, coeur),
                    "relief": z.get("relief")})
    _log.info("Zones de départ (%s km) : %d tuiles en %.1f s → %s", rayon_km, len(cases),
              time.monotonic() - debut, [(r["pos"], r["direction"]) for r in res])
    return res[:nombre]
