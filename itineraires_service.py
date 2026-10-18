"""
Propositions d'itinéraires (boucles ou aller simple) avec OpenRouteService.

Gratuit : clé personnelle dans la variable d'environnement ORS_API_KEY (environ 2 000
calculs par jour). Pour une boucle, ORS ne vise qu'une longueur : on calcule en un seul
tour six variantes (graines et longueurs étalées autour de la cible, recalée sur l'écart
appris lors des recherches précédentes), puis on garde celles qui collent le mieux à la
distance et au D+ visés.
"""
from __future__ import annotations

import json
import math
import logging
import os
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from statistics import median
from typing import Optional

import carnet_service as cs

_log = logging.getLogger(__name__)

URL = "https://api.openrouteservice.org/v2/directions/{profil}/geojson"
PIED = ("foot-walking", "foot-hiking")

# Sport du carnet → profil ORS (sans option, avec « privilégier les sentiers »)
PROFILS = {
    "course":    ("foot-walking", "foot-hiking"),
    "trail":     ("foot-hiking", "foot-hiking"),
    "randonnee": ("foot-hiking", "foot-hiking"),
    "velo":      ("cycling-road", "cycling-road"),
    "gravel":    ("cycling-regular", "cycling-mountain"),
    "vtt":       ("cycling-mountain", "cycling-mountain"),
}

# Types de voie ORS (extra « waytype ») : 1-3 routes et rues, 4 path, 5 track, 6 piste cyclable,
# 7 footway, 8 marches. Revêtements ORS (extra « surface ») goudronnés ou pavés :
_ROUTE, _SENTIER = {1, 2, 3}, {4, 7, 8}
_REVETU = {1, 3, 4, 5, 6, 14, 18}

# Poids de la part de bitume dans le classement : un trail se court sur les chemins
_BITUME = {"trail": 2.0, "randonnee": 1.2, "vtt": 1.2}


# Longueurs demandées autour de la cible, et rapport longueur obtenue / demandée appris par profil
_ETALEMENT = (0.85, 1.0, 1.15, 0.92, 1.08, 1.0)
_RAPPORT: dict[str, float] = {}


class ItineraireErreur(Exception):
    pass


def cle() -> Optional[str]:
    return (os.environ.get("ORS_API_KEY") or "").strip() or None


def _appel(profil: str, corps: dict, essais: int = 3) -> dict:
    """Appel ORS, relancé après une courte pause si leur serveur est momentanément en erreur."""
    for n in range(essais):
        try:
            return _appel_unique(profil, corps)
        except _Passager as e:
            if n == essais - 1:
                raise ItineraireErreur(str(e))
            time.sleep(1.5 * (n + 1))


class _Passager(Exception):
    pass


def _appel_unique(profil: str, corps: dict) -> dict:
    req = urllib.request.Request(URL.format(profil=profil), data=json.dumps(corps).encode(), method="POST",
                                 headers={"Authorization": cle(), "Content-Type": "application/json",
                                          "Accept": "application/geo+json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get("error", {})
            msg = msg.get("message") if isinstance(msg, dict) else msg
        except Exception:
            msg = None
        if e.code in (401, 403):
            raise ItineraireErreur("Clé OpenRouteService refusée : vérifie ORS_API_KEY dans Render.")
        if e.code == 429:
            raise ItineraireErreur("Quota OpenRouteService atteint pour le moment. Réessaie dans une minute.")
        if e.code in (500, 502, 503, 504):
            _log.warning("ORS %s : %s", e.code, msg)
            raise _Passager(f"OpenRouteService est surchargé ou en panne (erreur {e.code}). Réessaie dans quelques minutes.")
        raise ItineraireErreur(_traduire(msg) or f"OpenRouteService a répondu {e.code}.")
    except (urllib.error.URLError, TimeoutError):
        raise ItineraireErreur("OpenRouteService ne répond pas. Réessaie dans un instant.")


def _traduire(msg: Optional[str]) -> Optional[str]:
    if not msg:
        return None
    m = msg.lower()
    if "could not find routable point" in m or "routable" in m:
        return "Aucun chemin praticable trouvé près du point de départ (ou d'arrivée). Déplace-le un peu."
    if "distance" in m and ("exceed" in m or "limit" in m):
        return "Distance trop grande pour OpenRouteService."
    return msg


def _corps(points: list[list[float]]) -> dict:
    # Pas de pondération « quiet » / « green » : elle prive ORS de son calcul rapide et les
    # boucles dépassent alors le délai. Le bitume est écarté au classement (_ecart).
    return {"coordinates": points, "elevation": True, "instructions": False,
            "extra_info": ["waytype", "surface"], "options": {}}


def _lire(feature: dict) -> Optional[dict]:
    coords = feature.get("geometry", {}).get("coordinates") or []
    if len(coords) < 2:
        return None
    prop = feature.get("properties", {})
    dist = prop.get("summary", {}).get("distance") or 0
    dplus = cs.denivele_positif([c[2] for c in coords if len(c) > 2]) or 0
    return {
        "distance_km": round(dist / 1000, 2),
        "dplus_m": dplus,
        "duree_s": round(prop.get("summary", {}).get("duration") or 0),
        "repartition": _repartition(coords, prop.get("extras") or {}),
        "points": [[round(c[1], 6), round(c[0], 6), round(c[2], 1) if len(c) > 2 else None] for c in coords],
    }


def _valeurs(extras: dict, *noms: str) -> list:
    for n in noms:
        if (extras.get(n) or {}).get("values"):
            return extras[n]["values"]
    return []


def _repartition(coords: list, extras: dict) -> Optional[dict]:
    """Part (en %) de bitume, de chemin et de sentier, segment par segment."""
    n = len(coords) - 1
    voie, revet = [0] * n, [0] * n
    for tab, nom in ((voie, ("waytypes", "waytype")), (revet, ("surface", "surfaces"))):
        for debut, fin, v in _valeurs(extras, *nom):
            for i in range(int(debut), min(int(fin), n)):
                tab[i] = int(v)
    if not any(voie) and not any(revet):
        return None
    parts = {"bitume": 0.0, "chemin": 0.0, "sentier": 0.0}
    for i in range(n):
        a, b = coords[i], coords[i + 1]
        d = _dist(a, b)
        if revet[i] in _REVETU or (revet[i] == 0 and voie[i] in _ROUTE):
            parts["bitume"] += d
        elif voie[i] in _SENTIER:
            parts["sentier"] += d
        else:
            parts["chemin"] += d
    total = sum(parts.values()) or 1
    return {k: round(100 * v / total) for k, v in parts.items()}


def _dist(a: list, b: list) -> float:
    x = math.radians(b[0] - a[0]) * math.cos(math.radians((a[1] + b[1]) / 2))
    return 6371000 * math.hypot(x, math.radians(b[1] - a[1]))


def _ecart(r: dict, distance_km: Optional[float], dplus_m: Optional[int], bitume: float = 0) -> float:
    e = bitume * (r.get("repartition") or {}).get("bitume", 0) / 100
    if distance_km:
        e += abs(r["distance_km"] - distance_km) / distance_km
    if dplus_m is not None:
        e += abs(r["dplus_m"] - dplus_m) / max(dplus_m, 150)
    return e


def _differente(r: dict, gardees: list[dict]) -> bool:
    """Écarte les quasi-doublons (même distance et même D+ à peu de chose près)."""
    return all(abs(r["distance_km"] - g["distance_km"]) > 0.25 or abs(r["dplus_m"] - g["dplus_m"]) > 15
               for g in gardees)


def proposer(sport: str, depart: list[float], arrivee: Optional[list[float]], distance_km: Optional[float],
             dplus_m: Optional[int], sentiers: bool, eviter_routes: bool, essai: int = 0, nombre: int = 4) -> dict:
    if not cle():
        raise ItineraireErreur("Clé OpenRouteService absente : ajoute ORS_API_KEY dans les variables d'environnement de Render.")
    profil = PROFILS.get(sport, PROFILS["course"])[1 if sentiers else 0]
    a = [depart[1], depart[0]]  # ORS : [lon, lat]
    # Poids du bitume au classement : imposé pour trail / rando / VTT, demandé par « Éviter les routes »
    bitume = max(_BITUME.get(sport, 0), 1.5 if eviter_routes else 0)

    if arrivee:
        corps = _corps([a, [arrivee[1], arrivee[0]]])
        corps["alternative_routes"] = {"target_count": 3, "weight_factor": 1.4 + 0.3 * min(essai, 3), "share_factor": 0.6}
        res = [r for r in map(_lire, _appel(profil, corps).get("features", [])) if r]
        if not res:
            raise ItineraireErreur("Aucun itinéraire trouvé entre ces deux points.")
        res.sort(key=lambda r: _ecart(r, None, dplus_m, bitume))
        return {"profil": profil, "propositions": res, "calculs": 1}

    if not distance_km:
        raise ItineraireErreur("Indique la distance de la boucle.")

    def boucle(longueur_km: float, graine: int) -> Optional[dict]:
        corps = _corps([a])
        corps["options"]["round_trip"] = {"length": round(longueur_km * 1000), "points": 3 + graine % 3, "seed": graine}
        try:
            f = _appel(profil, corps).get("features", [])
        except ItineraireErreur as e:
            _log.info("Boucle ORS refusée (graine %s) : %s", graine, e)
            erreurs.append(e)
            return None
        return _lire(f[0]) if f else None

    erreurs: list[ItineraireErreur] = []
    base = 6 * essai  # « Autres propositions » : nouvelles graines
    # ORS rend des boucles plus longues ou plus courtes que demandé : on part du rapport
    # appris pour ce profil et on étale les longueurs pour encadrer la cible
    vise = distance_km / _RAPPORT.get(profil, 1.0)
    debut = time.monotonic()
    with ThreadPoolExecutor(max_workers=4) as ex:
        paires = [(r, f) for r, f in zip(ex.map(lambda gf: boucle(vise * gf[1], gf[0]),
                                                 zip(range(base, base + 6), _ETALEMENT)), _ETALEMENT) if r]
    toutes = [r for r, _ in paires]
    _log.info("Itinéraires %s %.1f km : %d boucles en %.1f s", profil, distance_km, len(toutes),
              time.monotonic() - debut)
    if not toutes:
        raise erreurs[0] if erreurs else ItineraireErreur("Aucune boucle trouvée depuis ce point.")
    rapport = median(r["distance_km"] / (vise * f) for r, f in paires)
    _RAPPORT[profil] = round(min(2.0, max(0.5, 0.5 * _RAPPORT.get(profil, 1.0) + 0.5 * rapport)), 3)

    toutes.sort(key=lambda r: _ecart(r, distance_km, dplus_m, bitume))
    gardees: list[dict] = []
    for r in toutes:
        if _differente(r, gardees):
            gardees.append(r)
        if len(gardees) >= nombre:
            break
    return {"profil": profil, "propositions": gardees, "calculs": 6}
