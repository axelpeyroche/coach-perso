"""
Recherche et filtres avancés du carnet : plein texte (titre, notes), type de séance reconnu,
météo de la sortie, lieu (autour de l'adresse du profil ou ailleurs), filtres enregistrés,
et séances comparables à une autre (même type, distance proche).
"""
from __future__ import annotations

import json
import math
import re
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

import carnet_service as cs
from models import Activite, MeteoActivite, TraceGPS, Utilisateur

METEOS = {
    "froid": "Froid (moins de 5 °C)",
    "chaud": "Chaud (22 °C et plus)",
    "pluie": "Pluie",
    "vent": "Vent (25 km/h et plus)",
}
RAYON_KM = 20
LIEUX = {"proche": f"Autour de chez moi ({RAYON_KM} km)", "ailleurs": "Ailleurs"}
FILTRES_MAX = 12
# Critères qu'un filtre enregistré peut porter (les autres sont ignorés)
CRITERES = ("q", "sport", "type", "dist_min", "dist_max", "dplus_min", "fc_min", "fc_max", "meteo", "lieu")


def mots(q: Optional[str]) -> list[str]:
    """Mots de la recherche (6 au plus) : chacun doit se trouver dans le titre ou les notes."""
    return [m for m in re.split(r"\s+", (q or "").strip()) if m][:6]


def motif(mot: str) -> str:
    """Motif LIKE du mot, caractères jokers neutralisés (échappement « \\ »)."""
    return "%" + mot.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


_PREMIER_POINT = re.compile(r"\[\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)")


def _departs(db: Session, user_id: int) -> dict[int, tuple[float, float]]:
    """Premier point de chaque tracé rattaché, lu sur le début du JSON (sans charger les tracés)."""
    out = {}
    lignes = (db.query(TraceGPS.activite_id, func.substr(TraceGPS.points, 1, 80))
              .filter(TraceGPS.utilisateur_id == user_id, TraceGPS.activite_id.isnot(None)).all())
    for aid, debut in lignes:
        m = _PREMIER_POINT.match(debut or "")
        if m:
            out[aid] = (float(m.group(1)), float(m.group(2)))
    return out


def _meteos(db: Session, user_id: int) -> dict[int, dict]:
    out = {}
    lignes = (db.query(MeteoActivite.activite_id, MeteoActivite.donnees)
              .join(Activite, Activite.id == MeteoActivite.activite_id)
              .filter(Activite.utilisateur_id == user_id).all())
    for aid, donnees in lignes:
        try:
            d = json.loads(donnees)
        except ValueError:
            continue
        if isinstance(d, dict):
            out[aid] = d
    return out


def _num(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def meteo_correspond(cle: str, m: Optional[dict], det: dict) -> bool:
    """La sortie s'est-elle faite par ce temps ? Sans météo connue : non."""
    m = m or {}
    temp = m.get("temperature") if _num(m.get("temperature")) else det.get("temperature_c")
    if cle == "froid":
        return _num(temp) and temp < 5
    if cle == "chaud":
        return _num(temp) and temp >= 22
    if cle == "pluie":
        pluie, code = m.get("precipitation_mm"), m.get("code")
        return (_num(pluie) and pluie >= 0.5) or (_num(code) and 51 <= code <= 99)
    if cle == "vent":
        return _num(m.get("vent_kmh")) and m["vent_kmh"] >= 25
    return False


def filtrer(db: Session, user: Utilisateur, acts: list[Activite], type_: Optional[str] = None,
            meteo: Optional[str] = None, lieu: Optional[str] = None) -> list[Activite]:
    """Applique les critères qui ne se lisent pas en SQL (type reconnu, météo, lieu). Garde l'ordre."""
    if type_:
        acts = [a for a in acts if a.sport in cs.SPORTS_PIED
                and (cs.type_seance(cs._details_dict(a)) or {}).get("cle") == type_]
    if meteo in METEOS:
        m = _meteos(db, user.id)
        acts = [a for a in acts if meteo_correspond(meteo, m.get(a.id), cs._details_dict(a))]
    if lieu in LIEUX:
        if user.adresse_lat is None or user.adresse_lon is None:
            return []
        dep = _departs(db, user.id)

        def proche(a: Activite) -> Optional[bool]:
            p = dep.get(a.id)
            return None if p is None else _km(user.adresse_lat, user.adresse_lon, p[0], p[1]) <= RAYON_KM

        voulu = lieu == "proche"
        acts = [a for a in acts if proche(a) is voulu]
    return acts


# --- Filtres enregistrés -------------------------------------------------------

def _nettoyer(criteres) -> dict:
    out = {}
    if not isinstance(criteres, dict):
        return out
    for k in CRITERES:
        v = criteres.get(k)
        if v in (None, ""):
            continue
        if k in ("q", "sport", "type", "meteo", "lieu"):
            if isinstance(v, str):
                out[k] = v.strip()[:80]
        elif _num(v) and 0 <= v <= 100000:
            out[k] = v
    return out


def filtres_enregistres(user: Utilisateur) -> list[dict]:
    try:
        brut = json.loads(user.filtres_carnet or "[]")
    except ValueError:
        return []
    return [f for f in brut if isinstance(f, dict) and f.get("nom")] if isinstance(brut, list) else []


def enregistrer_filtres(user: Utilisateur, filtres: list) -> list[dict]:
    propres, vus = [], set()
    for f in filtres[:FILTRES_MAX]:
        nom = str((f or {}).get("nom") or "").strip()[:40]
        crit = _nettoyer((f or {}).get("criteres"))
        if not nom or not crit or nom.lower() in vus:
            continue
        vus.add(nom.lower())
        propres.append({"nom": nom, "criteres": crit})
    user.filtres_carnet = json.dumps(propres, ensure_ascii=False) if propres else None
    return propres


# --- Séances comparables -------------------------------------------------------

def comparables(db: Session, user: Utilisateur, a: Activite, limite: int = 24) -> list[dict]:
    """Séances du même sport à comparer : même type de séance d'abord, puis distance la plus proche."""
    autres = (db.query(Activite)
              .filter(Activite.utilisateur_id == user.id, Activite.sport == a.sport, Activite.id != a.id)
              .order_by(Activite.debut.desc()).limit(1500).all())
    ref = (cs.type_seance(cs._details_dict(a)) or {}).get("cle") if a.sport in cs.SPORTS_PIED else None

    def note(b: Activite) -> tuple:
        det = cs._details_dict(b)
        meme = bool(ref) and (cs.type_seance(det) or {}).get("cle") == ref
        if a.distance_km and b.distance_km:
            ecart = abs(b.distance_km - a.distance_km) / a.distance_km
        elif a.duree_sec and b.duree_sec:
            ecart = abs(b.duree_sec - a.duree_sec) / a.duree_sec
        else:
            ecart = 9.0
        # Courbes possibles seulement avec un tracé ou une séance venue d'Intervals
        courbes = bool(det.get("trace") or det.get("intervals_id"))
        return (not courbes, not meme, ecart > 0.25, round(ecart, 2) if ecart > 0.25 else 0, -b.debut.timestamp())

    choix = sorted(autres, key=note)[:limite]
    return [{**cs.serialiser_activite(b), "meme_type": bool(ref) and (cs.type_seance(cs._details_dict(b)) or {}).get("cle") == ref}
            for b in choix]
