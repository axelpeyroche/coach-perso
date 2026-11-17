"""
Routes du carnet d'entraînement : activités (CRUD + imports), objectifs,
statistiques et export complet pour analyse par Claude.
"""

from __future__ import annotations

import json
import logging
import re
import secrets as _secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

import analyses_service as an
import carnet_service as cs
from database import obtenir_session
from deps import get_current_user, limiter
from models import (Activite, CacheCarte, EquipementActivite, MeteoActivite, Objectif, ObjectifCourse, Segment,
                    TraceGPS, Utilisateur)

_log = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Utilitaires
# ---------------------------------------------------------------------------

def _parse_datetime(v: Any) -> datetime:
    """Accepte ISO 8601 (avec ou sans fuseau), 'jj/mm/aaaa hh:mm', epoch.
    Le fuseau est ignoré : on conserve l'heure locale telle qu'affichée."""
    if isinstance(v, datetime):
        return v.replace(tzinfo=None)
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v)
    s = str(v).strip()
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        pass
    d = cs._date_souple(s)
    if d:
        return d
    raise HTTPException(400, f"Date illisible : {s!r}")


def _activite_utilisateur(db: Session, user: Utilisateur, activite_id: int) -> Activite:
    a = db.query(Activite).filter(Activite.id == activite_id, Activite.utilisateur_id == user.id).first()
    if not a:
        raise HTTPException(404, "Activité introuvable")
    return a


def _activites(db: Session, user_id: int) -> list[Activite]:
    return db.query(Activite).filter(Activite.utilisateur_id == user_id).order_by(Activite.debut).all()


def _migrer_objectif_course(db: Session, user: Utilisateur) -> None:
    """Copie (une fois) l'ancien objectif de course unique dans la table objectifs."""
    if db.query(Objectif.id).filter(Objectif.utilisateur_id == user.id).first():
        return
    ancien = db.query(ObjectifCourse).filter(ObjectifCourse.utilisateur_id == user.id).first()
    if not ancien:
        return
    db.add(Objectif(
        utilisateur_id=user.id, type="course", titre=ancien.nom, sport="course",
        date_cible=ancien.date_course, distance_km=ancien.distance_km, dplus_m=ancien.dplus_m,
        temps_cible_sec=ancien.objectif_temps_min * 60 if ancien.objectif_temps_min else None,
        notes=ancien.notes, statut="actif" if ancien.date_course >= date.today() else "atteint",
    ))
    db.commit()


# ---------------------------------------------------------------------------
# Activités
# ---------------------------------------------------------------------------

class ActiviteSchema(BaseModel):
    sport: str
    titre: Optional[str] = None
    debut: str
    duree_sec: Optional[int] = Field(None, ge=0)
    distance_km: Optional[float] = Field(None, ge=0)
    dplus_m: Optional[int] = Field(None, ge=0)
    fc_moyenne_bpm: Optional[int] = Field(None, ge=30, le=250)
    fc_max_bpm: Optional[int] = Field(None, ge=30, le=250)
    calories: Optional[int] = Field(None, ge=0)
    rpe: Optional[float] = Field(None, ge=1, le=10)
    ressenti: Optional[int] = Field(None, ge=1, le=5)
    notes: Optional[str] = None
    est_competition: bool = False
    objectif_id: Optional[int] = None
    details: Optional[Any] = None


def _appliquer(a: Activite, p: ActiviteSchema, db: Session, user: Utilisateur) -> None:
    if p.objectif_id is not None and not db.query(Objectif.id).filter(
        Objectif.id == p.objectif_id, Objectif.utilisateur_id == user.id
    ).first():
        raise HTTPException(400, "Objectif inconnu")
    data = p.model_dump()
    data["sport"] = cs.normaliser_sport(p.sport)
    data["debut"] = _parse_datetime(p.debut)
    if isinstance(data.get("details"), dict) and p.rpe is not None:
        data["details"].pop("rpe_source", None)  # RPE confirmé par l'utilisateur
    if isinstance(data.get("details"), (dict, list)):
        data["details"] = json.dumps(data["details"], ensure_ascii=False)
    dplus_avant = a.dplus_m
    for k, v in data.items():
        setattr(a, k, v)
    if p.dplus_m != dplus_avant:
        # D+ saisi à la main : le tracé ne l'écrase plus ; effacé : le tracé le recalcule
        det = cs._details_dict(a)
        if p.dplus_m is None:
            det.pop("dplus_manuel", None)
        else:
            det["dplus_manuel"] = True
        a.details = json.dumps(det, ensure_ascii=False) if det else None


@router.get("/api/carnet/sports", summary="Liste des sports du carnet")
def lister_sports():
    return [{"code": k, **v} for k, v in cs.SPORTS.items()]


@router.get("/api/carnet/sports-presents", summary="Sports ayant au moins une activité (nombre par sport)")
def sports_presents(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    from sqlalchemy import func
    lignes = (db.query(Activite.sport, func.count(Activite.id))
              .filter(Activite.utilisateur_id == current_user.id)
              .group_by(Activite.sport).all())
    return {s: n for s, n in lignes if s}


@router.get("/api/carnet/filtres", summary="Filtres enregistrés du carnet et critères proposés")
def filtres_carnet(current_user: Utilisateur = Depends(get_current_user)):
    import recherche_service as rs
    return {"filtres": rs.filtres_enregistres(current_user), "types": cs.TYPES_SEANCE, "meteos": rs.METEOS,
            "lieux": rs.LIEUX if current_user.adresse_lat is not None else {}}


class FiltresSchema(BaseModel):
    model_config = ConfigDict(extra="ignore")
    filtres: list[dict] = Field(default_factory=list, max_length=30)


@router.put("/api/carnet/filtres", summary="Remplace les filtres enregistrés du carnet")
def enregistrer_filtres_carnet(payload: FiltresSchema, current_user: Utilisateur = Depends(get_current_user),
                               db: Session = Depends(obtenir_session)):
    import recherche_service as rs
    filtres = rs.enregistrer_filtres(current_user, payload.filtres)
    db.commit()
    return {"filtres": filtres}


@router.get("/api/activites", summary="Liste des activités (recherche, filtres avancés, pagination)")
def lister_activites(
    sport: Optional[str] = None,
    depuis: Optional[date] = None,
    jusqu_a: Optional[date] = None,
    q: Optional[str] = Query(None, max_length=120),
    type: Optional[str] = Query(None, max_length=30),
    dist_min: Optional[float] = Query(None, ge=0),
    dist_max: Optional[float] = Query(None, ge=0),
    dplus_min: Optional[int] = Query(None, ge=0),
    fc_min: Optional[int] = Query(None, ge=0),
    fc_max: Optional[int] = Query(None, ge=0),
    meteo: Optional[str] = Query(None, max_length=20),
    lieu: Optional[str] = Query(None, max_length=20),
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    import recherche_service as rs
    import seance_service as ss
    req = db.query(Activite).filter(Activite.utilisateur_id == current_user.id)
    if dist_min is not None:
        req = req.filter(Activite.distance_km >= dist_min)
    if dist_max is not None:
        req = req.filter(Activite.distance_km <= dist_max)
    if dplus_min is not None:
        req = req.filter(Activite.dplus_m >= dplus_min)
    if fc_min is not None:
        req = req.filter(Activite.fc_moyenne_bpm >= fc_min)
    if fc_max is not None:
        req = req.filter(Activite.fc_moyenne_bpm <= fc_max)
    if sport:
        req = req.filter(Activite.sport == sport)
    if depuis:
        req = req.filter(Activite.debut >= datetime.combine(depuis, datetime.min.time()))
    if jusqu_a:
        req = req.filter(Activite.debut < datetime.combine(jusqu_a + timedelta(days=1), datetime.min.time()))
    for mot in rs.mots(q):  # chaque mot dans le titre ou les notes
        m = rs.motif(mot)
        req = req.filter((Activite.titre.ilike(m, escape="\\")) | (Activite.notes.ilike(m, escape="\\")))
    if type or meteo or lieu:
        # Critères lus dans le détail des séances : filtrés ici, puis paginés
        tous = req.order_by(Activite.debut.desc()).all()
        if type and ss.maj_types(db, current_user.id, tous):  # types pas encore reconnus
            db.commit()
        tous = rs.filtrer(db, current_user, tous, type, meteo, lieu)
        return {"total": len(tous), "activites": [cs.serialiser_activite(a) for a in tous[offset:offset + limit]]}
    total = req.count()
    items = req.order_by(Activite.debut.desc()).offset(offset).limit(limit).all()
    if ss.maj_types_page(db, current_user.id, items):  # type de séance reconnu au premier affichage
        db.commit()
    return {"total": total, "activites": [cs.serialiser_activite(a) for a in items]}


@router.post("/api/activites", summary="Ajoute une activité manuellement")
def creer_activite(
    payload: ActiviteSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    a = Activite(utilisateur_id=current_user.id, source="manuel")
    _appliquer(a, payload, db, current_user)
    db.add(a)
    db.commit()
    db.refresh(a)
    return cs.serialiser_activite(a)


@router.get("/api/activites/{activite_id}", summary="Détail d'une activité")
def detail_activite(
    activite_id: int,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return cs.serialiser_activite(_activite_utilisateur(db, current_user, activite_id))


@router.put("/api/activites/{activite_id}", summary="Modifie une activité")
def modifier_activite(
    activite_id: int,
    payload: ActiviteSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    a = _activite_utilisateur(db, current_user, activite_id)
    _appliquer(a, payload, db, current_user)
    db.commit()
    db.refresh(a)
    return cs.serialiser_activite(a)


@router.delete("/api/activites/{activite_id}", summary="Supprime une activité")
def supprimer_activite(
    activite_id: int,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    a = _activite_utilisateur(db, current_user, activite_id)
    cs.memoriser_seance_ignoree(current_user, a)
    db.query(TraceGPS).filter(TraceGPS.activite_id == a.id).update({"activite_id": None})
    db.query(MeteoActivite).filter(MeteoActivite.activite_id == a.id).delete()
    db.query(EquipementActivite).filter(EquipementActivite.activite_id == a.id).delete()
    db.query(Segment).filter(Segment.activite_id == a.id).update({"activite_id": None})
    db.delete(a)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Imports
# ---------------------------------------------------------------------------

class TraceImportee(BaseModel):
    debut: str                           # ISO 8601 (heure du premier point, avec fuseau)
    points: list[list[Optional[float]]]  # [[lat, lon, altitude|null, secondes depuis le début], …]


class ImportTracesSchema(BaseModel):
    traces: list[TraceImportee] = Field(..., max_length=200)


@router.post("/api/activites/traces", summary="Import de tracés GPS (GPX lus et allégés par le navigateur)")
def importer_traces(
    payload: ImportTracesSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    tz = _fuseau(current_user)
    bilan = {"cree": 0, "maj": 0, "ignore": 0}
    for t in payload.traces:
        pts = [p[:4] for p in t.points if len(p) >= 4 and p[0] is not None and p[1] is not None
               and -90 <= p[0] <= 90 and -180 <= p[1] <= 180]
        if len(pts) < 2 or len(pts) > 20_000:
            bilan["ignore"] += 1
            continue
        _, cree = cs.enregistrer_trace(db, current_user.id, _date_import(t.debut, tz), pts)
        bilan["cree" if cree else "maj"] += 1
    db.flush()
    bilan["rattache"] = cs.rattacher_traces(db, current_user.id)
    db.commit()
    return {"ok": True, **bilan}


@router.get("/api/activites/{activite_id}/trace", summary="Tracé GPS d'une activité")
def trace_activite(
    activite_id: int,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    a = _activite_utilisateur(db, current_user, activite_id)
    t = db.query(TraceGPS).filter(TraceGPS.activite_id == a.id).first()
    if not t:
        raise HTTPException(404, "Pas de tracé pour cette activité")
    return {"debut": t.debut.isoformat(), "distance_km": t.distance_km, "dplus_m": t.dplus_m,
            "points": json.loads(t.points)}


@router.get("/api/activites/{activite_id}/terrains", summary="Route, chemin ou sentier le long du tracé GPS")
def terrains_activite(
    activite_id: int,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    """Lecture seule : déduit des voies OSM les plus proches (tuiles OpenFreeMap), gardé en mémoire par tracé."""
    import terrains_trace as tt
    a = _activite_utilisateur(db, current_user, activite_id)
    t = db.query(TraceGPS).filter(TraceGPS.activite_id == a.id).first()
    if not t:
        raise HTTPException(404, "Pas de tracé pour cette activité")
    limiter(f"terrains:{current_user.id}", 30, 60)
    points = json.loads(t.points)
    try:
        return tt.terrains((t.id, len(points), t.distance_km), points)
    except Exception as e:  # tuiles injoignables : le profil s'affiche sans le terrain
        _log.warning("Terrains du tracé %s : %s", t.id, e)
        return {"terrains": [], "repartition": None}


@router.get("/api/activites/{activite_id}/flux", summary="Courbes détaillées d'une séance (FC, vitesse, cadence…)")
def flux_activite(
    activite_id: int,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    """Lecture seule : flux d'Intervals.icu lus à la demande, sinon recalculés depuis le tracé GPS."""
    import intervals_service as iv
    a = _activite_utilisateur(db, current_user, activite_id)
    t = db.query(TraceGPS).filter(TraceGPS.activite_id == a.id).first()
    return iv.flux_seance(current_user, a, json.loads(t.points) if t else None)


@router.get("/api/activites/{activite_id}/comparables", summary="Séances à comparer à celle-ci")
def comparables_activite(
    activite_id: int,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    """Lecture seule : même sport, même type de séance d'abord, puis distance la plus proche."""
    import recherche_service as rs
    return rs.comparables(db, current_user, _activite_utilisateur(db, current_user, activite_id))


@router.get("/api/activites/{activite_id}/bilan", summary="Bilan automatique d'une séance")
def bilan_activite(
    activite_id: int,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    """Type reconnu, trois phrases, répétitions détectées et comparaison à la séance prévue.
    N'écrit que le champ d'analyse `seance` de l'activité, calculé une fois par tracé."""
    import seance_service as ss
    a = _activite_utilisateur(db, current_user, activite_id)
    res = ss.bilan(db, current_user, a)
    db.commit()
    return res


class TypeSeanceSchema(BaseModel):
    model_config = ConfigDict(extra="ignore")
    cle: Optional[str] = Field(default=None, max_length=30)


@router.put("/api/activites/{activite_id}/type", summary="Corrige le type de séance (null = type reconnu)")
def corriger_type(
    activite_id: int,
    payload: TypeSeanceSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    a = _activite_utilisateur(db, current_user, activite_id)
    if payload.cle is not None and payload.cle not in cs.TYPES_SEANCE:
        raise HTTPException(status_code=422, detail="Type de séance inconnu")
    det = cs._details_dict(a)
    det.pop("type_manuel", None)
    if payload.cle:
        det["type_manuel"] = payload.cle
    a.details = json.dumps(det, ensure_ascii=False) if det else None
    db.commit()
    return cs.serialiser_activite(a)


@router.get("/api/activites/{activite_id}/meteo", summary="Météo pendant la séance (Open-Meteo)")
def meteo_activite(
    activite_id: int,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    """Lue au départ du tracé GPS, gardée en base une fois la journée passée ; null sans tracé."""
    import meteo_service as mt
    a = _activite_utilisateur(db, current_user, activite_id)
    if not db.get(MeteoActivite, a.id):
        limiter(f"meteo:{current_user.id}", 30, 60)
    try:
        return mt.meteo_activite(db, a, current_user.fuseau_horaire or "Europe/Paris")
    except Exception as e:  # Open-Meteo injoignable : la fiche s'affiche sans la météo
        _log.warning("Météo de la séance %s : %s", a.id, e)
        return None


class MeteoSchema(BaseModel):
    """Météo lue par le navigateur sur Open-Meteo quand le serveur n'a pas pu la lire."""
    model_config = ConfigDict(extra="ignore")
    temperature: float = Field(ge=-60, le=60)
    ressentie: Optional[float] = Field(None, ge=-80, le=70)
    humidite: Optional[int] = Field(None, ge=0, le=100)
    precipitation_mm: Optional[float] = Field(None, ge=0, le=500)
    vent_kmh: Optional[int] = Field(None, ge=0, le=300)
    rafales_kmh: Optional[int] = Field(None, ge=0, le=400)
    vent_dir: Optional[int] = Field(None, ge=0, le=360)
    code: Optional[int] = Field(None, ge=0, le=99)


@router.put("/api/activites/{activite_id}/meteo", summary="Enregistrer la météo lue par le navigateur")
def enregistrer_meteo(
    activite_id: int,
    meteo: MeteoSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    """Gardée seulement si aucune météo n'est connue et que la journée est passée."""
    a = _activite_utilisateur(db, current_user, activite_id)
    limiter(f"meteo:{current_user.id}", 30, 60)
    if db.get(MeteoActivite, a.id) or a.debut.date() >= date.today():
        return {"ok": False}
    db.add(MeteoActivite(activite_id=a.id, donnees=json.dumps({**meteo.model_dump(), "source": "navigateur"})))
    db.commit()
    return {"ok": True}


@router.get("/api/traces/carte", summary="Tous les tracés allégés, pour la carte des passages")
def carte_traces(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    """`meta[i]` = [sport, km, année, id de la séance, jour ISO, titre, durée en s] du tracé `traces[i]` ; seuls les tracés liés à une séance du carnet sont servis.
    Les tracés encodés sont gardés en base et regénérés seulement quand les tracés changent."""
    lignes = (db.query(TraceGPS.id, TraceGPS.distance_km, Activite.sport, Activite.debut,
                       Activite.id.label("activite_id"), Activite.titre, Activite.duree_sec)
              .join(Activite, Activite.id == TraceGPS.activite_id)
              .filter(TraceGPS.utilisateur_id == current_user.id).order_by(TraceGPS.id).all())
    signature = f"seances:{len(lignes)}:{sum(l.id for l in lignes)}:{round(sum(l.distance_km or 0 for l in lignes), 3)}"
    cache = db.get(CacheCarte, current_user.id)
    if cache is None or cache.signature != signature:
        encodes = [json.dumps(cs.encoder_trace(json.loads(p)), separators=(",", ":"))
                   for (p,) in db.query(TraceGPS.points).join(Activite, Activite.id == TraceGPS.activite_id)
                   .filter(TraceGPS.utilisateur_id == current_user.id)
                   .order_by(TraceGPS.id)]
        if cache is None:
            cache = CacheCarte(utilisateur_id=current_user.id)
            db.add(cache)
        cache.signature, cache.donnees = signature, "[" + ",".join(encodes) + "]"
        db.commit()
    meta = [[l.sport, round(l.distance_km or 0, 2), l.debut.year, l.activite_id, l.debut.date().isoformat(),
             l.titre, l.duree_sec] for l in lignes]
    return Response('{"meta":' + json.dumps(meta, separators=(",", ":")) + ',"traces":' + cache.donnees + "}",
                    media_type="application/json")


_MOIS = [("jan", 1), ("fev", 2), ("feb", 2), ("mar", 3), ("avr", 4), ("apr", 4), ("mai", 5), ("may", 5),
         ("juin", 6), ("jun", 6), ("juil", 7), ("jul", 7), ("aou", 8), ("aug", 8), ("sep", 9), ("oct", 10),
         ("nov", 11), ("dec", 12)]


def _date_localisee(s: str) -> Optional[datetime]:
    """« 5 oct. 2026 à 07:30 », « 5 octobre 2026 à 7:30:12 », « Oct 5, 2026 at 7:30 AM », « hier à 18:04 »."""
    s = cs._sans_accents(s).strip()
    jour = None
    if s.startswith(("aujourd", "today")):
        jour = date.today()
    elif s.startswith(("hier", "yesterday")):
        jour = date.today() - timedelta(days=1)
    else:
        m = re.search(r"(\d{1,2})(?:er)?\s+([a-z]+)\.?,?\s+(\d{4})", s)
        j, mot, an = (m.group(1), m.group(2), m.group(3)) if m else (None, None, None)
        if not m:
            m = re.search(r"([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})", s)
            if m:
                mot, j, an = m.group(1), m.group(2), m.group(3)
        if not m:
            return None
        mois = next((n for p, n in _MOIS if mot.startswith(p)), None)
        if not mois:
            return None
        try:
            jour = date(int(an), mois, int(j))
        except ValueError:
            return None
        s = s[m.end():]
    t = re.search(r"(\d{1,2})[:h](\d{2})(?::(\d{2}))?\s*(am|pm)?", s)
    h, mi, se = (int(t.group(1)), int(t.group(2)), int(t.group(3) or 0)) if t else (0, 0, 0)
    if t and t.group(4):
        h = h % 12 + (12 if t.group(4) == "pm" else 0)
    try:
        return datetime.combine(jour, datetime.min.time()).replace(hour=h, minute=mi, second=se)
    except ValueError:
        return None


def _date_import(v: Any, tz: ZoneInfo) -> datetime:
    """Comme _parse_datetime, mais une date avec fuseau (ex. « …Z ») est ramenée à
    l'heure locale de l'utilisateur, et les formats localisés (« 5 oct. 2026 à 07:30 ») sont acceptés."""
    if isinstance(v, str):
        s = v.strip()
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
            return d.astimezone(tz).replace(tzinfo=None) if d.tzinfo else d
        except ValueError:
            d = cs._date_souple(s) or _date_localisee(s)
            if d:
                return d
    return _parse_datetime(v)


def _fuseau(user: Utilisateur) -> ZoneInfo:
    try:
        return ZoneInfo(user.fuseau_horaire or "Europe/Paris")
    except Exception:
        return ZoneInfo("Europe/Paris")


@router.post("/api/activites/import-fichier", summary="Import CSV (export Strava activities.csv ou CSV du carnet)")
async def importer_fichier(
    fichier: UploadFile = File(...),
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    brut = await fichier.read(20_000_000)
    try:
        contenu = brut.decode("utf-8-sig")
    except UnicodeDecodeError:
        contenu = brut.decode("latin-1")
    mesures = cs.parser_csv_mesures(contenu)
    if mesures is not None:
        bilan = cs.importer_mesures(db, current_user.id, mesures)
        db.commit()
        return {"ok": True, "source": "mesures", "lignes": len(mesures), **bilan, "fusion": 0, "inchange": bilan["ignore"]}
    source, lignes = cs.parser_csv(contenu)
    if not lignes:
        raise HTTPException(400, "Aucune activité reconnue dans ce fichier (colonnes de date introuvables ?)")
    if source == "strava":
        # Les dates de l'export Strava sont en UTC : on les ramène à l'heure locale
        try:
            tz = ZoneInfo(current_user.fuseau_horaire or "Europe/Paris")
        except Exception:
            tz = ZoneInfo("Europe/Paris")
        for _, donnees in lignes:
            donnees["debut"] = donnees["debut"].replace(tzinfo=timezone.utc).astimezone(tz).replace(tzinfo=None)
    bilan = {"cree": 0, "maj": 0, "fusion": 0, "inchange": 0}
    for id_ext, donnees in lignes:
        _, statut = cs.importer_activite(db, current_user.id, source, donnees, id_externe=id_ext)
        bilan[statut] += 1
    db.commit()
    return {"ok": True, "source": source, "lignes": len(lignes), **bilan}


# ---------------------------------------------------------------------------
# Objectifs
# ---------------------------------------------------------------------------

class ObjectifSchema(BaseModel):
    type: str = Field(..., pattern="^(course|perso)$")
    titre: str = Field(..., min_length=1, max_length=200)
    sport: Optional[str] = None
    date_cible: Optional[date] = None
    date_debut: Optional[date] = None
    distance_km: Optional[float] = Field(None, gt=0)
    dplus_m: Optional[int] = Field(None, ge=0)
    temps_cible_sec: Optional[int] = Field(None, gt=0)
    url: Optional[str] = None
    metrique: Optional[str] = Field(None, pattern="^(distance_km|duree_h|dplus_m|nb_seances|valeur_libre)$")
    valeur_cible: Optional[float] = None
    valeur_actuelle: Optional[float] = None
    unite: Optional[str] = None
    statut: str = Field("actif", pattern="^(actif|atteint|abandonne)$")
    resultat_temps_sec: Optional[int] = None
    notes: Optional[str] = None


def _objectif_utilisateur(db: Session, user: Utilisateur, objectif_id: int) -> Objectif:
    o = db.query(Objectif).filter(Objectif.id == objectif_id, Objectif.utilisateur_id == user.id).first()
    if not o:
        raise HTTPException(404, "Objectif introuvable")
    return o


@router.get("/api/objectifs", summary="Objectifs avec leur progression calculée")
def lister_objectifs(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    _migrer_objectif_course(db, current_user)
    acts = _activites(db, current_user.id)
    objectifs = db.query(Objectif).filter(Objectif.utilisateur_id == current_user.id).all()
    res = [cs.progression_objectif(o, acts) for o in objectifs]
    ordre = {"actif": 0, "atteint": 1, "abandonne": 2}
    res.sort(key=lambda o: (ordre.get(o["statut"], 3), o["date_cible"] or "9999"))
    return res


@router.post("/api/objectifs", summary="Crée un objectif")
def creer_objectif(
    payload: ObjectifSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    o = Objectif(utilisateur_id=current_user.id, **payload.model_dump())
    if o.type == "perso" and not o.date_debut:
        o.date_debut = date.today()
    db.add(o)
    db.commit()
    db.refresh(o)
    return cs.progression_objectif(o, _activites(db, current_user.id))


@router.put("/api/objectifs/{objectif_id}", summary="Modifie un objectif")
def modifier_objectif(
    objectif_id: int,
    payload: ObjectifSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    o = _objectif_utilisateur(db, current_user, objectif_id)
    # Le type (course officielle / objectif perso) se choisit à la création et ne change plus
    for k, v in payload.model_dump(exclude={"type"}).items():
        setattr(o, k, v)
    db.commit()
    db.refresh(o)
    return cs.progression_objectif(o, _activites(db, current_user.id))


class ParcoursObjectif(BaseModel):
    itineraire_id: Optional[int] = None


@router.put("/api/objectifs/{objectif_id}/parcours", summary="Lie (ou délie) un parcours enregistré à un objectif de course")
def lier_parcours_objectif(
    objectif_id: int,
    payload: ParcoursObjectif,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    from models import ItineraireFavori
    o = _objectif_utilisateur(db, current_user, objectif_id)
    if payload.itineraire_id is not None and not db.query(ItineraireFavori.id).filter(
            ItineraireFavori.id == payload.itineraire_id, ItineraireFavori.utilisateur_id == current_user.id).first():
        raise HTTPException(404, "Parcours introuvable")
    o.itineraire_id = payload.itineraire_id
    db.commit()
    return {"id": o.id, "itineraire_id": o.itineraire_id}


@router.delete("/api/objectifs/{objectif_id}", summary="Supprime un objectif")
def supprimer_objectif(
    objectif_id: int,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    o = _objectif_utilisateur(db, current_user, objectif_id)
    db.query(Activite).filter(Activite.objectif_id == o.id).update({Activite.objectif_id: None})
    db.delete(o)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Statistiques
# ---------------------------------------------------------------------------

@router.get("/api/stats", summary="Statistiques complètes du carnet")
def stats(
    sport: Optional[str] = None,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return cs.calculer_stats(_activites(db, current_user.id), sport=sport)


@router.get("/api/mesures", summary="Mesures de forme (FC repos, VFC, VO2max) : séries et moyennes")
def mesures(
    jours: int = Query(365, ge=7, le=3650),
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return cs.series_mesures(db, current_user.id, jours=jours)


@router.get("/api/analyses", summary="Analyses avancées : forme/fatigue, zones, récupération, course, plan, années, corrélations")
def analyses(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return an.analyses_du_jour(db, current_user)   # commit compris : meilleurs efforts mémorisés, rapprochements du plan


# ---------------------------------------------------------------------------
# Export / lien d'analyse pour Claude
# ---------------------------------------------------------------------------

@router.get("/api/analyse/token", summary="Retourne (et génère si besoin) le token du lien d'analyse")
def get_analyse_token(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    if not current_user.analyse_token:
        current_user.analyse_token = _secrets.token_urlsafe(24)
        db.commit()
    return {"analyse_token": current_user.analyse_token}


@router.post("/api/analyse/token/regenerer", summary="Régénère le lien d'analyse (invalide l'ancien)")
def regenerer_analyse_token(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    current_user.analyse_token = _secrets.token_urlsafe(24)
    db.commit()
    return {"analyse_token": current_user.analyse_token}


def _reponse_export(db: Session, user: Utilisateur, format: str):
    data = cs.construire_export(db, user)
    if format == "json":
        return data
    if format == "csv":
        return PlainTextResponse(cs.export_csv(data), media_type="text/csv; charset=utf-8",
                                 headers={"Content-Disposition": 'attachment; filename="carnet.csv"'})
    return PlainTextResponse(cs.export_markdown(data), media_type="text/markdown; charset=utf-8")


@router.get("/api/export/carnet", summary="Export complet du carnet (md | json | csv) — authentifié")
def export_carnet(
    format: str = Query("md", pattern="^(md|json|csv)$"),
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return _reponse_export(db, current_user, format)


@router.get("/api/analyse/{token}", summary="Lien secret en lecture seule — export complet pour Claude")
def analyse_publique(
    token: str,
    format: str = Query("md", pattern="^(md|json|csv)$"),
    db: Session = Depends(obtenir_session),
):
    if len(token) < 20:
        raise HTTPException(404, "Lien invalide")
    user = db.query(Utilisateur).filter(Utilisateur.analyse_token == token).first()
    if not user:
        raise HTTPException(404, "Lien invalide")
    return _reponse_export(db, user, format)
