"""Routes du domaine utilisateur : profil, poids, mot de passe, fuseau, export/suppression de compte."""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from carnet_service import synchroniser_physiologie
from database import obtenir_session
from deps import _hash_password, _verify_password, get_current_user
from models import Activite, MesureSante, Objectif, ObjectifCourse, PoidsUtilisateur, SeancePrevue, Utilisateur

router = APIRouter()


class ProfilFCSchema(BaseModel):
    fc_max: Optional[int] = Field(None, gt=0, lt=250)
    fc_repos: Optional[int] = Field(None, gt=0, lt=150)
    poids_kg: Optional[float] = Field(None, gt=0, lt=300)

@router.get("/api/utilisateur/profil-fc", summary="Récupère fc_max, fc_repos et poids_kg de l'utilisateur")
def get_profil_fc(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    synchroniser_physiologie(db, current_user)  # FC max / FC repos calculées depuis les données importées
    return {"fc_max": current_user.fc_max, "fc_repos": current_user.fc_repos, "poids_kg": current_user.poids_kg}

@router.patch("/api/utilisateur/profil-fc", summary="Met à jour fc_max, fc_repos et/ou poids_kg")
def patch_profil_fc(payload: ProfilFCSchema, current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    if payload.fc_max is not None: current_user.fc_max = payload.fc_max
    if payload.fc_repos is not None: current_user.fc_repos = payload.fc_repos
    if payload.poids_kg is not None:
        # Nouveau relevé de poids → point d'historique (uniquement si la valeur change)
        ancien = current_user.poids_kg
        if ancien is None or abs(payload.poids_kg - ancien) > 0.001:
            db.add(PoidsUtilisateur(utilisateur_id=current_user.id, poids_kg=payload.poids_kg))
        current_user.poids_kg = payload.poids_kg
    db.commit()
    return {"fc_max": current_user.fc_max, "fc_repos": current_user.fc_repos, "poids_kg": current_user.poids_kg}


@router.get("/api/utilisateur/poids/historique", summary="Historique des relevés de poids (évolution)")
def historique_poids(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    entrees = (
        db.query(PoidsUtilisateur)
        .filter(PoidsUtilisateur.utilisateur_id == current_user.id)
        .order_by(PoidsUtilisateur.enregistre_le)
        .all()
    )
    points = [{"date": e.enregistre_le.strftime("%Y-%m-%d"), "poids": round(e.poids_kg, 1)} for e in entrees]
    # Aucun historique mais un poids existant (saisi avant cette fonctionnalité) :
    # on crée un point de départ daté de la création du compte (date réelle du 1er poids).
    if not points and current_user.poids_kg:
        d0 = current_user.cree_le.date() if current_user.cree_le else date.today()
        points.append({"date": d0.strftime("%Y-%m-%d"), "poids": round(current_user.poids_kg, 1)})
    return {"points": points}


class ProfilInfosSchema(BaseModel):
    prenom: Optional[str] = None
    nom: Optional[str] = None
    email: Optional[str] = None
    sexe: Optional[str] = None
    date_naissance: Optional[str] = None  # "YYYY-MM-DD" ou null pour effacer
    poids_kg: Optional[float] = Field(None, gt=0, lt=300)

@router.patch("/api/utilisateur/infos", summary="Met à jour les informations personnelles")
def patch_utilisateur_infos(
    payload: ProfilInfosSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    if payload.prenom is not None:
        current_user.prenom = payload.prenom
    if payload.nom is not None:
        current_user.nom = payload.nom
    if payload.email is not None:
        existing = db.query(Utilisateur).filter(
            Utilisateur.email == payload.email,
            Utilisateur.id != current_user.id,
        ).first()
        if existing:
            raise HTTPException(409, "Cet email est déjà utilisé")
        current_user.email = payload.email
    if payload.sexe is not None:
        current_user.sexe = payload.sexe
    if payload.poids_kg is not None:
        current_user.poids_kg = payload.poids_kg
    if "date_naissance" in payload.model_fields_set:
        if payload.date_naissance:
            try:
                current_user.date_naissance = date.fromisoformat(payload.date_naissance)
            except ValueError:
                raise HTTPException(400, "Format date invalide, attendu YYYY-MM-DD")
        else:
            current_user.date_naissance = None
    db.commit()
    return {"ok": True}


# Pas de stockage objet dédié (S3, etc.) : la photo est enregistrée telle
# quelle en base sous forme de data URL, d'où la limite de taille stricte.
MAX_PHOTO_DATA_URL_LEN = 2_000_000  # ~1,5 Mo décodé

class PhotoSchema(BaseModel):
    photo_url: Optional[str] = None

@router.patch("/api/utilisateur/photo", summary="Met à jour (ou supprime) la photo de profil")
def patch_utilisateur_photo(
    payload: PhotoSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    photo = payload.photo_url
    if photo:
        if not photo.startswith("data:image/"):
            raise HTTPException(400, "Format de photo invalide")
        if len(photo) > MAX_PHOTO_DATA_URL_LEN:
            raise HTTPException(413, "Photo trop grande (max environ 1,5 Mo)")
    current_user.photo_url = photo
    db.commit()
    return {"ok": True}


class PasswordChangeSchema(BaseModel):
    ancien_mot_de_passe: str
    nouveau_mot_de_passe: str = Field(min_length=8)

@router.patch("/api/utilisateur/password", summary="Change le mot de passe")
def patch_password(
    payload: PasswordChangeSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    if not _verify_password(payload.ancien_mot_de_passe, current_user.password_hash):
        raise HTTPException(400, "Mot de passe actuel incorrect")
    current_user.password_hash = _hash_password(payload.nouveau_mot_de_passe)
    db.commit()
    return {"ok": True}


class FuseauHoraireSchema(BaseModel):
    fuseau_horaire: str

@router.patch("/api/utilisateur/fuseau-horaire", summary="Enregistre le fuseau horaire détecté côté navigateur")
def patch_fuseau_horaire(
    payload: FuseauHoraireSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    try:
        ZoneInfo(payload.fuseau_horaire)
    except Exception:
        raise HTTPException(400, "Fuseau horaire invalide")
    current_user.fuseau_horaire = payload.fuseau_horaire
    db.commit()
    return {"ok": True}


@router.get("/api/utilisateur/export", summary="Exporte toutes les données du compte (portabilité RGPD)")
def exporter_donnees(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    """Dump générique (colonne par colonne) des données personnelles de l'utilisateur."""

    def _dump(obj):
        d = {}
        for col in obj.__table__.columns:
            v = getattr(obj, col.name)
            if isinstance(v, (datetime, date)):
                v = v.isoformat()
            d[col.name] = v
        return d

    poids = (
        db.query(PoidsUtilisateur)
        .filter_by(utilisateur_id=current_user.id)
        .order_by(PoidsUtilisateur.enregistre_le)
        .all()
    )
    objectifs = db.query(ObjectifCourse).filter_by(utilisateur_id=current_user.id).all()
    activites = db.query(Activite).filter_by(utilisateur_id=current_user.id).order_by(Activite.debut).all()
    objectifs_carnet = db.query(Objectif).filter_by(utilisateur_id=current_user.id).all()

    profil = _dump(current_user)
    for secret in ("password_hash", "strava_access_token", "strava_refresh_token"):
        profil.pop(secret, None)

    return {
        "profil": profil,
        "historique_poids": [_dump(p) for p in poids],
        "objectifs_course": [_dump(o) for o in objectifs],
        "activites": [_dump(a) for a in activites],
        "objectifs": [_dump(o) for o in objectifs_carnet],
    }


# Tables de l'ancien programme EPC, plus mappées mais toujours en base avec une
# clé étrangère vers utilisateurs : vidées en SQL brut, dans l'ordre des FK.
_U_SEANCES = ("SELECT s.id FROM seances_entrainement s JOIN semaines_entrainement w ON s.semaine_id = w.id "
              "JOIN macrocycles m ON w.macrocycle_id = m.id WHERE m.utilisateur_id = :u")
_U_EVALS = "SELECT id FROM journaux_evaluation_seance WHERE utilisateur_id = :u"
_PURGE_ANCIENNES_TABLES = [
    "DELETE FROM journaux_exercices WHERE journal_seance_id IN (SELECT id FROM journaux_seances WHERE utilisateur_id = :u)",
    "DELETE FROM journaux_seances WHERE utilisateur_id = :u",
    f"DELETE FROM exercices_seance WHERE seance_id IN ({_U_SEANCES})",
    f"DELETE FROM seances_entrainement WHERE id IN ({_U_SEANCES})",
    f"DELETE FROM resultats_demi_cooper WHERE evaluation_id IN ({_U_EVALS})",
    f"DELETE FROM resultats_max_1min WHERE evaluation_id IN ({_U_EVALS})",
    f"DELETE FROM resultats_amrap_benchmark WHERE evaluation_id IN ({_U_EVALS})",
    "DELETE FROM journaux_evaluation_seance WHERE utilisateur_id = :u",
    "DELETE FROM semaines_entrainement WHERE macrocycle_id IN (SELECT id FROM macrocycles WHERE utilisateur_id = :u)",
    "DELETE FROM macrocycles WHERE utilisateur_id = :u",
    "DELETE FROM biometries_utilisateurs WHERE utilisateur_id = :u",
    "DELETE FROM push_subscriptions WHERE utilisateur_id = :u",
    "DELETE FROM messages_chat_coach WHERE utilisateur_id = :u",
]


@router.delete("/api/utilisateur", summary="Supprime définitivement le compte et toutes les données associées")
def supprimer_compte(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    for sql in _PURGE_ANCIENNES_TABLES:
        try:
            with db.begin_nested():  # table absente (base récente) : on ignore
                db.execute(text(sql), {"u": current_user.id})
        except Exception:
            pass
    db.query(PoidsUtilisateur).filter_by(utilisateur_id=current_user.id).delete()
    db.query(MesureSante).filter_by(utilisateur_id=current_user.id).delete()
    db.query(SeancePrevue).filter_by(utilisateur_id=current_user.id).delete()
    db.query(ObjectifCourse).filter_by(utilisateur_id=current_user.id).delete()
    db.query(Activite).filter_by(utilisateur_id=current_user.id).delete()
    db.query(Objectif).filter_by(utilisateur_id=current_user.id).delete()
    db.delete(current_user)
    db.commit()
    return {"ok": True}
