"""Forme du matin, records personnels et abonnement aux notifications push."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

import bilan_service as bs
import periodes_service as pe
import suivi_service as sv
from database import obtenir_session
from deps import get_current_user, limiter
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


@router.get("/api/bilan", summary="Bilan d'une année : totaux, mois, régularité, records, sorties marquantes")
def bilan(annee: Optional[int] = Query(None, ge=2000, le=2100),
          current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    limiter(f"segments:{current_user.id}", 20, 60)
    res = bs.bilan(db, current_user, annee or sv.aujourdhui(current_user).year)
    db.commit()  # meilleurs efforts mémorisés
    return res


@router.get("/api/bilan/periode", summary="Bilan d'une semaine ou d'un mois, comparé aux périodes précédentes")
def bilan_periode(type: str = Query("semaine", pattern="^(semaine|mois)$"),
                  ref: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}(-\d{2})?$"),
                  current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    limiter(f"periode:{current_user.id}", 60, 60)
    try:
        res = pe.bilan_periode(db, current_user, type, ref)
    except ValueError:
        raise HTTPException(400, "Période invalide")
    db.commit()  # meilleurs efforts mémorisés
    return res


@router.get("/api/calendrier", summary="Calendrier d'un mois : séances faites et prévues, charge du jour, marqueurs")
def calendrier(mois: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}$"),
               current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    try:
        res = pe.calendrier(db, current_user, mois)
    except ValueError:
        raise HTTPException(400, "Mois invalide")
    db.commit()  # rapprochements du plan
    return res


@router.get("/api/jalons", summary="Séries de semaines actives, cumul de l'année et paliers franchis")
def jalons(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    return pe.jalons(db, current_user)


@router.get("/api/exploration", summary="Kilomètres de chemins parcourus pour la première fois, mois par mois")
def exploration(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    limiter(f"exploration:{current_user.id}", 12, 60)
    return pe.exploration(db, current_user)


# ---------------------------------------------------------------------------
# Notifications push
# ---------------------------------------------------------------------------

def _endpoint_valide(v: str) -> str:
    if not sv.endpoint_push_autorise(v):
        raise ValueError("Service de notification non reconnu")
    return v


class AbonnementSchema(BaseModel):
    endpoint: str = Field(..., min_length=10, max_length=2000)
    p256dh: str = Field(..., min_length=10, max_length=500)
    auth: str = Field(..., min_length=4, max_length=500)

    # Le serveur enverra des requêtes vers cette adresse : on n'accepte que les services push des navigateurs
    _verif = field_validator("endpoint")(_endpoint_valide)


class DesabonnementSchema(BaseModel):
    endpoint: str = Field(..., max_length=2000)


@router.get("/api/push", summary="Notifications : configuration du serveur et nombre d'appareils abonnés")
def statut_push(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    n = db.query(PushSubscription).filter(PushSubscription.utilisateur_id == current_user.id).count()
    return {"configure": sv.push_configure(), "cle_publique": sv.VAPID_PUBLIQUE or None, "appareils": n,
            "heure": sv.heure_notif(current_user), "heures": sv.HEURES_MATIN,
            "rappel_poids_jour": current_user.rappel_poids_jour if current_user.rappel_poids_jour is not None else 0,
            "reglages": sv.reglages_notifs(current_user),
            "types": [{"cle": k, "label": v[0], "texte": v[1]} for k, v in sv.NOTIFS.items()]}


class ReglageNotifSchema(BaseModel):
    cle: str = Field(..., max_length=20)
    actif: bool


@router.put("/api/push/reglages", summary="Active ou coupe un type de notification")
def changer_reglage(payload: ReglageNotifSchema, current_user: Utilisateur = Depends(get_current_user),
                    db: Session = Depends(obtenir_session)):
    if payload.cle not in sv.NOTIFS:
        raise HTTPException(422, "Type de notification inconnu")
    res = sv.changer_reglage_notif(current_user, payload.cle, payload.actif)
    db.commit()
    return {"reglages": res}


class HeureSchema(BaseModel):
    heure: str = Field(..., pattern=r"^\d{2}:\d{2}$")


@router.put("/api/push/heure", summary="Heure souhaitée pour la notification du matin")
def changer_heure(payload: HeureSchema, current_user: Utilisateur = Depends(get_current_user),
                  db: Session = Depends(obtenir_session)):
    if payload.heure not in sv.HEURES_MATIN:
        raise HTTPException(422, "Heure non proposée (de 05:30 à 11:30, par demi-heure)")
    current_user.notif_matin_heure = payload.heure
    db.commit()
    return {"heure": payload.heure}


class RappelPoidsSchema(BaseModel):
    jour: int = Field(..., ge=-1, le=6, description="0 = lundi … 6 = dimanche, -1 = désactivé")


@router.put("/api/push/rappel-poids", summary="Jour du rappel hebdomadaire de pesée")
def changer_rappel_poids(payload: RappelPoidsSchema, current_user: Utilisateur = Depends(get_current_user),
                         db: Session = Depends(obtenir_session)):
    current_user.rappel_poids_jour = payload.jour
    db.commit()
    return {"rappel_poids_jour": payload.jour}


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
