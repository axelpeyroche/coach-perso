"""Routes du domaine notifications push : abonnement, désabonnement, test."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import deps
from database import obtenir_session
from deps import get_current_user
from models import PushSubscription, Utilisateur

router = APIRouter()


class PushSubscribeSchema(BaseModel):
    endpoint: str
    p256dh: str
    auth: str


@router.get("/api/push/vapid-public-key", summary="Retourne la clé publique VAPID")
def get_vapid_public_key():
    return {"publicKey": deps._VAPID_PUBLIC}


@router.post("/api/push/subscribe", summary="Enregistre un endpoint push")
def push_subscribe(
    payload: PushSubscribeSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    sub = db.query(PushSubscription).filter_by(endpoint=payload.endpoint).first()
    if sub:
        sub.p256dh = payload.p256dh
        sub.auth   = payload.auth
        sub.utilisateur_id = current_user.id
    else:
        sub = PushSubscription(
            utilisateur_id=current_user.id,
            endpoint=payload.endpoint,
            p256dh=payload.p256dh,
            auth=payload.auth,
        )
        db.add(sub)
    db.commit()
    return {"ok": True}


@router.delete("/api/push/unsubscribe", summary="Supprime un endpoint push")
def push_unsubscribe(
    payload: PushSubscribeSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    sub = db.query(PushSubscription).filter_by(
        endpoint=payload.endpoint, utilisateur_id=current_user.id
    ).first()
    if sub:
        db.delete(sub)
        db.commit()
    return {"ok": True}



@router.post("/api/push/test", summary="Envoie une notification push de test à l'utilisateur connecté")
def push_test(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    if not deps._PUSH_ENABLED or not deps._VAPID_PRIVATE:
        raise HTTPException(503, "Push non configuré sur ce serveur")
    subs = db.query(PushSubscription).filter_by(utilisateur_id=current_user.id).all()
    if not subs:
        raise HTTPException(404, "Aucun abonnement push enregistré pour cet utilisateur")
    import json as _json
    payload = _json.dumps({
        "title": "Coach EPC — Test 🔔",
        "body": "Les notifications push fonctionnent correctement !",
        "tag": "test-push",
        "url": "/profil",
    })
    sent = 0
    errors = []
    for sub in subs:
        try:
            deps.webpush(
                subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                data=payload,
                vapid_private_key=deps._VAPID_PRIVATE,
                vapid_claims={"sub": deps._VAPID_EMAIL},
            )
            sent += 1
        except deps.WebPushException as e:
            errors.append(f"WebPushException: {e}")
            db.delete(sub)
        except Exception as e:
            errors.append(f"{type(e).__name__}: {e}")
    db.commit()
    if sent == 0:
        raise HTTPException(500, detail={"errors": errors, "subs_count": len(subs)})
    return {"ok": True, "sent": sent, "errors": errors}

