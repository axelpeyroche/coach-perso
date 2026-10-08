"""Forme du matin, records personnels et abonnement aux notifications push."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import suivi_service as sv
from database import obtenir_session
from deps import get_current_user
from models import PushSubscription, Utilisateur

router = APIRouter()


@router.get("/api/forme/jour", summary="Forme du matin (VFC, FC repos vs référence) et séance conseillée")
def forme_jour(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    res = sv.forme_du_jour(db, current_user)
    db.commit()  # rapprochements du plan
    return res


@router.get("/api/records", summary="Records personnels : course (tracés), distances, muscu (notes)")
def records(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    res = sv.records(db, current_user)
    db.commit()  # meilleurs efforts mémorisés
    return res


# ---------------------------------------------------------------------------
# Notifications push
# ---------------------------------------------------------------------------

class AbonnementSchema(BaseModel):
    endpoint: str = Field(..., min_length=10, max_length=2000)
    p256dh: str = Field(..., min_length=10, max_length=500)
    auth: str = Field(..., min_length=4, max_length=500)


class DesabonnementSchema(BaseModel):
    endpoint: str = Field(..., max_length=2000)


@router.get("/api/push", summary="Notifications : configuration du serveur et nombre d'appareils abonnés")
def statut_push(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    n = db.query(PushSubscription).filter(PushSubscription.utilisateur_id == current_user.id).count()
    return {"configure": sv.push_configure(), "cle_publique": sv.VAPID_PUBLIQUE or None, "appareils": n}


@router.post("/api/push/abonnement", summary="Abonne cet appareil aux notifications")
def abonner(payload: AbonnementSchema, current_user: Utilisateur = Depends(get_current_user),
            db: Session = Depends(obtenir_session)):
    if not sv.push_configure():
        raise HTTPException(503, "Notifications non configurées sur le serveur (clés VAPID absentes)")
    s = db.query(PushSubscription).filter(PushSubscription.endpoint == payload.endpoint).first()
    if s:
        s.utilisateur_id, s.p256dh, s.auth = current_user.id, payload.p256dh, payload.auth
    else:
        db.add(PushSubscription(utilisateur_id=current_user.id, **payload.model_dump()))
    db.commit()
    return {"ok": True}


@router.post("/api/push/desabonnement", summary="Désabonne cet appareil")
def desabonner(payload: DesabonnementSchema, current_user: Utilisateur = Depends(get_current_user),
               db: Session = Depends(obtenir_session)):
    db.query(PushSubscription).filter(PushSubscription.utilisateur_id == current_user.id,
                                      PushSubscription.endpoint == payload.endpoint).delete()
    db.commit()
    return {"ok": True}


@router.post("/api/push/garder-seul", summary="Supprime les autres abonnements (anciens ou doublons) et garde cet appareil")
def garder_seul(payload: DesabonnementSchema, current_user: Utilisateur = Depends(get_current_user),
                db: Session = Depends(obtenir_session)):
    q = db.query(PushSubscription).filter(PushSubscription.utilisateur_id == current_user.id)
    if not q.filter(PushSubscription.endpoint == payload.endpoint).count():
        raise HTTPException(404, "Cet appareil n'est pas abonné : réactive les notifications d'abord")
    n = q.filter(PushSubscription.endpoint != payload.endpoint).delete(synchronize_session=False)
    db.commit()
    return {"supprimes": n}


@router.post("/api/push/test", summary="Envoie une notification de test à tous mes appareils")
def tester(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    if not sv.push_configure():
        raise HTTPException(503, "Notifications non configurées sur le serveur (clés VAPID absentes)")
    n = sv.envoyer(db, current_user.id, "Carnet", "Les notifications fonctionnent sur cet appareil 👍", "/", "test")
    db.commit()
    if not n:
        raise HTTPException(409, "Aucun appareil n'a reçu la notification : réactive-les sur cet appareil")
    return {"envoyees": n}
