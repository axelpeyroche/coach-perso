"""
Routes du carnet d'entraînement : activités (CRUD + imports), objectifs,
statistiques et export complet pour analyse par Claude.
"""

from __future__ import annotations

import secrets as _secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional, Union
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import carnet_service as cs
from database import obtenir_session
from deps import get_current_user
from models import Activite, Objectif, ObjectifCourse, Utilisateur

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
    if isinstance(data.get("details"), (dict, list)):
        import json
        data["details"] = json.dumps(data["details"], ensure_ascii=False)
    for k, v in data.items():
        setattr(a, k, v)


@router.get("/api/carnet/sports", summary="Liste des sports du carnet")
def lister_sports():
    return [{"code": k, **v} for k, v in cs.SPORTS.items()]


@router.get("/api/activites", summary="Liste des activités (filtres sport/dates, pagination)")
def lister_activites(
    sport: Optional[str] = None,
    depuis: Optional[date] = None,
    jusqu_a: Optional[date] = None,
    q: Optional[str] = None,
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    req = db.query(Activite).filter(Activite.utilisateur_id == current_user.id)
    if sport:
        req = req.filter(Activite.sport == sport)
    if depuis:
        req = req.filter(Activite.debut >= datetime.combine(depuis, datetime.min.time()))
    if jusqu_a:
        req = req.filter(Activite.debut < datetime.combine(jusqu_a + timedelta(days=1), datetime.min.time()))
    if q:
        motif = f"%{q}%"
        req = req.filter((Activite.titre.ilike(motif)) | (Activite.notes.ilike(motif)))
    total = req.count()
    items = req.order_by(Activite.debut.desc()).offset(offset).limit(limit).all()
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
    db.delete(a)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Imports
# ---------------------------------------------------------------------------

class ActiviteImportee(BaseModel):
    """Format souple accepté depuis un raccourci iOS (Apple Santé) ou un script."""
    id: Optional[str] = None
    type: Optional[str] = None           # "Running", "Course à pied", "Cycling"…
    sport: Optional[str] = None
    titre: Optional[str] = None
    debut: Union[str, float]
    fin: Optional[Union[str, float]] = None
    duree_sec: Optional[float] = None
    duree_min: Optional[float] = None
    distance_km: Optional[float] = None
    distance_m: Optional[float] = None
    dplus_m: Optional[float] = None
    fc_moyenne_bpm: Optional[float] = None
    fc_max_bpm: Optional[float] = None
    calories: Optional[float] = None
    rpe: Optional[float] = None
    notes: Optional[str] = None


class ImportActivitesSchema(BaseModel):
    token: str
    source: str = "apple_sante"
    activites: Optional[list[ActiviteImportee]] = None
    activite: Optional[ActiviteImportee] = None


def _convertir_import(x: ActiviteImportee) -> tuple[str, dict]:
    debut = _parse_datetime(x.debut)
    duree = x.duree_sec
    if duree is None and x.duree_min is not None:
        duree = x.duree_min * 60
    if duree is None and x.fin is not None:
        duree = (_parse_datetime(x.fin) - debut).total_seconds()
    dist = x.distance_km if x.distance_km is not None else (x.distance_m / 1000 if x.distance_m else None)
    sport = cs.normaliser_sport(x.sport or x.type)
    entier = lambda v: int(round(v)) if v else None
    donnees = {
        "sport": sport, "titre": x.titre or (x.type if x.type and not x.sport else None), "debut": debut,
        "duree_sec": entier(duree), "distance_km": round(dist, 3) if dist else None,
        "dplus_m": entier(x.dplus_m), "fc_moyenne_bpm": entier(x.fc_moyenne_bpm),
        "fc_max_bpm": entier(x.fc_max_bpm), "calories": entier(x.calories),
        "rpe": x.rpe if x.rpe and 1 <= x.rpe <= 10 else None, "notes": x.notes,
    }
    id_ext = x.id or f"{sport}-{debut:%Y%m%dT%H%M}"
    return id_ext, donnees


@router.post("/api/activites/import", summary="Import d'activités (raccourci iOS / script) — auth par token d'import")
def importer_activites(payload: ImportActivitesSchema, db: Session = Depends(obtenir_session)):
    user = db.query(Utilisateur).filter(Utilisateur.import_token == payload.token).first()
    if not user:
        raise HTTPException(401, "Token invalide")
    lot = list(payload.activites or []) + ([payload.activite] if payload.activite else [])
    if not lot:
        raise HTTPException(400, "Aucune activité fournie")
    source = payload.source if payload.source in ("apple_sante", "fichier", "strava") else "apple_sante"
    bilan = {"cree": 0, "maj": 0, "fusion": 0, "inchange": 0}
    for x in lot:
        id_ext, donnees = _convertir_import(x)
        _, statut = cs.importer_activite(db, user.id, source, donnees, id_externe=id_ext)
        bilan[statut] += 1
    db.commit()
    return {"ok": True, **bilan, "message": f"{bilan['cree']} ajoutée(s), {bilan['maj'] + bilan['fusion']} mise(s) à jour"}


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
    for k, v in payload.model_dump().items():
        setattr(o, k, v)
    db.commit()
    db.refresh(o)
    return cs.progression_objectif(o, _activites(db, current_user.id))


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
