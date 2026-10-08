"""
Synchro Intervals.icu : les séances de l'Apple Watch y arrivent toutes seules (app gratuite
« Intervals.icu Companion ») ; on les récupère avec leur tracé GPS, l'altitude et la FC
grâce à la clé API personnelle de l'utilisateur (gratuite).

Chaque séance est fusionnée avec celle du carnet qui commence au même moment (ou créée),
puis son tracé est enregistré et rattaché comme un GPX de l'export Santé. Le flux de FC sert
à calculer les zones et la dérive cardiaque, les autres flux donnent la puissance, la foulée,
l'oscillation verticale, le temps de contact et les pas ; le suivi « wellness » apporte le sommeil,
la FC au repos, la VFC et la VO2max (sans écraser les valeurs envoyées par le raccourci).
"""
from __future__ import annotations

import base64
import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

import analyses_service as an
import carnet_service as cs
from models import Activite, MesureSante, TraceGPS, Utilisateur

_log = logging.getLogger(__name__)

API = "https://intervals.icu/api/v1"
FENETRE_JOURS = 14          # séances relues à chaque synchro (l'iPhone peut envoyer en retard)
PREMIERE_FENETRE_JOURS = 60
INTERVALLE_MIN = timedelta(minutes=15)  # pas plus d'une synchro automatique par quart d'heure
PAS_TRACE_M = 10            # comme les GPX importés : un point tous les 10 m
VERSION_ANALYSE = 2         # zones de FC, dérive cardiaque, puissance, foulée, oscillation, contact, pas


class IntervalsErreur(Exception):
    """Erreur affichable telle quelle à l'utilisateur."""


def _appel(cle: str, chemin: str, params: Optional[dict] = None):
    url = API + chemin + ("?" + urllib.parse.urlencode(params) if params else "")
    auth = base64.b64encode(f"API_KEY:{cle}".encode()).decode()
    req = urllib.request.Request(url, headers={"Authorization": f"Basic {auth}", "Accept": "application/json",
                                               "User-Agent": "coach-perso"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise IntervalsErreur("Clé API Intervals.icu refusée : vérifie-la dans Intervals.icu → Settings → Developer Settings") from e
        if e.code == 404:
            raise IntervalsErreur("Athlète introuvable sur Intervals.icu : vérifie l'identifiant (ex. i123456)") from e
        raise IntervalsErreur(f"Intervals.icu a répondu {e.code}") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise IntervalsErreur("Intervals.icu ne répond pas, réessaie plus tard") from e


def verifier(cle: str, athlete_id: Optional[str]) -> dict:
    """Vérifie la clé ; retourne {id, nom} de l'athlète (« 0 » = celui de la clé)."""
    a = _appel(cle, f"/athlete/{urllib.parse.quote(athlete_id or '0')}")
    return {"id": str(a.get("id") or athlete_id or "0"), "nom": a.get("name") or a.get("firstname")}


def _heure_locale(iso: Optional[str], tz: ZoneInfo) -> Optional[datetime]:
    if not iso:
        return None
    d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return d.astimezone(tz).replace(tzinfo=None) if d.tzinfo else d


def _points(streams: list, debut_seance: datetime) -> tuple[Optional[datetime], list[list]]:
    """Flux Intervals (latlng : data = latitudes, data2 = longitudes ; altitude ; time en s)
    → (heure du premier point, [[lat, lon, altitude|null, secondes depuis le premier point], …])."""
    par_type = {s.get("type"): s for s in streams or []}
    ll = par_type.get("latlng") or {}
    lats, lons = ll.get("data") or [], ll.get("data2") or []
    alts = (par_type.get("altitude") or {}).get("data") or []
    temps = (par_type.get("time") or {}).get("data") or []
    bruts = []
    for i, (la, lo) in enumerate(zip(lats, lons)):
        if la is None or lo is None or not (-90 <= la <= 90 and -180 <= lo <= 180) or (la == 0 and lo == 0):
            continue
        t = temps[i] if i < len(temps) and temps[i] is not None else i
        alt = alts[i] if i < len(alts) else None
        bruts.append([la, lo, alt, t])
    if len(bruts) < 2:
        return None, []
    t0 = bruts[0][3]
    garde = [bruts[0]]
    for i, p in enumerate(bruts[1:], 1):
        if i == len(bruts) - 1 or cs._distance_m(garde[-1], p) >= PAS_TRACE_M:
            garde.append(p)
    pts = [[round(la, 6), round(lo, 6), None if alt is None else round(alt, 1), int(round(t - t0))]
           for la, lo, alt, t in garde]
    return debut_seance + timedelta(seconds=t0), pts


def _donnees(a: dict, tz: ZoneInfo) -> Optional[dict]:
    debut = _heure_locale(a.get("start_date"), tz) or _heure_locale(a.get("start_date_local"), tz)
    if not debut:
        return None
    duree = a.get("elapsed_time") or a.get("moving_time")
    dist = a.get("distance") or a.get("icu_distance")
    d = {
        "sport": cs.normaliser_sport(a.get("type")),
        "debut": debut,
        "duree_sec": int(duree) if duree else None,
        "distance_km": round(dist / 1000, 3) if dist else None,
        "dplus_m": int(round(a["total_elevation_gain"])) if a.get("total_elevation_gain") is not None else None,
        "fc_moyenne_bpm": a.get("average_heartrate") or None,
        "fc_max_bpm": a.get("max_heartrate") or None,
        "calories": a.get("calories") or None,
        "details": {"intervals_id": str(a["id"])},
    }
    if duree:
        d["details"]["fin"] = (debut + timedelta(seconds=int(duree))).isoformat(timespec="seconds")
    return d


def analyse_fc(streams: list, user: Utilisateur, sport: str, duree_sec: Optional[int]) -> dict:
    """Zones de FC (Karvonen) et dérive cardiaque tirées des flux heartrate / time / distance."""
    par_type = {s.get("type"): (s.get("data") or []) for s in streams or []}
    fc, temps, dist = par_type.get("heartrate") or [], par_type.get("time") or [], par_type.get("distance") or []
    res: dict = {}
    pts = [(temps[i], v) for i, v in enumerate(fc) if v and i < len(temps) and temps[i] is not None and 30 <= v <= 240]
    if len(pts) >= 10:
        poids = [max(1.0, min(30.0, pts[i + 1][0] - t)) if i + 1 < len(pts) else 1.0 for i, (t, _) in enumerate(pts)]
        res["zones_fc"] = cs._zones_fc(pts, poids, user.fc_max, user.fc_repos)
    if sport in cs.SPORTS_PIED and dist and (duree_sec or 0) >= an.DERIVE_MIN_MIN * 60:
        res["derive_fc"] = an.derive_cardiaque(temps, fc, dist)
    return res


def resume_flux(streams: list, sport: str) -> dict:
    """Moyennes de la séance tirées de ses flux, avec les mêmes clés que le raccourci iOS :
    puissance moyenne / max, foulée, oscillation verticale, temps de contact, pas, FC min."""
    par_type = {s.get("type"): (s.get("data") or []) for s in streams or []}
    temps = par_type.get("time") or []
    n = len(temps)
    if n < 10:
        return {}
    dt = []
    for i in range(n):
        a, b = temps[i], temps[i + 1] if i + 1 < n else None
        dt.append(max(0.0, min(30.0, b - a)) if isinstance(a, (int, float)) and isinstance(b, (int, float)) else 1.0)
    res: dict = {}
    for s in streams or []:
        data = s.get("data") or []
        if len(data) != n:
            continue
        serie = _serie(s.get("type") or "", s.get("name"), data, sport)
        if not serie:
            continue
        cle = serie["cle"]
        # Les zéros sont des arrêts (sauf en puissance, où l'on peut rouler sans pédaler)
        pts = [(v, p) for v, p in zip(serie["brut"], dt)
               if isinstance(v, (int, float)) and (v > 0 or (cle == "puissance" and v == 0))]
        total = sum(p for _, p in pts)
        if not pts or not total:
            continue
        moy = sum(v * p for v, p in pts) / total
        if cle == "puissance":
            res["puissance_moy_w"] = round(moy, 2)
            res["puissance_max_w"] = round(max(v for v, _ in pts), 2)
        elif cle in ("foulee", "oscillation", "contact"):
            res[{"foulee": "foulee_m", "oscillation": "oscillation_cm", "contact": "contact_sol_ms"}[cle]] = round(moy, 2)
        elif cle == "cadence" and sport in cs.SPORTS_PIED:
            res["pas"] = round(sum(v * p for v, p in pts) / 60)
        elif cle == "fc":
            fc = [v for v, _ in pts if 30 <= v <= 240]
            if fc:
                res["fc_min_bpm"] = round(min(fc))
    return res


def synchroniser_wellness(db: Session, user: Utilisateur, depuis, jusqu_a) -> int:
    """Sommeil de chaque nuit ; FC repos, VFC (SDNN) et VO2max seulement pour les jours où le
    raccourci n'a rien envoyé (ses valeurs restent la référence)."""
    athlete = user.intervals_athlete_id or "0"
    lignes = _appel(user.intervals_cle, f"/athlete/{urllib.parse.quote(athlete)}/wellness",
                    {"oldest": depuis.isoformat(), "newest": jusqu_a.isoformat()}) or []
    deja = {(m.type, m.jour) for m in db.query(MesureSante).filter(
        MesureSante.utilisateur_id == user.id, MesureSante.jour >= depuis, MesureSante.type.in_(("fc_repos", "vfc", "vo2max")))}
    items = []
    for w in lignes if isinstance(lignes, list) else []:
        try:
            jour = datetime.fromisoformat(str(w.get("id"))[:10]).date()
        except ValueError:
            continue
        if w.get("sleepSecs"):
            items.append(("sommeil", jour, w["sleepSecs"] / 3600))
        for cle, t in (("restingHR", "fc_repos"), ("hrvSDNN", "vfc"), ("vo2max", "vo2max")):
            if w.get(cle) and (t, jour) not in deja:
                items.append((t, jour, float(w[cle])))
    if not items:
        return 0
    b = cs.importer_mesures(db, user.id, items)
    return b["cree"] + b["maj"]


def synchroniser(db: Session, user: Utilisateur, force: bool = False) -> dict:
    """Récupère les séances récentes d'Intervals.icu, leurs tracés, l'analyse de leur FC
    et le sommeil. Idempotent.
    Retourne un bilan {ignore, nouvelles, completees, traces, analyses, mesures}
    (ignore=True si synchro trop récente)."""
    if not user.intervals_cle:
        raise IntervalsErreur("Intervals.icu n'est pas connecté")
    maintenant = datetime.utcnow()
    if not force and user.intervals_derniere_synchro and maintenant - user.intervals_derniere_synchro < INTERVALLE_MIN:
        return {"ignore": True, "nouvelles": 0, "completees": 0, "traces": 0, "analyses": 0, "mesures": 0}
    tz = ZoneInfo(user.fuseau_horaire or "Europe/Paris")
    deja_analyse = db.query(Activite.id).filter(
        Activite.utilisateur_id == user.id,
        Activite.details.like(f'%"analyse_iv": {VERSION_ANALYSE}%')).first()
    # 1re synchro, ou nouvelle version de l'analyse des flux : on remonte plus loin
    jours = FENETRE_JOURS if user.intervals_derniere_synchro and deja_analyse else PREMIERE_FENETRE_JOURS
    depuis = (datetime.now(tz) - timedelta(days=jours)).date()
    athlete = user.intervals_athlete_id or "0"
    liste = _appel(user.intervals_cle, f"/athlete/{urllib.parse.quote(athlete)}/activities",
                   {"oldest": depuis.isoformat()}) or []

    # Séances déjà reçues d'Intervals (repérées par leur id, même fusionnées avec une séance Santé)
    connues: dict[str, Activite] = {}
    for act in (db.query(Activite).filter(Activite.utilisateur_id == user.id,
                                          Activite.debut >= datetime.combine(depuis, datetime.min.time()) - timedelta(days=2))):
        iid = cs._details_dict(act).get("intervals_id")
        if iid:
            connues[str(iid)] = act
    ignorees = [datetime.fromisoformat(x) for x in cs._ignorees(user)]
    avec_trace = {i for (i,) in db.query(TraceGPS.activite_id)
                  .filter(TraceGPS.utilisateur_id == user.id, TraceGPS.activite_id.isnot(None))}

    bilan = {"ignore": False, "nouvelles": 0, "completees": 0, "traces": 0, "analyses": 0, "mesures": 0}
    for a in sorted(liste, key=lambda x: x.get("start_date") or ""):
        if not a.get("id") or a.get("deleted"):
            continue
        iid = str(a["id"])
        act = connues.get(iid)
        if act is None:
            donnees = _donnees(a, tz)
            if donnees is None or any(abs((donnees["debut"] - d).total_seconds()) <= 120 for d in ignorees):
                continue  # séance supprimée du carnet : on ne la recrée pas
            fin = donnees["details"].pop("fin", None)
            act, statut = cs.importer_activite(db, user.id, "intervals", donnees, id_externe=iid)
            cs.fusionner_details(act, {"intervals_id": iid, **({"fin": fin} if fin else {})})
            connues[iid] = act
            bilan["nouvelles" if statut == "cree" else "completees"] += 1
        dispo = a.get("stream_types")
        besoin_trace = act.id not in avec_trace and "latlng" in (dispo or ["latlng"]) and not a.get("trainer")
        besoin_fc = (cs._details_dict(act).get("analyse_iv") != VERSION_ANALYSE
                     and "heartrate" in (dispo or ["heartrate"]))
        if not besoin_trace and not besoin_fc:
            continue
        # Analyse : tous les flux (FC, puissance, foulée…) ; tracé seul : juste ce qu'il faut
        params = None if besoin_fc else {"types": "latlng,altitude,time"}
        streams = _appel(user.intervals_cle, f"/activity/{urllib.parse.quote(iid)}/streams.json", params)
        if besoin_fc:
            analyse = analyse_fc(streams, user, act.sport, act.duree_sec)
            # Les valeurs déjà présentes (raccourci, export Santé, saisie) restent
            cs.fusionner_details(act, {"zones_fc": analyse.get("zones_fc"), **resume_flux(streams, act.sport)})
            cs.fusionner_details(act, {"derive_fc": analyse.get("derive_fc"), "analyse_iv": VERSION_ANALYSE}, ecraser=True)
            bilan["analyses"] += 1
        if not besoin_trace:
            continue
        debut_trace, pts = _points(streams, _heure_locale(a.get("start_date"), tz) or act.debut)
        if len(pts) < 2 or len(pts) > 20_000:
            continue
        t, _ = cs.enregistrer_trace(db, user.id, debut_trace, pts)
        db.flush()
        if t.activite_id is None:
            t.activite_id = act.id  # rattachement direct : on sait à quelle séance il appartient
            if not act.distance_km and t.distance_km:
                act.distance_km = t.distance_km
            if act.dplus_m is None and t.dplus_m is not None:
                act.dplus_m = t.dplus_m
            cs.fusionner_details(act, {"trace": True})
        avec_trace.add(act.id)
        bilan["traces"] += 1
    try:
        bilan["mesures"] = synchroniser_wellness(db, user, depuis, datetime.now(tz).date())
    except IntervalsErreur:
        _log.warning("Suivi wellness Intervals.icu indisponible", exc_info=True)
    user.intervals_derniere_synchro = maintenant
    db.flush()
    return bilan


# ---------------------------------------------------------------------------
# Flux détaillés d'une séance (graphiques du carnet) — lecture seule, rien n'est stocké
# ---------------------------------------------------------------------------

POINTS_GRAPHIQUE = 600
_CACHE_FLUX: dict = {}      # (utilisateur, activité) → (instant, réponse) : évite de relire Intervals à chaque ouverture
_CACHE_DUREE = timedelta(minutes=30)

# type de flux (minuscules, sans « _ ») → (clé, libellé, unité, couleur)
_FLUX_CONNUS = {
    "heartrate": ("fc", "Fréquence cardiaque", "bpm", "#FF375F"),
    "velocitysmooth": ("vitesse", "Vitesse", "km/h", "#0A84FF"),
    "cadence": ("cadence", "Cadence", "pas/min", "#BF5AF2"),
    "fixedaltitude": ("altitude", "Altitude", "m", "#30B0C7"),
    "altitude": ("altitude", "Altitude", "m", "#30B0C7"),
    "watts": ("puissance", "Puissance", "W", "#FF9F0A"),
    "verticaloscillation": ("oscillation", "Oscillation verticale", "cm", "#34C759"),
    "groundcontacttime": ("contact", "Temps de contact au sol", "ms", "#AC8E68"),
    "stancetime": ("contact", "Temps de contact au sol", "ms", "#AC8E68"),
    "stridelength": ("foulee", "Longueur de foulée", "m", "#5E5CE6"),
    "steplength": ("foulee", "Longueur de foulée", "m", "#5E5CE6"),
    "verticalratio": ("ratio_vertical", "Ratio vertical", "%", "#64D2FF"),
    "gradesmooth": ("pente", "Pente", "%", "#8E8E93"),
    "temp": ("temperature", "Température", "°C", "#FF6482"),
    "respiration": ("respiration", "Respiration", "resp/min", "#66D4CF"),
}
_FLUX_IGNORES = {"time", "distance", "latlng", "moving", "fixedheartrate", "lefttorightbalance"}


def _mediane(v: list) -> float:
    s = sorted(v)
    return s[len(s) // 2] if s else 0


def _reduire(valeurs: list, tranches: list[tuple[int, int]], dec: int = 1) -> list:
    """Moyenne de chaque tranche [i, j[ (les trous restent vides)."""
    sortie = []
    for i, j in tranches:
        bloc = [x for x in valeurs[i:j] if isinstance(x, (int, float))]
        sortie.append(round(sum(bloc) / len(bloc), dec) if bloc else None)
    return sortie


def _tranches(n: int) -> list[tuple[int, int]]:
    pas = max(1, -(-n // POINTS_GRAPHIQUE))
    return [(i, min(n, i + pas)) for i in range(0, n, pas)]


def _serie(type_: str, nom: Optional[str], data: list, sport: str) -> Optional[dict]:
    norme = type_.lower().replace("_", "")
    if norme in _FLUX_IGNORES:
        return None
    nums = [x for x in data if isinstance(x, (int, float)) and not isinstance(x, bool)]
    if len(nums) < 10 or max(nums) == min(nums):
        return None
    cle, libelle, unite, couleur = _FLUX_CONNUS.get(norme, (type_, nom or type_, "", "#8E8E93"))
    facteur, med = 1.0, _mediane([x for x in nums if x])
    if cle == "vitesse":
        facteur = 3.6
    elif cle == "cadence":
        if sport in cs.SPORTS_PIED:
            facteur = 2.0 if med < 120 else 1.0     # cadence d'une seule jambe → pas/min
        else:
            unite = "tr/min"
    elif cle == "oscillation" and med > 30:
        facteur = 0.1                               # mm → cm
    elif cle == "foulee":
        facteur = 0.001 if med > 100 else 0.01 if med > 4 else 1.0
    elif cle == "ratio_vertical" and med < 1:
        facteur = 100.0
    return {"cle": cle, "nom": libelle, "unite": unite, "couleur": couleur,
            "brut": [x * facteur if isinstance(x, (int, float)) else None for x in data]}


def _sortie(source: str, temps: list, dist_km: Optional[list], series: list) -> dict:
    tr = _tranches(len(temps))
    return {
        "source": source,
        "temps": _reduire(temps, tr, 0),
        "distance": _reduire(dist_km, tr, 3) if dist_km else None,
        "series": [{**{k: v for k, v in s.items() if k != "brut"}, "data": _reduire(s["brut"], tr, 2)}
                   for s in series],
    }


def _depuis_streams(streams: list, sport: str) -> Optional[dict]:
    par_type = {s.get("type"): s for s in streams or [] if s.get("type")}
    temps = (par_type.get("time") or {}).get("data") or []
    n = len(temps)
    if n < 10:
        return None
    dist = (par_type.get("distance") or {}).get("data") or []
    series, vues = [], set()
    for s in streams:
        data = s.get("data") or []
        if len(data) != n:
            continue
        serie = _serie(s.get("type") or "", s.get("name"), data, sport)
        if serie and serie["cle"] not in vues:
            vues.add(serie["cle"])
            series.append(serie)
    if not series:
        return None
    dist_km = [d / 1000 if isinstance(d, (int, float)) else None for d in dist] if len(dist) == n else None
    return _sortie("intervals", temps, dist_km, series)


def _depuis_trace(points: list) -> Optional[dict]:
    """Repli sans Intervals : vitesse et altitude recalculées depuis le tracé GPS (un point tous les 10 m)."""
    if len(points) < 10:
        return None
    temps, dist, alt = [], [], []
    cumul = 0.0
    for i, p in enumerate(points):
        if i:
            cumul += cs._distance_m(points[i - 1], p)
        temps.append(p[3] if len(p) > 3 and p[3] is not None else i)
        dist.append(cumul)
        alt.append(p[2] if len(p) > 2 else None)
    # Vitesse lissée sur ±15 s
    vit = []
    for i in range(len(points)):
        a = b = i
        while a > 0 and temps[i] - temps[a - 1] <= 15:
            a -= 1
        while b < len(points) - 1 and temps[b + 1] - temps[i] <= 15:
            b += 1
        dt = temps[b] - temps[a]
        vit.append((dist[b] - dist[a]) / dt * 3.6 if dt > 0 else None)
    series = []
    for cle, nom, unite, couleur, data in (("vitesse", "Vitesse", "km/h", "#0A84FF", vit),
                                          ("altitude", "Altitude", "m", "#30B0C7", alt)):
        nums = [x for x in data if isinstance(x, (int, float))]
        if len(nums) >= 10 and max(nums) != min(nums):
            series.append({"cle": cle, "nom": nom, "unite": unite, "couleur": couleur, "brut": data})
    if not series:
        return None
    return _sortie("trace", temps, [d / 1000 for d in dist], series)


def flux_seance(user: Utilisateur, act: Activite, points_trace: Optional[list]) -> dict:
    """Courbes d'une séance : tous les flux d'Intervals.icu s'ils sont disponibles
    (FC, vitesse, cadence, altitude, oscillation verticale, foulée…), sinon ceux du tracé GPS.
    Retourne {source, temps, distance, series: [{cle, nom, unite, couleur, data}], avertissement?}."""
    cle_cache = (user.id, act.id)
    deja = _CACHE_FLUX.get(cle_cache)
    if deja and datetime.utcnow() - deja[0] < _CACHE_DUREE:
        return deja[1]
    iid = cs._details_dict(act).get("intervals_id")
    res, avertissement = None, None
    if iid and user.intervals_cle:
        try:
            streams = _appel(user.intervals_cle, f"/activity/{urllib.parse.quote(str(iid))}/streams.json")
            res = _depuis_streams(streams if isinstance(streams, list) else [], act.sport)
        except IntervalsErreur as e:
            avertissement = str(e)
    if res is None and points_trace:
        res = _depuis_trace(points_trace)
    if res is None:
        res = {"source": None, "temps": [], "distance": None, "series": []}
    if avertissement:
        res = {**res, "avertissement": avertissement}
    else:
        if len(_CACHE_FLUX) > 50:
            _CACHE_FLUX.pop(next(iter(_CACHE_FLUX)))
        _CACHE_FLUX[cle_cache] = (datetime.utcnow(), res)
    return res
