"""Routes d'authentification : register / login / me / token d'import."""

from __future__ import annotations

import secrets as _secrets
from datetime import date
from typing import Optional
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import obtenir_session
from models import Utilisateur
from deps import (
    get_current_user,
    _hash_password,
    _verify_password,
    _create_token,
)

logger = logging.getLogger(__name__)
router = APIRouter()

class RegisterSchema(BaseModel):
    email: str
    password: str
    prenom: str
    nom: str
    sexe: Optional[str] = None
    date_naissance: Optional[str] = None  # "YYYY-MM-DD"
    poids_kg: Optional[float] = None

class LoginSchema(BaseModel):
    email: str
    password: str

@router.post("/api/auth/register", summary="Crée un nouveau compte")
def register(payload: RegisterSchema, db: Session = Depends(obtenir_session)):
    if db.query(Utilisateur).filter(Utilisateur.email == payload.email).first():
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
            email=payload.email,
            password_hash=password_hash,
            prenom=payload.prenom,
            nom=payload.nom,
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
    token = _create_token(user.id)
    return {"access_token": token, "token_type": "bearer", "user_id": user.id}


@router.post("/api/auth/login", summary="Authentifie et retourne un token JWT")
def login(payload: LoginSchema, db: Session = Depends(obtenir_session)):
    user = db.query(Utilisateur).filter(Utilisateur.email == payload.email).first()
    if not user or not user.password_hash or not _verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Email ou mot de passe incorrect")
    token = _create_token(user.id)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": user.id,
    }


@router.get("/api/auth/me", summary="Retourne le profil de l'utilisateur connecté")
def me(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
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
