"""Corps : marqueurs de journée, ressenti du matin, journal des douleurs."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import corps_service as co
import suivi_service as sv
from database import obtenir_session
from deps import get_current_user
from models import Douleur, ReleveDouleur, Utilisateur

router = APIRouter()


def _jour(user: Utilisateur, jour: Optional[date]) -> date:
    auj = sv.aujourdhui(user)
    j = jour or auj
    if j > auj + timedelta(days=1) or j < auj - timedelta(days=3650):
        raise HTTPException(400, "Date hors limites")
    return j


class MarqueurSchema(BaseModel):
    type: str = Field(..., pattern="^(malade|voyage|alcool|stress|courbatures)$")
    actif: bool = True
    jour: Optional[date] = None


@router.get("/api/corps/marqueurs", summary="Marqueurs de journée des 120 derniers jours")
def marqueurs(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    auj = sv.aujourdhui(current_user)
    m = co.marqueurs_par_jour(db, current_user.id, auj - timedelta(days=120))
    return {"types": co.TYPES_MARQUEURS, "jours": [{"jour": j.isoformat(), "types": t} for j, t in sorted(m.items())]}


@router.put("/api/corps/marqueurs", summary="Pose ou retire un marqueur (malade, voyage, alcool, stress, courbatures)")
def basculer_marqueur(payload: MarqueurSchema, current_user: Utilisateur = Depends(get_current_user),
                      db: Session = Depends(obtenir_session)):
    j = _jour(current_user, payload.jour)
    types = co.basculer_marqueur(db, current_user.id, j, payload.type, payload.actif)
    db.commit()
    return {"jour": j.isoformat(), "types": types}


class RessentiSchema(BaseModel):
    jour: Optional[date] = None
    energie: Optional[int] = Field(None, ge=1, le=5)
    jambes: Optional[int] = Field(None, ge=1, le=5)
    humeur: Optional[int] = Field(None, ge=1, le=5)
    motivation: Optional[int] = Field(None, ge=1, le=5)


@router.put("/api/corps/ressenti", summary="Ressenti du matin : énergie, jambes, humeur, motivation (1 à 5)")
def noter_ressenti(payload: RessentiSchema, current_user: Utilisateur = Depends(get_current_user),
                   db: Session = Depends(obtenir_session)):
    j = _jour(current_user, payload.jour)
    valeurs = {k: getattr(payload, k) for k in payload.model_fields_set if k != "jour"}
    res = co.noter_ressenti(db, current_user.id, j, valeurs)
    db.commit()
    return res


class DouleurSchema(BaseModel):
    zone: str = Field(..., max_length=30)
    cote: Optional[str] = Field(None, pattern="^(gauche|droite)$")
    debut: Optional[date] = None
    intensite: Optional[int] = Field(None, ge=0, le=10)
    notes: Optional[str] = Field(None, max_length=4000)


class MajDouleurSchema(BaseModel):
    debut: Optional[date] = None
    fin: Optional[date] = None
    terminee: Optional[bool] = None     # True : fin aujourd'hui (ou `fin`) ; False : rouvre
    notes: Optional[str] = Field(None, max_length=4000)


class ReleveSchema(BaseModel):
    jour: Optional[date] = None
    intensite: int = Field(..., ge=0, le=10)
    note: Optional[str] = Field(None, max_length=500)


def _douleur(db: Session, user: Utilisateur, douleur_id: int) -> Douleur:
    d = db.query(Douleur).filter(Douleur.id == douleur_id, Douleur.utilisateur_id == user.id).first()
    if not d:
        raise HTTPException(404, "Douleur introuvable")
    return d


@router.get("/api/corps/douleurs", summary="Journal des douleurs : zones, relevés, charge avant le début")
def douleurs(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    return co.journal(db, current_user.id, sv.aujourdhui(current_user))


@router.post("/api/corps/douleurs", summary="Ouvre une douleur (zone, côté, début, intensité)")
def creer_douleur(payload: DouleurSchema, current_user: Utilisateur = Depends(get_current_user),
                  db: Session = Depends(obtenir_session)):
    if payload.zone not in co.ZONES:
        raise HTTPException(400, "Zone inconnue")
    auj = sv.aujourdhui(current_user)
    debut = min(_jour(current_user, payload.debut), auj)
    d = Douleur(utilisateur_id=current_user.id, zone=payload.zone,
                cote=payload.cote if co.ZONES[payload.zone][1] else None,
                debut=debut, notes=(payload.notes or "").strip() or None)
    db.add(d)
    db.flush()
    if payload.intensite is not None:
        co.noter_releve(db, d, auj, payload.intensite, None)
    db.commit()
    return co.journal(db, current_user.id, auj)


@router.patch("/api/corps/douleurs/{douleur_id}", summary="Dates, notes, clôture ou réouverture d'une douleur")
def modifier_douleur(douleur_id: int, payload: MajDouleurSchema, current_user: Utilisateur = Depends(get_current_user),
                     db: Session = Depends(obtenir_session)):
    d = _douleur(db, current_user, douleur_id)
    champs = payload.model_fields_set
    if "debut" in champs and payload.debut:
        d.debut = _jour(current_user, payload.debut)
    if "notes" in champs:
        d.notes = (payload.notes or "").strip() or None
    if payload.terminee is False:
        d.fin = None
    elif payload.terminee is True or ("fin" in champs and payload.fin):
        d.fin = max(d.debut, _jour(current_user, payload.fin))
    db.commit()
    return co.journal(db, current_user.id, sv.aujourdhui(current_user))


@router.put("/api/corps/douleurs/{douleur_id}/releve", summary="Intensité du jour (0 à 10)")
def relever(douleur_id: int, payload: ReleveSchema, current_user: Utilisateur = Depends(get_current_user),
            db: Session = Depends(obtenir_session)):
    d = _douleur(db, current_user, douleur_id)
    j = _jour(current_user, payload.jour)
    if j < d.debut:
        d.debut = j
    co.noter_releve(db, d, j, payload.intensite, payload.note)
    db.commit()
    return co.journal(db, current_user.id, sv.aujourdhui(current_user))


@router.delete("/api/corps/douleurs/{douleur_id}", summary="Supprime une douleur saisie par erreur")
def supprimer_douleur(douleur_id: int, current_user: Utilisateur = Depends(get_current_user),
                      db: Session = Depends(obtenir_session)):
    d = _douleur(db, current_user, douleur_id)
    db.query(ReleveDouleur).filter(ReleveDouleur.douleur_id == d.id).delete()
    db.delete(d)
    db.commit()
    return co.journal(db, current_user.id, sv.aujourdhui(current_user))
