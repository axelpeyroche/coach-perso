"""
Dépendances partagées entre les routers : hachage des mots de passe (PBKDF2)
et authentification JWT.
"""

from __future__ import annotations

import base64 as _b64
import hashlib
import hmac as _hmac
import logging
import os
import secrets as _secrets
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from database import obtenir_session
from models import Utilisateur

logger = logging.getLogger(__name__)

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 30  # 30 jours

SECRET_KEY = os.getenv("JWT_SECRET")
if not SECRET_KEY:
    # Pas de secret configuré : secret aléatoire pour ce process plutôt qu'une
    # valeur connue publiquement. Les tokens émis deviennent invalides à chaque
    # redémarrage tant que JWT_SECRET n'est pas défini.
    SECRET_KEY = _secrets.token_hex(32)
    print("⚠️  JWT_SECRET non défini — génération d'un secret temporaire pour ce process. "
          "Définis la variable d'environnement JWT_SECRET pour éviter la déconnexion de "
          "tous les utilisateurs à chaque redémarrage.")

http_bearer = HTTPBearer(auto_error=False)


def _hash_password(password: str) -> str:
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 260_000)
    return _b64.b64encode(salt + key).decode()


def _verify_password(plain: str, hashed: str) -> bool:
    try:
        data = _b64.b64decode(hashed.encode())
        salt, key = data[:16], data[16:]
        new_key = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt, 260_000)
        return _hmac.compare_digest(key, new_key)
    except Exception:
        logger.warning("Hash de mot de passe illisible/corrompu rencontré lors de la vérification")
        return False


def _create_token(user_id: int) -> str:
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": str(user_id), "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(http_bearer),
    db: Session = Depends(obtenir_session),
) -> Utilisateur:
    if not credentials:
        raise HTTPException(401, "Non authentifié")
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(401, "Token invalide")
    user = db.get(Utilisateur, user_id)
    if not user:
        raise HTTPException(401, "Utilisateur introuvable")
    return user
