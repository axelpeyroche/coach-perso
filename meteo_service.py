"""
Météo d'une sortie : température, ressenti, humidité, vent et pluie au départ du tracé GPS,
lus sur Open-Meteo (gratuit, sans clé). Les jours récents viennent de l'API de prévision
(qui garde les 3 derniers mois), les plus anciens de l'archive. Gardée en base une fois connue.
"""
from __future__ import annotations

import json
import logging
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from models import Activite, MeteoActivite, TraceGPS

_log = logging.getLogger(__name__)

PREVISION = "https://api.open-meteo.com/v1/forecast"
ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
JOURS_PREVISION = 80      # l'API de prévision remonte jusqu'à 92 jours
HORAIRES = ("temperature_2m", "apparent_temperature", "relative_humidity_2m", "precipitation",
            "weather_code", "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m")


def _appel(url: str, params: dict) -> dict:
    req = urllib.request.Request(url + "?" + urllib.parse.urlencode(params), headers={"User-Agent": "coach-perso"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


def _moyenne(v: list) -> Optional[float]:
    v = [x for x in v if isinstance(x, (int, float))]
    return sum(v) / len(v) if v else None


def _direction_moyenne(degres: list, vitesses: list) -> Optional[float]:
    """Direction moyenne du vent, pondérée par sa force (moyenne de vecteurs)."""
    import math
    x = y = 0.0
    for d, v in zip(degres, vitesses):
        if isinstance(d, (int, float)) and isinstance(v, (int, float)):
            x += v * math.cos(math.radians(d))
            y += v * math.sin(math.radians(d))
    return round(math.degrees(math.atan2(y, x)) % 360) if x or y else None


def lire(lat: float, lon: float, debut: datetime, fin: datetime, fuseau: str,
         aujourd_hui: Optional[date] = None) -> Optional[dict]:
    """Moyenne des heures couvertes par la séance (heures locales)."""
    aujourd_hui = aujourd_hui or date.today()
    recent = (aujourd_hui - debut.date()).days <= JOURS_PREVISION
    params = {"latitude": round(lat, 3), "longitude": round(lon, 3), "hourly": ",".join(HORAIRES),
              "start_date": debut.date().isoformat(), "end_date": fin.date().isoformat(),
              "timezone": fuseau, "wind_speed_unit": "kmh"}
    h = (_appel(PREVISION if recent else ARCHIVE, params).get("hourly") or {})
    heures = [datetime.fromisoformat(t) for t in h.get("time") or []]
    a = debut.replace(minute=0, second=0, microsecond=0)
    idx = [i for i, t in enumerate(heures) if a <= t <= fin] or [i for i, t in enumerate(heures) if t == a]
    if not idx:
        return None
    col = lambda k: [(h.get(k) or [None] * len(heures))[i] for i in idx]  # noqa: E731
    temp = _moyenne(col("temperature_2m"))
    if temp is None:
        return None
    codes = [c for c in col("weather_code") if isinstance(c, (int, float))]
    vent = col("wind_speed_10m")
    res = {
        "temperature": round(temp, 1),
        "ressentie": round(x, 1) if (x := _moyenne(col("apparent_temperature"))) is not None else None,
        "humidite": round(x) if (x := _moyenne(col("relative_humidity_2m"))) is not None else None,
        "precipitation_mm": round(sum(x for x in col("precipitation") if isinstance(x, (int, float))), 1),
        "vent_kmh": round(x) if (x := _moyenne(vent)) is not None else None,
        "rafales_kmh": round(max(g)) if (g := [x for x in col("wind_gusts_10m") if isinstance(x, (int, float))]) else None,
        "vent_dir": _direction_moyenne(col("wind_direction_10m"), vent),
        "code": int(max(codes)) if codes else None,   # le temps le plus marqué de la séance
        "source": "prevision" if recent else "archive",
    }
    return res


def meteo_activite(db: Session, a: Activite, fuseau: str) -> Optional[dict]:
    """Météo gardée en base, sinon lue sur Open-Meteo (séance avec tracé GPS seulement)."""
    deja = db.get(MeteoActivite, a.id)
    if deja:
        return json.loads(deja.donnees)
    t = db.query(TraceGPS).filter(TraceGPS.activite_id == a.id).first()
    if not t:
        return None
    pts = json.loads(t.points)
    if not pts:
        return None
    fin = a.debut + timedelta(seconds=a.duree_sec or 0)
    res = lire(pts[0][0], pts[0][1], a.debut, fin, fuseau)
    # Le jour même, l'archive n'est pas encore consolidée : on ne garde qu'à partir du lendemain
    if res and a.debut.date() < date.today():
        db.add(MeteoActivite(activite_id=a.id, donnees=json.dumps(res)))
        db.commit()
    return res
