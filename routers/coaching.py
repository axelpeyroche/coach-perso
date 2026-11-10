"""Coaching : vue de la saison, centre d'alertes, préparation de course, séances types."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import coaching_service as coach
from database import obtenir_session
from deps import get_current_user, limiter
from models import Objectif, Utilisateur

router = APIRouter()


@router.get("/api/saison", summary="Frise des semaines jusqu'à l'objectif : phases, charge prévue contre réalisée, décharges")
def saison(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    res = coach.saison(db, current_user)
    db.commit()  # rapprochements du plan
    return res


@router.get("/api/alertes", summary="Alertes regroupées, chacune avec ce qu'il faut faire")
def alertes(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    limiter(f"alertes:{current_user.id}", 30, 60)
    res = coach.alertes(db, current_user)
    db.commit()  # résultats d'analyse mémorisés
    return res


@router.get("/api/seances-types", summary="Bibliothèque de séances types, cibles recalculées sur les zones du moment")
def seances_types(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    return coach.seances_types(db, current_user)


def _objectif(db: Session, user: Utilisateur, objectif_id: int) -> Objectif:
    o = db.query(Objectif).filter(Objectif.id == objectif_id, Objectif.utilisateur_id == user.id).first()
    if not o:
        raise HTTPException(404, "Objectif introuvable")
    if o.type != "course":
        raise HTTPException(400, "La préparation ne concerne que les courses")
    return o


@router.get("/api/objectifs/{objectif_id}/preparation",
            summary="Préparation d'une course : compte à rebours, plan d'allure, météo, check-list, ravitaillement")
def preparation(objectif_id: int, current_user: Utilisateur = Depends(get_current_user),
                db: Session = Depends(obtenir_session)):
    limiter(f"preparation:{current_user.id}", 20, 60)
    res = coach.preparation(db, current_user, _objectif(db, current_user, objectif_id))
    db.commit()
    return res


class PreparationSchema(BaseModel):
    coches: Optional[list[str]] = Field(None, max_length=200)
    ajouts: Optional[list[str]] = Field(None, max_length=30)
    heure: Optional[str] = Field(None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")


@router.put("/api/objectifs/{objectif_id}/preparation", summary="Enregistre la check-list et l'heure de départ")
def enregistrer_preparation(objectif_id: int, payload: PreparationSchema,
                            current_user: Utilisateur = Depends(get_current_user),
                            db: Session = Depends(obtenir_session)):
    o = _objectif(db, current_user, objectif_id)
    coches = [c[:90] for c in payload.coches] if payload.coches is not None else None
    ajouts = [a[:80] for a in payload.ajouts] if payload.ajouts is not None else None
    res = coach.enregistrer_preparation(o, coches, ajouts, payload.heure)
    db.commit()
    return res
