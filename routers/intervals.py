"""
Connexion à Intervals.icu (séances de l'Apple Watch avec tracé GPS et dénivelé).

La clé API personnelle est saisie dans la page Sources ; elle n'est jamais renvoyée au navigateur.
La synchro se lance d'elle-même à l'ouverture de l'app (au plus une fois par quart d'heure),
chaque matin via GitHub Actions (suivie des notifications du jour) (route /api/intervals/synchro-nuit, token d'import), ou à la demande.
"""
from __future__ import annotations

import logging
from datetime import datetime
import urllib.parse
import threading
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Security
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import diagnostic_service as diag
import intervals_service as iv
import suivi_service as sv
from database import SessionLocal, obtenir_session
from deps import est_admin, get_current_user, http_bearer
from models import MesureSante, NuitSommeil, Utilisateur

router = APIRouter()
_log = logging.getLogger(__name__)


class ConnexionIntervalsSchema(BaseModel):
    cle: str = Field(..., min_length=10, max_length=100)
    athlete_id: Optional[str] = Field(None, max_length=30)


def _statut(user: Utilisateur) -> dict:
    return {"connecte": bool(user.intervals_cle), "athlete_id": user.intervals_athlete_id,
            "derniere_synchro": user.intervals_derniere_synchro.isoformat() + "Z"
            if user.intervals_derniere_synchro else None,
            "montre": user.montre}


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


class MontreSchema(BaseModel):
    montre: Optional[str] = Field(None, max_length=20)


@router.put("/api/intervals/montre", summary="Marque de la montre (conseils de l'assistant de connexion)")
def choisir_montre(payload: MontreSchema, db: Session = Depends(obtenir_session),
                   current_user: Utilisateur = Depends(get_current_user)):
    if payload.montre is not None and payload.montre not in diag.MONTRES:
        raise HTTPException(422, "Montre inconnue")
    current_user.montre = payload.montre
    db.commit()
    return _statut(current_user)


@router.get("/api/intervals/diagnostic", summary="Vérifie, point par point, ce que la montre envoie au carnet")
def diagnostic(db: Session = Depends(obtenir_session), current_user: Utilisateur = Depends(get_current_user)):
    """Lecture seule : rien n'est modifié dans le carnet ni sur Intervals.icu."""
    from datetime import date, timedelta
    import carnet_service as cs
    from models import Activite
    if not current_user.intervals_cle:
        points = [diag._point("connexion", "Liaison avec Intervals.icu", "absent", "Intervals.icu n'est pas relié au carnet.",
                              "Suis l'assistant de connexion ci-dessus.")]
        return {"points": points, "resume": diag.resume(points), "montre": current_user.montre}
    athlete = urllib.parse.quote(current_user.intervals_athlete_id or "0")
    aujourd_hui = date.today()
    try:
        iv.verifier(current_user.intervals_cle, current_user.intervals_athlete_id)
        activites = iv._appel(current_user.intervals_cle, f"/athlete/{athlete}/activities",
                              {"oldest": (aujourd_hui - timedelta(days=diag.JOURS_SEANCES)).isoformat(),
                               "newest": aujourd_hui.isoformat()}) or []
        wellness = iv._appel(current_user.intervals_cle, f"/athlete/{athlete}/wellness",
                             {"oldest": (aujourd_hui - timedelta(days=diag.JOURS_FORME - 1)).isoformat(),
                              "newest": aujourd_hui.isoformat()}) or []
    except iv.IntervalsErreur as e:
        points = [diag._point("connexion", "Liaison avec Intervals.icu", "erreur", str(e),
                              "Génère une nouvelle clé dans intervals.icu › Settings › Developer Settings, "
                              "puis déconnecte et reconnecte Intervals.icu ici.")]
        return {"points": points, "resume": diag.resume(points), "montre": current_user.montre}
    depuis = datetime.combine(aujourd_hui - timedelta(days=diag.JOURS_SEANCES + 2), datetime.min.time())
    ids = {str(cs._details_dict(a).get("intervals_id")) for a in db.query(Activite).filter(
        Activite.utilisateur_id == current_user.id, Activite.debut >= depuis)}
    ids |= _ignorees_ids(current_user, activites)
    points = [diag._point("connexion", "Liaison avec Intervals.icu", "ok",
                          f"Clé acceptée (athlète {current_user.intervals_athlete_id or '—'}).")]
    points += diag.controles(current_user.montre, activites if isinstance(activites, list) else [],
                             wellness if isinstance(wellness, list) else [], ids, current_user.intervals_derniere_synchro)
    return {"points": points, "resume": diag.resume(points), "montre": current_user.montre}


def _ignorees_ids(user: Utilisateur, activites) -> set[str]:
    """Séances supprimées volontairement du carnet : pas « manquantes »."""
    import carnet_service as cs
    from zoneinfo import ZoneInfo
    ignorees = [datetime.fromisoformat(x) for x in cs._ignorees(user)]
    if not ignorees or not isinstance(activites, list):
        return set()
    tz = ZoneInfo(user.fuseau_horaire or "Europe/Paris")
    res = set()
    for a in activites:
        debut = iv._heure_locale(a.get("start_date"), tz) if isinstance(a, dict) else None
        if debut and any(abs((debut - d).total_seconds()) <= 120 for d in ignorees):
            res.add(str(a.get("id")))
    return res


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
def synchro_nuit(taches: BackgroundTasks,
                 notifier: bool = Query(False, description="Envoie la notification du matin sans attendre l'heure choisie"),
                 credentials: HTTPAuthorizationCredentials = Security(http_bearer),
                 db: Session = Depends(obtenir_session)):
    # Token dans l'en-tête Authorization (jamais dans l'URL, qui finit dans les journaux)
    token = credentials.credentials.strip() if credentials else ""
    user = db.query(Utilisateur).filter(Utilisateur.import_token == token).first() if token else None
    if not user:
        raise HTTPException(401, "Token d'import invalide : recopie-le depuis la page Sources du carnet")
    if not user.intervals_cle:
        raise HTTPException(409, "Intervals.icu n'est pas connecté sur ce compte")
    # La tâche GitHub de l'administrateur sert aussi d'horloge aux autres comptes : une fois la réponse
    # envoyée, chacun est synchronisé à son tour (sans notification forcée), sans rien changer à ce passage-ci
    if est_admin(db, user):
        taches.add_task(synchro_matin_autres_comptes, user.id)
    return passage_matin(db, user, notifier)


def passage_matin(db: Session, user: Utilisateur, notifier: bool = False) -> dict:
    """Synchro du matin d'un compte : séances, sauvegarde hebdomadaire, notifications du jour."""
    deja = user.notif_matin_le == sv.aujourdhui(user)
    res = _synchroniser(db, user, not deja)  # après la notification du jour : synchro limitée (1 / 15 min)
    # Sauvegarde hebdomadaire du compte : faite ici, au premier passage une fois les 7 jours écoulés
    try:
        import sauvegarde_service
        if sauvegarde_service.due(db, user.id):
            res["sauvegarde"] = sauvegarde_service.creer(db, user)["cree_le"]
            db.commit()
    except Exception:
        db.rollback()
        _log.exception("Sauvegarde hebdomadaire en échec")
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


_verrou_autres = threading.Lock()


def synchro_matin_autres_comptes(sauf_id: int) -> dict:
    """Synchro du matin de tous les comptes reliés à Intervals.icu, sauf celui qui a déclenché le passage.
    Un compte en erreur (clé révoquée, Intervals indisponible) n'empêche pas les suivants."""
    if not _verrou_autres.acquire(blocking=False):
        return {"ignore": "passage déjà en cours"}
    bilan = {"comptes": 0, "erreurs": 0}
    try:
        db = SessionLocal()
        try:
            ids = [i for (i,) in db.query(Utilisateur.id).filter(Utilisateur.intervals_cle.isnot(None),
                                                                  Utilisateur.id != sauf_id).order_by(Utilisateur.id)]
        finally:
            db.close()
        for uid in ids:
            db = SessionLocal()
            try:
                user = db.get(Utilisateur, uid)
                if user and user.intervals_cle:
                    passage_matin(db, user)
                    bilan["comptes"] += 1
            except Exception:
                db.rollback()
                bilan["erreurs"] += 1
                _log.warning("Synchro du matin en échec pour un compte invité", exc_info=True)
            finally:
                db.close()
    finally:
        _verrou_autres.release()
    return bilan


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
