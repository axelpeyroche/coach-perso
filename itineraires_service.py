"""
Propositions d'itinéraires (boucles ou aller simple) avec OpenRouteService.

Gratuit : clé personnelle dans la variable d'environnement ORS_API_KEY (environ 2 000
calculs par jour). Pour une boucle, ORS ne vise qu'une longueur : on calcule plusieurs
variantes (graines et nombres de points différents), on recale la longueur demandée sur
l'écart observé, puis on garde celles qui collent le mieux à la distance et au D+ visés.
"""
from __future__ import annotations

import json
import logging
import os
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

# Types de voie ORS (extra « waytype ») → route / chemin / sentier
_ROUTE, _CHEMIN, _SENTIER = {1, 2, 3}, {5, 6}, {4, 7, 8}


class ItineraireErreur(Exception):
    pass


def cle() -> Optional[str]:
    return (os.environ.get("ORS_API_KEY") or "").strip() or None


def _appel(profil: str, corps: dict) -> dict:
    req = urllib.request.Request(URL.format(profil=profil), data=json.dumps(corps).encode(), method="POST",
                                 headers={"Authorization": cle(), "Content-Type": "application/json",
                                          "Accept": "application/geo+json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
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


def _corps(points: list[list[float]], profil: str, eviter_routes: bool) -> dict:
    corps = {"coordinates": points, "elevation": True, "instructions": False,
             "extra_info": ["waytype", "surface"], "options": {}}
    if eviter_routes and profil in PIED:
        corps["options"]["profile_params"] = {"weightings": {"quiet": 1, "green": 1}}
    return corps


def _lire(feature: dict) -> Optional[dict]:
    coords = feature.get("geometry", {}).get("coordinates") or []
    if len(coords) < 2:
        return None
    prop = feature.get("properties", {})
    dist = prop.get("summary", {}).get("distance") or 0
    dplus = cs.denivele_positif([c[2] for c in coords if len(c) > 2]) or 0
    repartition = {"route": 0.0, "chemin": 0.0, "sentier": 0.0}
    for s in (prop.get("extras", {}).get("waytypes", {}).get("summary") or []):
        v, d = s.get("value"), s.get("distance") or 0
        k = "route" if v in _ROUTE else "chemin" if v in _CHEMIN else "sentier" if v in _SENTIER else None
        if k:
            repartition[k] += d
    total = sum(repartition.values()) or 1
    return {
        "distance_km": round(dist / 1000, 2),
        "dplus_m": dplus,
        "duree_s": round(prop.get("summary", {}).get("duration") or 0),
        "repartition": {k: round(100 * v / total) for k, v in repartition.items()},
        "points": [[round(c[1], 6), round(c[0], 6), round(c[2], 1) if len(c) > 2 else None] for c in coords],
    }


def _ecart(r: dict, distance_km: Optional[float], dplus_m: Optional[int]) -> float:
    e = 0.0
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

    if arrivee:
        corps = _corps([a, [arrivee[1], arrivee[0]]], profil, eviter_routes)
        corps["alternative_routes"] = {"target_count": 3, "weight_factor": 1.4 + 0.3 * min(essai, 3), "share_factor": 0.6}
        res = [r for r in map(_lire, _appel(profil, corps).get("features", [])) if r]
        if not res:
            raise ItineraireErreur("Aucun itinéraire trouvé entre ces deux points.")
        res.sort(key=lambda r: _ecart(r, None, dplus_m))
        return {"profil": profil, "propositions": res, "calculs": 1}

    if not distance_km:
        raise ItineraireErreur("Indique la distance de la boucle.")

    def boucle(longueur_km: float, graine: int) -> Optional[dict]:
        corps = _corps([a], profil, eviter_routes)
        corps["options"]["round_trip"] = {"length": round(longueur_km * 1000), "points": 3 + graine % 3, "seed": graine}
        try:
            f = _appel(profil, corps).get("features", [])
        except ItineraireErreur as e:
            _log.info("Boucle ORS refusée (graine %s) : %s", graine, e)
            erreurs.append(e)
            return None
        return _lire(f[0]) if f else None

    erreurs: list[ItineraireErreur] = []
    base = 12 * essai  # « Autres propositions » : nouvelles graines
    with ThreadPoolExecutor(max_workers=6) as ex:
        tour1 = [r for r in ex.map(lambda g: boucle(distance_km, g), range(base, base + 6)) if r]
        if not tour1:
            raise erreurs[0] if erreurs else ItineraireErreur("Aucune boucle trouvée depuis ce point.")
        # ORS rend souvent des boucles plus longues ou plus courtes que demandé : on corrige
        ratio = median(r["distance_km"] / distance_km for r in tour1) or 1
        corrigee = distance_km / min(2.0, max(0.5, ratio))
        tour2 = [r for r in ex.map(lambda g: boucle(corrigee, g), range(base + 6, base + 12)) if r]

    toutes = sorted(tour1 + tour2, key=lambda r: _ecart(r, distance_km, dplus_m))
    gardees: list[dict] = []
    for r in toutes:
        if _differente(r, gardees):
            gardees.append(r)
        if len(gardees) >= nombre:
            break
    return {"profil": profil, "propositions": gardees, "calculs": len(tour1) + len(tour2)}
