"""Routes du domaine analytique : tendances, volume, biométrie, records, résumés hebdomadaires."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

import analytics_service
from database import obtenir_session
from deps import get_current_user
from models import Utilisateur

router = APIRouter()


@router.get(
    "/api/analytics/tendances-physiologiques",
    summary="Évolution VMA et scores Max 1 min au fil des macrocycles",
)
def tendances_physiologiques(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.tendances_physiologiques(db, current_user.id)


@router.get(
    "/api/analytics/distribution-volume",
    summary="Kilométrage hebdomadaire, D+ cumulé et répartition musculaire Push/Pull/Jambes",
)
def distribution_volume(
    macrocycle_id: Optional[int] = Query(None),
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.distribution_volume(db, current_user.id, macrocycle_id)


@router.get(
    "/api/analytics/biometrie-recuperation",
    summary="Tendance RPE et Ratio Charge Aiguë/Chronique (ACWA) avec alerte risque blessure",
)
def biometrie_recuperation(
    macrocycle_id: Optional[int] = Query(None),
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.biometrie_recuperation(db, current_user.id, macrocycle_id)


@router.get("/api/analytics/zones-fc", summary="Minutes par zone FC et par semaine")
def zones_fc_hebdo(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.zones_fc_hebdo(db, current_user.id)


@router.get("/api/analytics/allure-endurance", summary="Progression de l'allure des sorties Z1/Z2")
def allure_endurance(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.allure_endurance(db, current_user.id)


@router.get("/api/analytics/prediction-course", summary="Temps prédit sur l'objectif pour chaque test VMA")
def prediction_course(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.prediction_course(db, current_user.id)


@router.get("/api/analytics/records", summary="Records personnels et jalons")
def records_personnels(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.records_personnels(db, current_user.id)


@router.get("/api/analytics/semaine-en-cours", summary="Progression prévu vs réalisé de la semaine en cours")
def semaine_en_cours(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.semaine_en_cours(db, current_user.id)


@router.get("/api/analytics/resume-hebdo", summary="Bilan de la dernière semaine terminée")
def resume_hebdo(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.resume_hebdo(db, current_user.id)


@router.get("/api/analytics/evenements", summary="Tests et courses mappés sur les semaines (annotations graphiques)")
def evenements_analytics(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.evenements(db, current_user.id)


@router.get("/api/analytics/semaine/{numero_semaine}/seances", summary="Détail des séances d'une semaine")
def seances_semaine_analytics(
    numero_semaine: int,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.seances_semaine(db, current_user.id, numero_semaine)

