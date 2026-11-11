"""Santé du carnet : état des synchros, anomalies, séances et jours écartés des calculs, journal, sauvegardes."""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import cache_analyses
import qualite_service as qs
import sauvegarde_service as sauv
import suivi_service as sv
from database import obtenir_session
from deps import get_current_user, limiter
from models import Utilisateur

router = APIRouter()


class ExclusionSchema(BaseModel):
    activite_id: Optional[int] = Field(None, gt=0)
    type_mesure: Optional[str] = Field(None, max_length=20)
    jour: Optional[date] = None
    raison: Optional[str] = Field(None, max_length=200)


@router.get("/api/carnet/sante", summary="Santé du carnet : synchros, trous, couverture par année, anomalies, journal, sauvegardes")
def sante(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    auj = sv.aujourdhui(current_user)
    return {
        "synchros": qs.etat_synchros(db, current_user, auj),
        "couverture": qs.couverture(db, current_user.id),
        "anomalies": qs.anomalies(db, current_user, auj),
        "exclusions": qs.liste_exclusions(db, current_user.id),
        "journal": qs.journal(db, current_user.id),
        "sauvegardes": {"liste": sauv.lister(db, current_user.id), "intervalle_jours": sauv.INTERVALLE_J,
                        "gardees": sauv.GARDEES},
        "cache": cache_analyses.stats(),
    }


@router.get("/api/carnet/exclusions", summary="Séances et jours écartés des calculs")
def lire_exclusions(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    return qs.liste_exclusions(db, current_user.id)


@router.post("/api/carnet/exclusions", summary="Écarte une séance ou la mesure d'un jour des calculs, sans la supprimer")
def ecarter(payload: ExclusionSchema, current_user: Utilisateur = Depends(get_current_user),
            db: Session = Depends(obtenir_session)):
    if not payload.activite_id and not (payload.type_mesure and payload.jour):
        raise HTTPException(422, "Indique une séance, ou une mesure et son jour")
    try:
        e = qs.ecarter(db, current_user, payload.activite_id, payload.type_mesure, payload.jour, payload.raison)
    except ValueError as err:
        raise HTTPException(404, str(err))
    db.commit()
    return {"ok": True, "id": e.id}


@router.delete("/api/carnet/exclusions/{exclusion_id}", summary="Réintègre une séance ou un jour dans les calculs")
def reintegrer(exclusion_id: int, current_user: Utilisateur = Depends(get_current_user),
               db: Session = Depends(obtenir_session)):
    if not qs.reintegrer(db, current_user, exclusion_id):
        raise HTTPException(404, "Mise à l'écart introuvable")
    db.commit()
    return {"ok": True}


@router.post("/api/carnet/sauvegardes", summary="Crée une sauvegarde du compte maintenant")
def sauvegarder(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    limiter(f"sauvegarde:{current_user.id}", 6, 3600)
    fiche = sauv.creer(db, current_user, origine="manuel")
    db.commit()
    return fiche


@router.get("/api/carnet/sauvegardes/{sauvegarde_id}", summary="Télécharge une sauvegarde (JSON)")
def telecharger(sauvegarde_id: int, current_user: Utilisateur = Depends(get_current_user),
                db: Session = Depends(obtenir_session)):
    trouve = sauv.contenu(db, current_user.id, sauvegarde_id)
    if not trouve:
        raise HTTPException(404, "Sauvegarde introuvable")
    brut, cree_le = trouve
    return Response(brut, media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="carnet-sauvegarde-{cree_le:%Y-%m-%d}.json"'})
