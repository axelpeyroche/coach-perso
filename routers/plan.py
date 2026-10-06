"""
Plan d'entraînement : séances prévues.

- Routes authentifiées (JWT) pour le dashboard : consulter le plan, marquer une
  séance sautée, la relier à une activité, commenter, supprimer.
- Routes « Claude » (en-tête `X-Carnet-Token`) pour le script `outils/carnet.py` :
  lire l'export complet, lire et envoyer le plan.
"""

from __future__ import annotations

import secrets as _secrets
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import carnet_service as cs
from database import obtenir_session
from deps import get_current_user
from models import Activite, Objectif, SeancePrevue, Utilisateur
from routers.carnet import _reponse_export

router = APIRouter()


# ---------------------------------------------------------------------------
# Schémas
# ---------------------------------------------------------------------------

class SeancePrevueSchema(BaseModel):
    # Rattache la séance à sa semaine (n'importe quel jour de la semaine) ; l'athlète
    # choisit lui-même le jour. Absent : semaine en cours.
    jour: Optional[date] = None
    sport: str
    titre: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    duree_min: Optional[int] = Field(None, ge=0, le=1440)
    distance_km: Optional[float] = Field(None, ge=0)
    dplus_m: Optional[int] = Field(None, ge=0)
    rpe_cible: Optional[float] = Field(None, ge=1, le=10)
    ordre: int = 0
    id_externe: Optional[str] = Field(None, max_length=100)
    objectif_id: Optional[int] = None


class PeriodeSchema(BaseModel):
    depuis: date
    jusqu_a: date


class EnvoiPlanSchema(BaseModel):
    seances: list[SeancePrevueSchema]
    remplacer: Optional[PeriodeSchema] = None


class MajPrevueSchema(BaseModel):
    statut: Optional[str] = Field(None, pattern="^(prevue|sautee)$")
    commentaire: Optional[str] = None
    activite_id: Optional[int] = None
    delier: bool = False


def _items(db: Session, user: Utilisateur, seances: list[SeancePrevueSchema]) -> list[dict]:
    objectifs = {o for (o,) in db.query(Objectif.id).filter(Objectif.utilisateur_id == user.id).all()}
    items = []
    for s in seances:
        if s.objectif_id is not None and s.objectif_id not in objectifs:
            raise HTTPException(400, f"Objectif inconnu : {s.objectif_id}")
        d = s.model_dump()
        d["sport"] = cs.normaliser_sport(s.sport)
        items.append(d)
    return items


def _periode(depuis: Optional[date], jusqu_a: Optional[date]) -> tuple[date, date]:
    auj = date.today()
    lundi = auj - timedelta(days=auj.weekday())
    return depuis or lundi - timedelta(days=7), jusqu_a or lundi + timedelta(days=27)


def _prevue(db: Session, user: Utilisateur, prevue_id: int) -> SeancePrevue:
    p = db.query(SeancePrevue).filter(SeancePrevue.id == prevue_id, SeancePrevue.utilisateur_id == user.id).first()
    if not p:
        raise HTTPException(404, "Séance prévue introuvable")
    return p


def _une(db: Session, p: SeancePrevue) -> dict:
    a = db.get(Activite, p.activite_id) if p.activite_id else None
    return cs.serialiser_prevue(p, a)


# ---------------------------------------------------------------------------
# Dashboard (JWT)
# ---------------------------------------------------------------------------

@router.get("/api/plan", summary="Séances prévues d'une période (rapprochement automatique avec les activités)")
def lister_plan(
    depuis: Optional[date] = None,
    jusqu_a: Optional[date] = None,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    d, f = _periode(depuis, jusqu_a)
    res = cs.lister_plan(db, current_user.id, d, f)
    db.commit()  # conserve les rapprochements calculés
    return {"depuis": d.isoformat(), "jusqu_a": f.isoformat(), "seances": res}


@router.post("/api/plan", summary="Ajoute une séance prévue à la main")
def creer_prevue(
    payload: SeancePrevueSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    item = _items(db, current_user, [payload])[0]
    item["id_externe"] = item["id_externe"] or f"manuel-{_secrets.token_hex(6)}"
    if not item["jour"]:
        auj = date.today()
        item["jour"] = auj - timedelta(days=auj.weekday())
    cs.enregistrer_plan(db, current_user.id, [item])
    db.commit()
    p = db.query(SeancePrevue).filter(SeancePrevue.utilisateur_id == current_user.id,
                                      SeancePrevue.id_externe == item["id_externe"]).first()
    return _une(db, p)


@router.patch("/api/plan/{prevue_id}", summary="Statut (sautée), commentaire ou rattachement à une activité")
def modifier_prevue(
    prevue_id: int,
    payload: MajPrevueSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    p = _prevue(db, current_user, prevue_id)
    champs = payload.model_fields_set
    if "statut" in champs and payload.statut:
        p.statut = payload.statut
    if "commentaire" in champs:
        p.commentaire = (payload.commentaire or "").strip() or None
    if payload.delier:
        p.activite_id, p.lien_manuel = None, True
    elif payload.activite_id is not None:
        a = db.query(Activite).filter(Activite.id == payload.activite_id,
                                      Activite.utilisateur_id == current_user.id).first()
        if not a:
            raise HTTPException(400, "Activité inconnue")
        db.query(SeancePrevue).filter(SeancePrevue.utilisateur_id == current_user.id,
                                      SeancePrevue.activite_id == a.id,
                                      SeancePrevue.id != p.id).update({SeancePrevue.activite_id: None})
        p.activite_id, p.lien_manuel, p.statut = a.id, True, "prevue"
    db.commit()
    db.refresh(p)
    return _une(db, p)


@router.get("/api/plan/{prevue_id}/activites", summary="Activités de la semaine de la séance, pour un rattachement manuel")
def activites_proches(
    prevue_id: int,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    p = _prevue(db, current_user, prevue_id)
    lundi = p.jour - timedelta(days=p.jour.weekday())
    debut = datetime.combine(lundi, datetime.min.time())
    fin = datetime.combine(lundi + timedelta(days=7), datetime.min.time())
    acts = (db.query(Activite)
            .filter(Activite.utilisateur_id == current_user.id, Activite.debut >= debut, Activite.debut < fin)
            .order_by(Activite.debut).all())
    fam = cs.famille_sport(p.sport)
    acts.sort(key=lambda a: (cs.famille_sport(a.sport) != fam, a.debut))
    return [cs.serialiser_activite(a) for a in acts]


@router.delete("/api/plan/{prevue_id}", summary="Supprime une séance prévue")
def supprimer_prevue(
    prevue_id: int,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    db.delete(_prevue(db, current_user, prevue_id))
    db.commit()
    return {"ok": True}


@router.get("/api/claude/token", summary="Retourne (et génère si besoin) le token Claude")
def get_claude_token(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    if not current_user.claude_token:
        current_user.claude_token = _secrets.token_urlsafe(32)
        db.commit()
    return {"claude_token": current_user.claude_token}


@router.post("/api/claude/token/regenerer", summary="Régénère le token Claude (invalide l'ancien)")
def regenerer_claude_token(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    current_user.claude_token = _secrets.token_urlsafe(32)
    db.commit()
    return {"claude_token": current_user.claude_token}


# ---------------------------------------------------------------------------
# Claude (en-tête X-Carnet-Token)
# ---------------------------------------------------------------------------

def utilisateur_claude(
    x_carnet_token: Optional[str] = Header(None),
    db: Session = Depends(obtenir_session),
) -> Utilisateur:
    if not x_carnet_token or len(x_carnet_token) < 20:
        raise HTTPException(401, "Token Claude manquant")
    user = db.query(Utilisateur).filter(Utilisateur.claude_token == x_carnet_token).first()
    if not user:
        raise HTTPException(401, "Token Claude invalide")
    return user


@router.get("/api/claude/export", summary="Export complet du carnet (md | json | csv) — token Claude")
def claude_export(
    format: str = Query("md", pattern="^(md|json|csv)$"),
    user: Utilisateur = Depends(utilisateur_claude),
    db: Session = Depends(obtenir_session),
):
    res = _reponse_export(db, user, format)
    db.commit()
    return res


@router.get("/api/claude/plan", summary="Plan d'une période — token Claude")
def claude_plan(
    depuis: Optional[date] = None,
    jusqu_a: Optional[date] = None,
    user: Utilisateur = Depends(utilisateur_claude),
    db: Session = Depends(obtenir_session),
):
    d, f = _periode(depuis, jusqu_a)
    res = cs.lister_plan(db, user.id, d, f)
    db.commit()
    return {"depuis": d.isoformat(), "jusqu_a": f.isoformat(), "seances": res}


@router.post("/api/claude/plan", summary="Envoie des séances prévues (création / mise à jour par id_externe) — token Claude")
def claude_envoyer_plan(
    payload: EnvoiPlanSchema,
    user: Utilisateur = Depends(utilisateur_claude),
    db: Session = Depends(obtenir_session),
):
    if payload.remplacer and payload.remplacer.jusqu_a < payload.remplacer.depuis:
        raise HTTPException(400, "Période de remplacement invalide")
    bilan = cs.enregistrer_plan(
        db, user.id, _items(db, user, payload.seances),
        remplacer=(payload.remplacer.depuis, payload.remplacer.jusqu_a) if payload.remplacer else None,
    )
    db.commit()
    return {"ok": True, **bilan}


@router.delete("/api/claude/plan/{id_externe}", summary="Supprime une séance prévue par id_externe — token Claude")
def claude_supprimer(
    id_externe: str,
    user: Utilisateur = Depends(utilisateur_claude),
    db: Session = Depends(obtenir_session),
):
    p = db.query(SeancePrevue).filter(SeancePrevue.utilisateur_id == user.id,
                                      SeancePrevue.id_externe == id_externe).first()
    if not p:
        raise HTTPException(404, "Séance prévue introuvable")
    db.delete(p)
    db.commit()
    return {"ok": True}
