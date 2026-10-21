"""
Propositions d'itinéraires (boucles ou aller simple).

Service principal : BRouter (serveur public brouter.de, gratuit et sans clé, profils
randonnée et VTT qui privilégient vraiment les sentiers). Secours : OpenRouteService si la
clé ORS_API_KEY est présente (environ 2 000 calculs par jour).

Pour une boucle, le service ne vise qu'une longueur : on calcule en un seul tour six
variantes (directions et longueurs étalées autour de la cible, recalée sur l'écart appris
lors des recherches précédentes), puis on garde celles qui collent le mieux à la distance
et au D+ visés.
"""
from __future__ import annotations

import json
import math
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from statistics import median
from typing import Optional

import carnet_service as cs
import itineraires_zones

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

# Poids de la part de bitume dans le classement : trail, rando et gravel se font sur les chemins.
# Au-delà de 25 % de bitume, chaque point compte trois fois : une boucle très routière passe
# derrière une boucle de chemins même si celle-ci s'éloigne davantage de la distance ou du D+.
_BITUME = {"trail": 2.5, "randonnee": 2.0, "gravel": 2.0, "vtt": 1.5}
_BITUME_SEUIL = 25


_ETALEMENT = (0.85, 1.0, 1.15, 0.92, 1.08, 1.0)
_RAPPORT: dict[str, float] = {}


class ItineraireErreur(Exception):
    pass


class _Passager(Exception):
    pass


class _Surcharge(ItineraireErreur):
    """Le serveur public refuse encore après les pauses : inutile d'enchaîner d'autres calculs."""


def cle() -> Optional[str]:
    return (os.environ.get("ORS_API_KEY") or "").strip() or None


# ─────────────────────────────── BRouter ───────────────────────────────

BROUTER = "https://brouter.de/brouter"

# Sport du carnet → profil BRouter (sans option, avec « sentiers » ou « éviter les routes »)
PROFILS_BR = {
    "course":    ("hiking-beta", "hiking-mountain"),
    "trail":     ("hiking-mountain", "hiking-mountain"),
    "randonnee": ("hiking-mountain", "hiking-mountain"),
    "velo":      ("fastbike-lowtraffic", "fastbike-lowtraffic"),
    "gravel":    ("mtb", "mtb"),  # le profil « gravel » de BRouter reste à 80-90 % sur route
    "vtt":       ("mtb", "mtb"),
}

# Pénalité des voies goudronnées ou hors sentier (variable « path_preference » des profils) pour
# les sports de chemins : environ deux fois moins de bitume sur les boucles autour de Lyon
CHEMINS_BR = {"hiking-mountain": 20, "mtb": 40}
_SPORTS_CHEMINS = {"trail", "randonnee", "gravel", "vtt"}

# Revêtements et voies OSM (étiquettes WayTags renvoyées par BRouter)
_PAVE_OSM = {"asphalt", "paved", "concrete", "concrete:plates", "concrete:lanes", "paving_stones",
             "sett", "cobblestone", "unhewn_cobblestone", "chipseal", "metal"}
_ROUTE_OSM = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
              "service", "living_street", "pedestrian", "road", "cycleway", "motorway_link", "trunk_link",
              "primary_link", "secondary_link", "tertiary_link"}
_SENTIER_OSM = {"path", "footway", "steps", "bridleway"}


def _brouter(params: dict, essais: int = 3) -> dict:
    """Appel BRouter, relancé après une pause si le serveur public demande d'attendre
    (il accepte une dizaine de calculs d'affilée par adresse, puis freine quelques secondes)."""
    url = BROUTER + "?" + urllib.parse.urlencode({**params, "format": "geojson"}, safe=",|:")
    for n in range(essais):
        try:
            return _brouter_unique(url)
        except _Passager as e:
            if n == essais - 1:
                raise _Surcharge(str(e))
            time.sleep(4 * (n + 1))


def _brouter_unique(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "Carnet (carnet d'entrainement personnel)"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            texte = r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        texte = e.read().decode("utf-8", "replace")
        if e.code in (429, 502, 503, 504):
            raise _Passager("BRouter est surchargé pour le moment. Réessaie dans un instant.")
    except (urllib.error.URLError, TimeoutError):
        raise _Passager("BRouter ne répond pas. Réessaie dans un instant.")
    try:
        return json.loads(texte)
    except ValueError:
        pass
    m = texte.strip().lower()
    if "retry later" in m:
        raise _Passager("Le serveur d'itinéraires gratuit limite le nombre de calculs à la suite. Réessaie dans une minute.")
    if "not mapped" in m or "not found" in m or "no track" in m:
        raise ItineraireErreur("Aucun chemin praticable trouvé près du point de départ (ou d'arrivée). Déplace-le un peu.")
    if "watchdog" in m or "timeout" in m:
        raise ItineraireErreur("Calcul trop long pour BRouter : essaie une distance plus courte.")
    _log.warning("BRouter : %s", texte[:200])
    raise ItineraireErreur("BRouter n'a pas trouvé d'itinéraire.")


def _type_voie(tags: dict) -> str:
    """« bitume », « chemin » ou « sentier » d'après les étiquettes OSM d'un tronçon."""
    voie, revet = tags.get("highway", ""), tags.get("surface")
    if revet:
        pave = revet in _PAVE_OSM
    elif voie == "track":
        pave = tags.get("tracktype") == "grade1"
    elif voie in ("footway", "path"):
        pave = tags.get("footway") in ("sidewalk", "crossing")
    else:
        pave = voie in _ROUTE_OSM
    if pave:
        return "bitume"
    return "sentier" if voie in _SENTIER_OSM else "chemin"


def _terrains_br(messages: list) -> list[list]:
    """Tronçons successifs [début km, fin km, type] le long du tracé (types voisins fusionnés)."""
    if not messages or len(messages) < 2:
        return []
    entete = messages[0]
    try:
        i_dist, i_tags = entete.index("Distance"), entete.index("WayTags")
    except ValueError:
        return []
    res: list[list] = []
    km = 0.0
    for ligne in messages[1:]:
        try:
            d = float(ligne[i_dist]) / 1000
        except (ValueError, IndexError):
            continue
        t = _type_voie(dict(x.split("=", 1) for x in ligne[i_tags].split() if "=" in x))
        if res and (res[-1][2] == t or d < 0.03):  # bouts de moins de 30 m : rattachés au précédent
            res[-1][1] = km + d
        else:
            res.append([km, km + d, t])
        km += d
    # Fusion après absorption des petits bouts
    fus: list[list] = []
    for t in res:
        if fus and fus[-1][2] == t[2]:
            fus[-1][1] = t[1]
        else:
            fus.append(t)
    return [[round(a, 3), round(b, 3), t] for a, b, t in fus]


def _repartition_br(terrains: list[list]) -> Optional[dict]:
    """Part (en %) de bitume, de chemin et de sentier d'après les étiquettes OSM du tracé."""
    parts = {"bitume": 0.0, "chemin": 0.0, "sentier": 0.0}
    for a, b, t in terrains:
        parts[t] += b - a
    total = sum(parts.values())
    if not total:
        return None
    return {k: round(100 * v / total) for k, v in parts.items()}


def _lire_br(res: dict) -> Optional[dict]:
    f = (res.get("features") or [None])[0]
    if not f:
        return None
    coords = f.get("geometry", {}).get("coordinates") or []
    if len(coords) < 2:
        return None
    prop = f.get("properties", {})
    dplus = cs.denivele_positif([c[2] for c in coords if len(c) > 2]) or 0
    terrains = _terrains_br(prop.get("messages") or [])
    return {
        "distance_km": round(float(prop.get("track-length") or 0) / 1000, 2),
        "dplus_m": dplus,
        "duree_s": round(float(prop.get("total-time") or 0)),
        "repartition": _repartition_br(terrains),
        "terrains": terrains,
        "points": [[round(c[1], 6), round(c[0], 6), round(c[2], 1) if len(c) > 2 else None] for c in coords],
    }


# ─────────────────────────── OpenRouteService ───────────────────────────


def _appel(profil: str, corps: dict, essais: int = 3) -> dict:
    """Appel ORS, relancé après une courte pause si leur serveur est momentanément en erreur."""
    for n in range(essais):
        try:
            return _appel_unique(profil, corps)
        except _Passager as e:
            if n == essais - 1:
                raise ItineraireErreur(str(e))
            time.sleep(1.5 * (n + 1))


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
    part = (r.get("repartition") or {}).get("bitume", 0)
    e = bitume * (part + 2 * max(0, part - _BITUME_SEUIL)) / 100
    # Au-delà de 15 % d'écart, chaque point compte triple : la première proposition doit coller
    # à la demande, pas seulement être la moins mauvaise sur un critère
    if distance_km:
        x = abs(r["distance_km"] - distance_km) / distance_km
        e += x + 2 * max(0, x - 0.15)
    if dplus_m is not None:
        x = abs(r["dplus_m"] - dplus_m) / max(dplus_m, 150)
        e += x + 2 * max(0, x - 0.15)
    return e


def _differente(r: dict, gardees: list[dict]) -> bool:
    """Écarte les quasi-doublons (même départ, même distance et même D+ à peu de chose près)."""
    return all(abs(r["distance_km"] - g["distance_km"]) > 0.25 or abs(r["dplus_m"] - g["dplus_m"]) > 15
               or itineraires_zones._dist_km(r.get("depart") or [0, 0], g.get("depart") or [0, 0]) > 1 for g in gardees)


def proposer(sport: str, depart: list[float], arrivee: Optional[list[float]], distance_km: Optional[float],
             dplus_m: Optional[int], sentiers: bool, eviter_routes: bool, essai: int = 0, nombre: int = 4,
             rayon_km: float = 0) -> dict:
    if not arrivee and not distance_km:
        raise ItineraireErreur("Indique la distance de la boucle.")
    # Poids du bitume au classement : imposé pour trail / rando / VTT, demandé par « Éviter les routes »
    bitume = max(_BITUME.get(sport, 0), 1.5 if eviter_routes else 0)
    try:
        res = _proposer_br(sport, depart, arrivee, distance_km, sentiers or eviter_routes, essai,
                           _departs(depart, None if arrivee else rayon_km, distance_km, dplus_m), dplus_m)
    except ItineraireErreur as e:
        if not cle():
            raise
        _log.warning("BRouter en échec (%s), secours OpenRouteService", e)
        res = _proposer_ors(sport, depart, arrivee, distance_km, sentiers, essai)

    toutes = res.pop("toutes")
    # À qualité égale, le départ le plus proche du point demandé passe devant
    proche = lambda r: 0.15 * r.get("approche_km", 0) / max(rayon_km, 1)
    toutes.sort(key=lambda r: _ecart(r, None if arrivee else distance_km, dplus_m, bitume) + proche(r))
    gardees: list[dict] = []
    for r in toutes:
        if _differente(r, gardees):
            gardees.append(r)
        if len(gardees) >= nombre:
            break
    for r in gardees:
        r.pop("_reglage", None)
    if dplus_m and gardees and _ecart_dplus(gardees[0], dplus_m) > 0.25:
        plus = gardees[0]["dplus_m"] > dplus_m
        res["avertissement"] = (f"Le relief autour de ce départ ne permet pas d'approcher {dplus_m} m D+ "
                                f"sur cette distance : la boucle la plus proche en fait {gardees[0]['dplus_m']}. "
                                + ("Essaie un départ en vallée ou un D+ plus élevé." if plus
                                   else "Essaie un départ plus près du relief ou un rayon plus grand."))
    return {**res, "propositions": gardees}


def tracer(sport: str, points: list[list[float]], sentiers: bool = False) -> dict:
    """Tracé passant par les points donnés, dans l'ordre (retouche d'un itinéraire à la main).
    `etapes` : indice, dans `points` du tracé, du passage au plus près de chaque point demandé."""
    profil = PROFILS_BR.get(sport, PROFILS_BR["course"])[1 if sentiers else 0]
    params = {"lonlats": "|".join(f"{p[1]:.6f},{p[0]:.6f}" for p in points), "profile": profil, "alternativeidx": 0}
    if (sport in _SPORTS_CHEMINS or sentiers) and profil in CHEMINS_BR:
        params["profile:path_preference"] = CHEMINS_BR[profil]
    r = _lire_br(_brouter(params))
    if not r:
        raise ItineraireErreur("Aucun tracé trouvé par ces points.")
    r["etapes"] = _etapes(r["points"], points)
    return r


def _etapes(trace: list[list], demandes: list[list[float]]) -> list[int]:
    """Indices du tracé les plus proches de chaque point demandé, en avançant le long du tracé
    (une boucle repasse par son départ : la dernière étape est cherchée après les autres)."""
    res, debut = [], 0
    for k, p in enumerate(demandes):
        if k == 0:
            res.append(0)
            continue
        if k == len(demandes) - 1:
            res.append(len(trace) - 1)
            continue
        # Premier passage au plus près (à 25 m près) : un tracé qui repasse plus loin au même
        # endroit ne doit pas faire sauter les étapes intermédiaires
        dist = [_dist_ll(trace[i], p) for i in range(debut, len(trace))]
        d_min = min(dist)
        i = next(j for j, d in enumerate(dist) if d <= d_min + 25)
        while i + 1 < len(dist) and dist[i + 1] < dist[i]:
            i += 1
        debut += i
        res.append(debut)
    return res


def _dist_ll(a: list, b: list) -> float:
    """Distance en mètres entre deux points [lat, lon, …]."""
    x = math.radians(b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    return 6371000 * math.hypot(x, math.radians(b[0] - a[0]))


def _departs(depart: list[float], rayon_km: Optional[float], distance_km, dplus_m) -> list[dict]:
    """Départs à essayer : le point demandé, ou les zones de chemins les plus proches dans le rayon."""
    ici = [{"pos": list(depart), "direction": None}]
    if not rayon_km:
        return ici
    try:
        return itineraires_zones.departs(depart, rayon_km, distance_km, dplus_m) or ici
    except Exception as e:  # tuiles injoignables : on reste au point demandé
        _log.warning("Recherche de zones de chemins impossible : %s", e)
        return ici


# Longueurs demandées autour de la cible, et rapport longueur obtenue / paramètre envoyé,
# appris par service et par profil (BRouter vise un rayon : la boucle fait environ 5 fois plus)
_RAPPORT_INITIAL = {"br": 5.2, "ors": 1.0}


def _boucles(source: str, profil: str, distance_km: float, essai: int, calcul, workers: int) -> list[dict]:
    """Six boucles en un tour : graines (ou directions) et longueurs étalées autour de la cible."""
    cle_r = f"{source}:{profil}"
    initial = _RAPPORT_INITIAL[source]
    vise = distance_km / _RAPPORT.get(cle_r, initial)
    erreurs: list[ItineraireErreur] = []

    def une(gf):
        graine, facteur = gf
        if any(isinstance(e, _Surcharge) for e in erreurs):
            return None
        try:
            return calcul(vise * facteur, graine)
        except ItineraireErreur as e:
            _log.info("Boucle %s refusée (graine %s) : %s", source, graine, e)
            erreurs.append(e)
            return None

    base = 6 * essai  # « Autres propositions » : nouvelles graines
    debut = time.monotonic()
    with ThreadPoolExecutor(max_workers=workers) as ex:
        paires = [(r, f) for r, f in zip(ex.map(une, zip(range(base, base + 6), _ETALEMENT)), _ETALEMENT) if r]
    toutes = [r for r, _ in paires]
    _log.info("Itinéraires %s %s %.1f km : %d boucles en %.1f s", source, profil, distance_km, len(toutes),
              time.monotonic() - debut)
    if not toutes:
        raise erreurs[0] if erreurs else ItineraireErreur("Aucune boucle trouvée depuis ce point.")
    rapport = median(r["distance_km"] / (vise * f) for r, f in paires)
    _RAPPORT[cle_r] = round(min(2 * initial, max(initial / 2, 0.5 * _RAPPORT.get(cle_r, initial) + 0.5 * rapport)), 3)
    return toutes


def _proposer_br(sport, depart, arrivee, distance_km, sentiers, essai, departs: list[dict],
                 dplus_m: Optional[int] = None) -> dict:
    profil = PROFILS_BR.get(sport, PROFILS_BR["course"])[1 if sentiers else 0]
    a = f"{depart[1]:.6f},{depart[0]:.6f}"  # BRouter : lon,lat
    source = {"source": "BRouter", "profil": profil}
    reglage = {}
    if (sport in _SPORTS_CHEMINS or sentiers) and profil in CHEMINS_BR:
        reglage["profile:path_preference"] = CHEMINS_BR[profil]

    if arrivee:
        b = f"{arrivee[1]:.6f},{arrivee[0]:.6f}"
        toutes, erreurs = [], []
        for idx in range(3):  # tracé principal puis deux variantes
            try:
                r = _lire_br(_brouter({"lonlats": f"{a}|{b}", "profile": profil, "alternativeidx": idx, **reglage}))
            except ItineraireErreur as e:
                erreurs.append(e)
                if isinstance(e, _Surcharge):
                    break
                continue
            if r:
                toutes.append(r)
        if not toutes:
            raise erreurs[0] if erreurs else ItineraireErreur("Aucun itinéraire trouvé entre ces deux points.")
        return {**source, "toutes": toutes, "calculs": 3}

    def calculer(pos: list[float], direction: float, longueur_km: float, essais: int = 3) -> Optional[dict]:
        r = _lire_br(_brouter(essais=essais, params={"lonlats": f"{pos[1]:.6f},{pos[0]:.6f}", "profile": profil,
                               "alternativeidx": 0, "engineMode": 4,
                               "roundTripDistance": round(longueur_km * 1000), "direction": round(direction) % 360,
                               **reglage}))
        if r:
            r["depart"] = pos
            r["approche_km"] = round(itineraires_zones._dist_km(depart, pos), 1)
            r["_reglage"] = (pos, direction, longueur_km)
        return r

    def boucle(longueur_km: float, graine: int) -> Optional[dict]:
        # Les six calculs se répartissent entre les départs retenus. Sans zone visée : six directions
        # autour du départ ; vers une zone de chemins : partir vers son cœur, de part et d'autre.
        d = departs[graine % len(departs)]
        tour = graine // len(departs)
        if d["direction"] is None:
            direction = (tour * 360 // max(1, 6 // len(departs))) + (graine // 6) * 23
        else:
            direction = d["direction"] + (-35 if tour % 2 else 35) + (graine // 6) * 23
        return calculer(d["pos"], direction, longueur_km)

    # Serveur public partagé : il freine les calculs simultanés, on les enchaîne
    toutes = _boucles("br", profil, distance_km, essai, boucle, 1)
    calculs = 6
    if dplus_m:
        toutes += _affiner(toutes, distance_km, dplus_m, calculer)
        calculs = len(toutes)
    return {**source, "toutes": toutes, "calculs": calculs}


def _ecart_dplus(r: dict, dplus_m: int) -> float:
    return abs(r["dplus_m"] - dplus_m) / max(dplus_m, 150)


def _affiner(toutes: list[dict], distance_km: float, dplus_m: int, calculer) -> list[dict]:
    """Tours supplémentaires quand aucune boucle n'approche le D+ visé : le relief change beaucoup
    d'une direction à l'autre (vallée ou versant). À chaque tour on repart des deux boucles les
    plus proches de la demande en tournant de moins en moins, longueur recalée sur la distance."""
    def proche(r):
        return _ecart_dplus(r, dplus_m) + abs(r["distance_km"] - distance_km) / distance_km

    def bonne(r):
        return _ecart_dplus(r, dplus_m) <= 0.15 and abs(r["distance_km"] - distance_km) / distance_km <= 0.12

    # Au plus quatre calculs de plus : le serveur public freine au-delà d'une dizaine d'affilée
    res, faits, debut = [], set(), time.monotonic()
    for decalage in (35, 15):
        if any(bonne(r) for r in toutes + res) or len(faits) >= 4 or time.monotonic() - debut > 25:
            break
        meilleures = sorted((r for r in toutes + res if r.get("_reglage") and r["distance_km"]), key=proche)[:2]
        for r in meilleures:
            pos, direction, longueur = r["_reglage"]
            longueur *= max(0.7, min(1.4, distance_km / r["distance_km"]))
            for d in (direction - decalage, direction + decalage):
                cle_e = (tuple(pos), round(d) % 360, round(longueur, 1))
                if cle_e in faits or len(faits) >= 4:
                    continue
                faits.add(cle_e)
                try:
                    n = calculer(pos, d, longueur, essais=2)
                except _Surcharge:
                    return res
                except ItineraireErreur as e:
                    _log.info("Boucle d'affinage refusée : %s", e)
                    continue
                if n:
                    res.append(n)
    _log.info("Affinage D+ %s m : %d boucles de plus en %.1f s", dplus_m, len(res), time.monotonic() - debut)
    return res


def _proposer_ors(sport, depart, arrivee, distance_km, sentiers, essai) -> dict:
    profil = PROFILS.get(sport, PROFILS["course"])[1 if sentiers else 0]
    a = [depart[1], depart[0]]  # ORS : [lon, lat]
    source = {"source": "OpenRouteService", "profil": profil}

    if arrivee:
        corps = _corps([a, [arrivee[1], arrivee[0]]])
        corps["alternative_routes"] = {"target_count": 3, "weight_factor": 1.4 + 0.3 * min(essai, 3), "share_factor": 0.6}
        toutes = [r for r in map(_lire, _appel(profil, corps).get("features", [])) if r]
        if not toutes:
            raise ItineraireErreur("Aucun itinéraire trouvé entre ces deux points.")
        return {**source, "toutes": toutes, "calculs": 1}

    def boucle(longueur_km: float, graine: int) -> Optional[dict]:
        corps = _corps([a])
        corps["options"]["round_trip"] = {"length": round(longueur_km * 1000), "points": 3 + graine % 3, "seed": graine}
        f = _appel(profil, corps).get("features", [])
        return _lire(f[0]) if f else None

    return {**source, "toutes": _boucles("ors", profil, distance_km, essai, boucle, 4), "calculs": 6}


# ─────────────────────────── Temps estimé ───────────────────────────

# Distance-effort : 100 m de D+ comptent comme 1 km à pied, 1,5 km à vélo
EFFORT_DPLUS = {"course": 1.0, "trail": 1.0, "randonnee": 1.0, "velo": 1.5, "gravel": 1.5, "vtt": 1.5}

# Sport d'itinéraire → (sports du carnet, facteur de durée), du plus proche au plus lointain
_ALLURES_SOURCES = {
    "course":    [(("course",), 1.0), (("trail",), 0.85)],
    "trail":     [(("trail",), 1.0), (("course",), 1.25)],
    "randonnee": [(("randonnee", "marche"), 1.0), (("trail",), 1.7)],
    "velo":      [(("velo",), 1.0)],
    "gravel":    [(("velo",), 1.2)],
    "vtt":       [(("velo",), 1.5)],
}
# Sans historique : secondes par km-effort
_ALLURES_DEFAUT = {"course": 360, "trail": 450, "randonnee": 720, "velo": 140, "gravel": 175, "vtt": 230}


def allures(db, user_id: int) -> dict:
    """Allure habituelle (secondes par km-effort) de chaque sport d'itinéraire, d'après les
    sorties d'entraînement des six derniers mois (médiane des 15 plus récentes)."""
    from datetime import datetime, timedelta
    from models import Activite

    depuis = datetime.now() - timedelta(days=183)
    lignes = (db.query(Activite.sport, Activite.duree_sec, Activite.distance_km, Activite.dplus_m)
              .filter(Activite.utilisateur_id == user_id, Activite.debut >= depuis,
                      Activite.duree_sec > 0, Activite.distance_km >= 3,
                      Activite.est_competition.isnot(True))
              .order_by(Activite.debut.desc()).all())
    par_sport: dict[str, list[float]] = {}
    for sport, duree, dist, dplus in lignes:
        if sport == "trail" and dplus is None:
            continue  # D+ inconnu : l'allure serait faussée
        f = EFFORT_DPLUS.get("velo" if sport == "velo" else "course", 1.0)
        effort = dist + (dplus or 0) / 100 * f
        par_sport.setdefault(sport, []).append(duree / effort)

    res = {}
    for sport, sources in _ALLURES_SOURCES.items():
        for noms, facteur in sources:
            valeurs = [v for n in noms for v in par_sport.get(n, [])][:15]
            if len(valeurs) >= 3:
                res[sport] = {"s_par_km_effort": round(median(valeurs) * facteur), "seances": len(valeurs),
                              "base": noms[0], "effort_dplus": EFFORT_DPLUS[sport]}
                break
        else:
            res[sport] = {"s_par_km_effort": _ALLURES_DEFAUT[sport], "seances": 0, "base": None,
                          "effort_dplus": EFFORT_DPLUS[sport]}
    return res
