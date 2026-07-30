"""Routes du domaine séances : création, modification et suppression de séances personnalisées (mode manuel)."""

from __future__ import annotations

import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import obtenir_session
from deps import get_current_user
from models import (
    JournalSeance,
    Macrocycle,
    SeanceEntrainement,
    SemaineEntrainement,
    TypeSeance,
    Utilisateur,
    ZoneCourse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Séances personnalisées (mode manuel) — création et suppression par l'utilisateur
# ---------------------------------------------------------------------------

class CreerSeanceSchema(BaseModel):
    semaine_id: int
    type_seance: str                         # COURSE | GYM_UPPER | GYM_LOWER | GYM_FULL | AMRAP | EMOM
    titre: str
    date_seance: str                         # "YYYY-MM-DD"
    heure_planifiee: Optional[str] = None    # "HH:MM"
    description: Optional[str] = None
    zone_cible: Optional[str] = None         # Z1..Z5 (course)
    distance_cible_km: Optional[float] = None
    duree_cible_min: Optional[int] = None
    dplus_cible_m: Optional[int] = None
    temps_limite_min: Optional[int] = None   # AMRAP / EMOM


@router.post("/api/seances", summary="Crée une séance personnalisée dans une semaine (mode manuel)")
def creer_seance_personnalisee(
    payload: CreerSeanceSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    # Tout le corps est protégé : une exception non gérée (500 sans en-têtes
    # CORS via ServerErrorMiddleware) apparaîtrait comme "Network error" côté
    # navigateur. On convertit toute erreur en HTTPException (CORS conservé).
    try:
        # Vérifier que la semaine appartient bien à l'utilisateur
        semaine = (
            db.query(SemaineEntrainement)
            .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
            .filter(
                SemaineEntrainement.id == payload.semaine_id,
                Macrocycle.utilisateur_id == current_user.id,
            )
            .first()
        )
        if not semaine:
            raise HTTPException(404, "Semaine introuvable")

        try:
            type_seance = TypeSeance(payload.type_seance)
        except ValueError:
            raise HTTPException(400, f"Type de séance invalide : {payload.type_seance}")

        try:
            date_seance = date.fromisoformat(payload.date_seance)
        except ValueError:
            raise HTTPException(400, "Format date_seance invalide — attendu YYYY-MM-DD")

        zone = None
        if payload.zone_cible:
            try:
                zone = ZoneCourse(payload.zone_cible)
            except ValueError:
                raise HTTPException(400, f"Zone invalide : {payload.zone_cible}")

        # Ordre : à la fin de la semaine
        nb_existantes = db.query(SeanceEntrainement).filter(
            SeanceEntrainement.semaine_id == semaine.id
        ).count()

        seance = SeanceEntrainement(
            semaine_id=semaine.id,
            date_seance=date_seance,
            type_seance=type_seance,
            titre=payload.titre,
            description=payload.description,
            ordre_dans_semaine=nb_existantes + 1,
            zone_cible=zone,
            distance_cible_km=payload.distance_cible_km,
            duree_cible_min=payload.duree_cible_min,
            dplus_cible_m=payload.dplus_cible_m,
            temps_limite_min=payload.temps_limite_min,
            date_planifiee=date_seance,
            heure_planifiee=payload.heure_planifiee or None,
        )
        db.add(seance)
        db.commit()
        db.refresh(seance)
        return {"id": seance.id, "message": "Séance créée."}
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("Erreur création séance")
        raise HTTPException(500, "Erreur lors de la création de la séance")


@router.delete("/api/seances/{seance_id}", summary="Supprime une séance (et son journal)")
def supprimer_seance(
    seance_id: int,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    seance = (
        db.query(SeanceEntrainement)
        .join(SemaineEntrainement, SeanceEntrainement.semaine_id == SemaineEntrainement.id)
        .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
        .filter(
            SeanceEntrainement.id == seance_id,
            Macrocycle.utilisateur_id == current_user.id,
        )
        .first()
    )
    if not seance:
        raise HTTPException(404, "Séance introuvable")

    # Supprimer le journal d'abord (FK), puis la séance (exercices en cascade ORM)
    db.query(JournalSeance).filter(JournalSeance.seance_id == seance_id).delete(synchronize_session=False)
    db.delete(seance)
    db.commit()
    return {"message": "Séance supprimée."}


class ModifierSeanceSchema(BaseModel):
    type_seance: Optional[str] = None
    titre: Optional[str] = None
    date_seance: Optional[str] = None        # "YYYY-MM-DD"
    heure_planifiee: Optional[str] = None    # "HH:MM"
    description: Optional[str] = None
    zone_cible: Optional[str] = None
    distance_cible_km: Optional[float] = None
    duree_cible_min: Optional[int] = None
    dplus_cible_m: Optional[int] = None
    temps_limite_min: Optional[int] = None


@router.patch("/api/seances/{seance_id}", summary="Modifie une séance personnalisée (mode manuel)")
def modifier_seance_personnalisee(
    seance_id: int,
    payload: ModifierSeanceSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    try:
        seance = (
            db.query(SeanceEntrainement)
            .join(SemaineEntrainement, SeanceEntrainement.semaine_id == SemaineEntrainement.id)
            .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
            .filter(
                SeanceEntrainement.id == seance_id,
                Macrocycle.utilisateur_id == current_user.id,
            )
            .first()
        )
        if not seance:
            raise HTTPException(404, "Séance introuvable")

        if payload.type_seance is not None:
            try:
                seance.type_seance = TypeSeance(payload.type_seance)
            except ValueError:
                raise HTTPException(400, f"Type de séance invalide : {payload.type_seance}")

        if payload.date_seance is not None:
            try:
                d = date.fromisoformat(payload.date_seance)
            except ValueError:
                raise HTTPException(400, "Format date_seance invalide — attendu YYYY-MM-DD")
            seance.date_seance = d
            seance.date_planifiee = d

        if payload.zone_cible is not None:
            if payload.zone_cible == "":
                seance.zone_cible = None
            else:
                try:
                    seance.zone_cible = ZoneCourse(payload.zone_cible)
                except ValueError:
                    raise HTTPException(400, f"Zone invalide : {payload.zone_cible}")

        # Champs simples (None = non modifié explicitement ; on écrase quand fourni)
        if payload.titre is not None:            seance.titre = payload.titre
        if payload.heure_planifiee is not None:  seance.heure_planifiee = payload.heure_planifiee or None
        seance.description       = payload.description
        seance.distance_cible_km = payload.distance_cible_km
        seance.duree_cible_min   = payload.duree_cible_min
        seance.dplus_cible_m     = payload.dplus_cible_m
        seance.temps_limite_min  = payload.temps_limite_min

        db.commit()
        return {"id": seance.id, "message": "Séance modifiée."}
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("Erreur modification séance")
        raise HTTPException(500, "Erreur lors de la modification de la séance")

