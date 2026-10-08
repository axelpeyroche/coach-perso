"""Routes d'authentification : register / login / me / token d'import."""

from __future__ import annotations

import os
import secrets as _secrets
from datetime import date
from typing import Optional
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import obtenir_session
from carnet_service import synchroniser_physiologie
from models import Utilisateur
from deps import (
    get_current_user,
    _hash_password,
    _verify_password,
    _create_token,
    compter_echec,
    ip_client,
    limiter,
    normaliser_email,
    verifier_mot_de_passe_robuste,
)

logger = logging.getLogger(__name__)
router = APIRouter()

class RegisterSchema(BaseModel):
    email: str = Field(..., max_length=254)
    password: str = Field(..., max_length=128)
    prenom: str = Field(..., min_length=1, max_length=60)
    nom: str = Field(..., min_length=1, max_length=60)
    sexe: Optional[str] = Field(None, max_length=10)
    date_naissance: Optional[str] = Field(None, max_length=10)  # "YYYY-MM-DD"
    poids_kg: Optional[float] = Field(None, gt=0, lt=400)

class LoginSchema(BaseModel):
    email: str = Field(..., max_length=254)
    password: str = Field(..., max_length=128)


# Mettre INSCRIPTIONS_FERMEES=1 sur Render pour empêcher la création de nouveaux comptes
INSCRIPTIONS_FERMEES = os.getenv("INSCRIPTIONS_FERMEES", "").strip().lower() in ("1", "true", "oui", "yes")


@router.post("/api/auth/register", summary="Crée un nouveau compte")
def register(payload: RegisterSchema, request: Request, db: Session = Depends(obtenir_session)):
    if INSCRIPTIONS_FERMEES:
        raise HTTPException(403, "Les inscriptions sont fermées")
    limiter(f"inscription:{ip_client(request)}", 5, 3600)
    email = normaliser_email(payload.email)
    verifier_mot_de_passe_robuste(payload.password)
    if not payload.prenom.strip() or not payload.nom.strip():
        raise HTTPException(400, "Prénom et nom obligatoires")
    if db.query(Utilisateur).filter(func.lower(Utilisateur.email) == email).first():
        raise HTTPException(400, "Un compte existe déjà avec cet email")
    dn = None
    if payload.date_naissance:
        try:
            dn = date.fromisoformat(payload.date_naissance)
        except ValueError:
            raise HTTPException(400, "Format date_naissance invalide — attendu YYYY-MM-DD")
    try:
        password_hash = _hash_password(payload.password)
    except Exception:
        logger.exception("Erreur hachage mot de passe")
        raise HTTPException(500, "Erreur lors de la création du compte")
    try:
        user = Utilisateur(
            email=email,
            password_hash=password_hash,
            prenom=payload.prenom.strip(),
            nom=payload.nom.strip(),
            sexe=payload.sexe,
            date_naissance=dn,
            poids_kg=payload.poids_kg,
            onboarding_complet=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    except Exception:
        db.rollback()
        logger.exception("Erreur base de données lors de la création du compte")
        raise HTTPException(500, "Erreur lors de la création du compte")
    token = _create_token(user)
    return {"access_token": token, "token_type": "bearer", "user_id": user.id}


@router.post("/api/auth/login", summary="Authentifie et retourne un token JWT")
def login(payload: LoginSchema, request: Request, db: Session = Depends(obtenir_session)):
    email = (payload.email or "").strip().lower()
    cle_email, cle_ip = f"login:{email}", f"login-ip:{ip_client(request)}"
    # Anti force brute : 8 échecs / 15 min par compte, 30 / 15 min par adresse IP
    limiter(cle_email, 8, 900, compter=False)
    limiter(cle_ip, 30, 900, compter=False)
    user = db.query(Utilisateur).filter(func.lower(Utilisateur.email) == email).first()
    if not user or not user.password_hash or not _verify_password(payload.password, user.password_hash):
        compter_echec(cle_email)
        compter_echec(cle_ip)
        raise HTTPException(401, "Email ou mot de passe incorrect")
    token = _create_token(user)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": user.id,
    }


@router.get("/api/auth/me", summary="Retourne le profil de l'utilisateur connecté")
def me(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    # FC max / FC repos déduites des séances et mesures santé importées
    auto = synchroniser_physiologie(db, current_user)
    dn = current_user.date_naissance
    age = None
    if dn:
        today = date.today()
        age = today.year - dn.year - ((today.month, today.day) < (dn.month, dn.day))
    return {
        "id": current_user.id,
        "email": current_user.email,
        "prenom": current_user.prenom,
        "nom": current_user.nom,
        "sexe": current_user.sexe,
        "date_naissance": str(dn) if dn else None,
        "age": age,
        "poids_kg": current_user.poids_kg,
        "photo_url": current_user.photo_url,
        "fuseau_horaire": current_user.fuseau_horaire,
        "fc_max": current_user.fc_max,
        "fc_repos": current_user.fc_repos,
        # Valeurs effectivement calculées (None = pas de donnée, valeur du profil conservée)
        "fc_max_auto": auto["fc_max"] is not None,
        "fc_repos_auto": auto["fc_repos"] is not None,
        "fc_repos_nb_jours": auto["nb_jours_fc_repos"],
    }


@router.get("/api/auth/import-token", summary="Retourne (et génère si besoin) le token d'import du raccourci iOS")
def get_import_token(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    if not current_user.import_token:
        current_user.import_token = _secrets.token_urlsafe(32)
        db.commit()
    return {"import_token": current_user.import_token}


@router.post("/api/auth/import-token/regenerer", summary="Régénère le token d'import")
def regenerer_import_token(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    current_user.import_token = _secrets.token_urlsafe(32)
    db.commit()
    return {"import_token": current_user.import_token}
