"""
Connexion à Intervals.icu (séances de l'Apple Watch avec tracé GPS et dénivelé).

La clé API personnelle est saisie dans la page Sources ; elle n'est jamais renvoyée au navigateur.
La synchro se lance d'elle-même à l'ouverture de l'app (au plus une fois par quart d'heure),
chaque matin via GitHub Actions (suivie des notifications du jour) (route /api/intervals/synchro-nuit, token d'import), ou à la demande.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Security
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import intervals_service as iv
import suivi_service as sv
from database import SessionLocal, obtenir_session
from deps import get_current_user, http_bearer
from models import MesureSante, NuitSommeil, Utilisateur

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
    return _synchroniser(db, current_user, force)


@router.post("/api/intervals/historique", summary="Récupérer l'historique de forme (pas, sommeil, VFC…) au-delà de 60 jours")
def historique(db: Session = Depends(obtenir_session), current_user: Utilisateur = Depends(get_current_user)):
    if not current_user.intervals_cle:
        raise HTTPException(409, "Intervals.icu n'est pas connecté")
    try:
        res = iv.importer_historique_wellness(db, current_user)
        db.commit()
    except iv.IntervalsErreur as e:
        db.rollback()
        raise HTTPException(502, str(e))
    return res


@router.post("/api/intervals/synchro-nuit", summary="Synchro planifiée (GitHub Actions) — auth par token d'import")
def synchro_nuit(notifier: bool = Query(False, description="Envoie la notification du matin sans attendre l'heure choisie"),
                 credentials: HTTPAuthorizationCredentials = Security(http_bearer),
                 db: Session = Depends(obtenir_session)):
    # Token dans l'en-tête Authorization (jamais dans l'URL, qui finit dans les journaux)
    token = credentials.credentials.strip() if credentials else ""
    user = db.query(Utilisateur).filter(Utilisateur.import_token == token).first() if token else None
    if not user:
        raise HTTPException(401, "Token d'import invalide : recopie-le depuis la page Sources du carnet")
    if not user.intervals_cle:
        raise HTTPException(409, "Intervals.icu n'est pas connecté sur ce compte")
    deja = user.notif_matin_le == sv.aujourdhui(user)
    res = _synchroniser(db, user, not deja)  # après la notification du jour : synchro limitée (1 / 15 min)
    # Synchro du matin (tâche toutes les 30 min) : forme du jour, alerte VFC et records battus,
    # envoyés une seule fois par jour, à partir de l'heure choisie dans le profil
    if not notifier and not sv.notif_matin_due(user):
        res["notifications"] = {"deja_envoyee": True} if deja else {"prevue_a": sv.heure_notif(user)}
        return res
    try:
        res["notifications"] = sv.notifications_matin(db, user)
        user.notif_matin_le = sv.aujourdhui(user)
        db.commit()
    except Exception:
        db.rollback()
        _log.exception("Notifications du matin en échec")
        res["notifications"] = {"erreur": True}
    return res


def _synchroniser(db: Session, user: Utilisateur, force: bool) -> dict:
    if not user.intervals_cle:
        return {**_statut(user), "ignore": True}
    try:
        bilan = iv.synchroniser(db, user, force=force)
        db.commit()
    except iv.IntervalsErreur as e:
        db.rollback()
        raise HTTPException(502, str(e))
    except IntegrityError:
        db.rollback()  # une autre synchro tournait en même temps : elle a déjà tout enregistré
        bilan = {"ignore": True}
    return {**_statut(user), **bilan}


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


# ── Nuits importées par l'ancien raccourci / l'export Santé (fonction retirée) ──
# Leur durée et leur score maison avaient remplacé ceux d'Intervals.icu : l'utilisateur peut les effacer,
# puis le sommeil de ces jours est relu sur Intervals.icu.
@router.get("/api/sommeil/nuits-importees", summary="Nombre de nuits importées hors Intervals.icu")
def nuits_importees(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    jours = [j for (j,) in db.query(NuitSommeil.jour).filter(NuitSommeil.utilisateur_id == current_user.id)]
    return {"nuits": len(jours), "du": min(jours).isoformat() if jours else None,
            "au": max(jours).isoformat() if jours else None}


@router.delete("/api/sommeil/nuits-importees", summary="Efface les nuits importées et relit le sommeil sur Intervals.icu")
def effacer_nuits_importees(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    jours = [j for (j,) in db.query(NuitSommeil.jour).filter(NuitSommeil.utilisateur_id == current_user.id)]
    if not jours:
        return {"nuits": 0, "mesures": 0}
    effacees = db.query(MesureSante).filter(
        MesureSante.utilisateur_id == current_user.id, MesureSante.type.in_(("sommeil", "score_sommeil")),
        MesureSante.jour.in_(jours)).delete(synchronize_session=False)
    db.query(NuitSommeil).filter(NuitSommeil.utilisateur_id == current_user.id).delete(synchronize_session=False)
    relues = 0
    if current_user.intervals_cle:
        try:
            relues, _ = iv.synchroniser_wellness(db, current_user, min(jours), max(jours))
        except iv.IntervalsErreur:
            _log.warning("Sommeil non relu sur Intervals.icu après effacement des nuits importées")
    db.commit()
    return {"nuits": len(jours), "mesures": effacees, "relues": relues}
