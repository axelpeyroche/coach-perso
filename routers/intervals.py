"""
Connexion à Intervals.icu (séances de l'Apple Watch avec tracé GPS et dénivelé).

La clé API personnelle est saisie dans la page Sources ; elle n'est jamais renvoyée au navigateur.
La synchro se lance d'elle-même à chaque envoi du raccourci quotidien et à l'ouverture de l'app
(au plus une fois par quart d'heure), ou à la demande.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import intervals_service as iv
from database import SessionLocal, obtenir_session
from deps import get_current_user
from models import Utilisateur

router = APIRouter()
_log = logging.getLogger(__name__)


class ConnexionIntervalsSchema(BaseModel):
    cle: str = Field(..., min_length=10, max_length=100)
    athlete_id: Optional[str] = Field(None, max_length=30)


def _statut(user: Utilisateur) -> dict:
    return {"connecte": bool(user.intervals_cle), "athlete_id": user.intervals_athlete_id,
            "derniere_synchro": user.intervals_derniere_synchro.isoformat() + "Z"
            if user.intervals_derniere_synchro else None}


@router.get("/api/intervals", summary="Statut de la connexion Intervals.icu")
def statut(current_user: Utilisateur = Depends(get_current_user)):
    return _statut(current_user)


@router.put("/api/intervals", summary="Connecter Intervals.icu (clé API personnelle)")
def connecter(payload: ConnexionIntervalsSchema, db: Session = Depends(obtenir_session),
              current_user: Utilisateur = Depends(get_current_user)):
    cle = payload.cle.strip()
    athlete = (payload.athlete_id or "").strip() or None
    try:
        info = iv.verifier(cle, athlete)
    except iv.IntervalsErreur as e:
        raise HTTPException(400, str(e))
    current_user.intervals_cle = cle
    current_user.intervals_athlete_id = info["id"]
    current_user.intervals_derniere_synchro = None  # la première synchro remonte 60 jours
    db.commit()
    return {**_statut(current_user), "nom": info["nom"]}


@router.delete("/api/intervals", summary="Déconnecter Intervals.icu")
def deconnecter(db: Session = Depends(obtenir_session), current_user: Utilisateur = Depends(get_current_user)):
    current_user.intervals_cle = None
    current_user.intervals_athlete_id = None
    current_user.intervals_derniere_synchro = None
    db.commit()
    return _statut(current_user)


@router.post("/api/intervals/synchro", summary="Récupérer les séances et tracés d'Intervals.icu")
def synchro(force: bool = Query(False), db: Session = Depends(obtenir_session),
            current_user: Utilisateur = Depends(get_current_user)):
    if not current_user.intervals_cle:
        return {**_statut(current_user), "ignore": True}
    try:
        bilan = iv.synchroniser(db, current_user, force=force)
        db.commit()
    except iv.IntervalsErreur as e:
        db.rollback()
        raise HTTPException(502, str(e))
    except IntegrityError:
        db.rollback()  # une autre synchro tournait en même temps : elle a déjà tout enregistré
        bilan = {"ignore": True}
    return {**_statut(current_user), **bilan}


def synchro_en_arriere_plan(user_id: int) -> None:
    """Après un envoi du raccourci : récupère les nouvelles séances sans faire attendre l'iPhone."""
    db = SessionLocal()
    try:
        user = db.get(Utilisateur, user_id)
        if user and user.intervals_cle:
            iv.synchroniser(db, user)
            db.commit()
    except Exception:
        db.rollback()
        _log.exception("Synchro Intervals.icu en arrière-plan en échec")
    finally:
        db.close()
