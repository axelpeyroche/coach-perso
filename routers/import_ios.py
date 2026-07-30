"""Routes du domaine import iOS Shortcuts : token d'import, séances récentes, import workout."""

from __future__ import annotations

import secrets as _secrets
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import obtenir_session
from models import JournalSeance, Macrocycle, SeanceEntrainement, SemaineEntrainement, Utilisateur
from deps import get_current_user

router = APIRouter()

# Mapping type Apple Health -> types seance coach
_HEALTH_TYPE_MAP = {
    "Running":        ["COURSE"],
    "TrailRunning":   ["COURSE"],
    "Walking":        ["DECHARGE"],
    "Hiking":         ["DECHARGE"],
    "FunctionalStrengthTraining": ["GYM_UPPER", "GYM_LOWER", "GYM_FULL", "EMOM", "AMRAP"],
    "TraditionalStrengthTraining": ["GYM_UPPER", "GYM_LOWER", "GYM_FULL"],
    "HighIntensityIntervalTraining": ["EMOM", "AMRAP"],
    "CrossTraining":  ["EMOM", "AMRAP"],
    "MixedCardio":    ["EMOM", "AMRAP", "COURSE"],
    "Other":          ["EMOM", "AMRAP", "GYM_UPPER", "GYM_LOWER", "GYM_FULL", "COURSE"],
}

_TYPE_SEANCE_TO_HEALTH = {
    "COURSE":    ["Running", "TrailRunning", "MixedCardio"],
    "GYM_UPPER": ["FunctionalStrengthTraining", "TraditionalStrengthTraining", "CrossTraining"],
    "GYM_LOWER": ["FunctionalStrengthTraining", "TraditionalStrengthTraining", "CrossTraining"],
    "GYM_FULL":  ["FunctionalStrengthTraining", "TraditionalStrengthTraining", "CrossTraining"],
    "EMOM":      ["HighIntensityIntervalTraining", "CrossTraining", "FunctionalStrengthTraining"],
    "AMRAP":     ["HighIntensityIntervalTraining", "CrossTraining", "FunctionalStrengthTraining"],
    "DECHARGE":  ["Walking", "Hiking"],
}


def _get_user_by_import_token(token: str, db: Session) -> Utilisateur:
    user = db.query(Utilisateur).filter(Utilisateur.import_token == token).first()
    if not user:
        raise HTTPException(401, "Token invalide")
    return user


@router.get("/api/auth/import-token", summary="Retourne (et genere si besoin) le token d import iOS")
def get_import_token(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    if not current_user.import_token:
        current_user.import_token = _secrets.token_urlsafe(32)
        db.commit()
    return {"import_token": current_user.import_token}


@router.post("/api/auth/import-token/regenerer", summary="Regenere le token d import")
def regenerer_import_token(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    current_user.import_token = _secrets.token_urlsafe(32)
    db.commit()
    return {"import_token": current_user.import_token}


@router.get("/api/import/seances-recentes", summary="Seances non validees des 3 derniers jours (auth par token)")
def import_seances_recentes(
    token: str = Query(...),
    db: Session = Depends(obtenir_session),
):
    user = _get_user_by_import_token(token, db)
    aujourd_hui = date.today()
    depuis = aujourd_hui - timedelta(days=3)
    demain  = aujourd_hui + timedelta(days=1)

    seances = (
        db.query(SeanceEntrainement)
        .join(SemaineEntrainement, SeanceEntrainement.semaine_id == SemaineEntrainement.id)
        .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
        .filter(
            Macrocycle.utilisateur_id == user.id,
            SeanceEntrainement.date_seance >= depuis,
            SeanceEntrainement.date_seance <= demain,
        )
        .order_by(SeanceEntrainement.date_seance.desc())
        .all()
    )

    result = []
    for s in seances:
        if s.journal and s.journal.completee:
            continue  # deja validee
        types_health = _TYPE_SEANCE_TO_HEALTH.get(s.type_seance.value, [])
        result.append({
            "id":           s.id,
            "titre":        s.titre,
            "type":         s.type_seance.value,
            "date":         str(s.date_planifiee) if s.date_planifiee else None,
            "types_health": types_health,
            "duree_cible_min": s.duree_cible_min,
            "distance_cible_km": s.distance_cible_km,
        })
    return {"seances": result}


class WorkoutImportSchema(BaseModel):
    token:          str
    seance_id:      int
    health_type:    Optional[str]  = None
    duree_min:      Optional[int]  = None
    distance_km:    Optional[float] = None
    dplus_m:        Optional[int]  = None
    fc_moyenne_bpm: Optional[int]  = None
    fc_max_bpm:     Optional[int]  = None
    calories:       Optional[int]  = None
    rpe:            Optional[float] = Field(None, ge=1, le=10)
    notes:          Optional[str]  = None


@router.post("/api/import/workout", summary="Importe un workout Apple Watch dans une seance")
def import_workout(
    payload: WorkoutImportSchema,
    db: Session = Depends(obtenir_session),
):
    user = _get_user_by_import_token(payload.token, db)

    seance = (
        db.query(SeanceEntrainement)
        .join(SemaineEntrainement, SeanceEntrainement.semaine_id == SemaineEntrainement.id)
        .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
        .filter(
            SeanceEntrainement.id == payload.seance_id,
            Macrocycle.utilisateur_id == user.id,
        )
        .first()
    )
    if not seance:
        raise HTTPException(404, "Seance introuvable")

    if seance.journal and seance.journal.completee:
        # Mise a jour si deja valide
        j = seance.journal
        if payload.duree_min is not None:      j.duree_reelle_min   = payload.duree_min
        if payload.distance_km is not None:    j.distance_reelle_km = payload.distance_km
        if payload.dplus_m is not None:        j.dplus_reel_m       = payload.dplus_m
        if payload.fc_moyenne_bpm is not None: j.fc_moyenne_bpm     = payload.fc_moyenne_bpm
        if payload.fc_max_bpm is not None:     j.fc_max_bpm         = payload.fc_max_bpm
        if payload.rpe is not None:            j.rpe                = payload.rpe
        if payload.notes is not None:          j.notes              = payload.notes
        j.completee = True
    else:
        j = JournalSeance(
            utilisateur_id=user.id,
            seance_id=payload.seance_id,
            completee=True,
            duree_reelle_min=payload.duree_min,
            distance_reelle_km=payload.distance_km,
            dplus_reel_m=payload.dplus_m,
            fc_moyenne_bpm=payload.fc_moyenne_bpm,
            fc_max_bpm=payload.fc_max_bpm,
            rpe=payload.rpe,
            notes=payload.notes,
        )
        db.add(j)
    db.commit()
    return {"ok": True, "seance": seance.titre}
