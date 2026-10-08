"""
Dépendances partagées entre les routers : hachage des mots de passe (PBKDF2),
authentification JWT, validation des identifiants et limitation des tentatives.
"""

from __future__ import annotations

import base64 as _b64
import hashlib
import hmac as _hmac
import logging
import os
import re
import secrets as _secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
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


def _empreinte(password_hash: Optional[str]) -> str:
    """Empreinte du mot de passe glissée dans le JWT : changer de mot de passe invalide les anciennes sessions."""
    return _hmac.new(SECRET_KEY.encode(), (password_hash or "").encode(), hashlib.sha256).hexdigest()[:16]


def _create_token(user: Utilisateur) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": str(user.id), "pw": _empreinte(user.password_hash), "exp": expire},
                      SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(http_bearer),
    db: Session = Depends(obtenir_session),
) -> Utilisateur:
    if not credentials:
        raise HTTPException(401, "Non authentifié")
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM],
                             options={"require": ["sub", "exp", "pw"]})
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(401, "Session expirée, reconnecte-toi")
    user = db.get(Utilisateur, user_id)
    if not user or not user.password_hash or not _hmac.compare_digest(payload["pw"], _empreinte(user.password_hash)):
        raise HTTPException(401, "Session expirée, reconnecte-toi")
    return user


# ---------------------------------------------------------------------------
# Validation des identifiants
# ---------------------------------------------------------------------------

_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")


def normaliser_email(email: str) -> str:
    e = (email or "").strip().lower()
    if len(e) > 254 or not _EMAIL.match(e):
        raise HTTPException(400, "Adresse e-mail invalide")
    return e


def verifier_mot_de_passe_robuste(mdp: str) -> None:
    if len(mdp or "") < 8:
        raise HTTPException(400, "Mot de passe trop court : 8 caractères minimum")
    if len(mdp) > 128:
        raise HTTPException(400, "Mot de passe trop long : 128 caractères maximum")


# ---------------------------------------------------------------------------
# Limitation des tentatives (en mémoire : une seule instance sur Render)
# ---------------------------------------------------------------------------

_tentatives: dict[str, deque] = defaultdict(deque)
_verrou = threading.Lock()


def ip_client(request: Request) -> str:
    # Derrière le proxy de Render : la dernière adresse ajoutée est celle vue par le proxy
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[-1].strip() if fwd else (request.client.host if request.client else "?")


def limiter(cle: str, maximum: int, fenetre_s: int, compter: bool = True) -> None:
    """Lève une 429 si `cle` a déjà atteint `maximum` événements dans la fenêtre ; sinon en compte un."""
    maintenant = time.monotonic()
    with _verrou:
        q = _tentatives[cle]
        while q and maintenant - q[0] > fenetre_s:
            q.popleft()
        if len(q) >= maximum:
            attente = int(fenetre_s - (maintenant - q[0])) // 60 + 1
            raise HTTPException(429, f"Trop de tentatives : réessaie dans {attente} min")
        if compter:
            q.append(maintenant)
        if len(_tentatives) > 10_000:  # purge des clés inactives
            for k in [k for k, v in _tentatives.items() if not v]:
                del _tentatives[k]


def compter_echec(cle: str) -> None:
    with _verrou:
        _tentatives[cle].append(time.monotonic())
