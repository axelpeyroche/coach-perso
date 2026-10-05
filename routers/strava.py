"""
Connexion Strava (OAuth 2) et synchronisation des activités dans le carnet.

Configuration : variables d'environnement STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET,
FRONTEND_URL (redirection après connexion) et, optionnellement, API_PUBLIC_URL
(URL publique de l'API, sinon déduite de la requête).
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error as _urlerror
import urllib.parse as _urlparse
import urllib.request as _urlrequest
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt
from sqlalchemy.orm import Session

import carnet_service as cs
from database import obtenir_session
from deps import ALGORITHM, SECRET_KEY, get_current_user
from models import Utilisateur

logger = logging.getLogger(__name__)
router = APIRouter()

_AUTH_URL = "https://www.strava.com/oauth/authorize"
_TOKEN_URL = "https://www.strava.com/oauth/token"
_API = "https://www.strava.com/api/v3"


def _config() -> tuple[str, str]:
    cid, secret = os.getenv("STRAVA_CLIENT_ID"), os.getenv("STRAVA_CLIENT_SECRET")
    if not cid or not secret:
        raise HTTPException(503, "Strava n'est pas configuré sur le serveur (STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET)")
    return cid, secret


def _http(url: str, data: dict | None = None, token: str | None = None):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = _urlparse.urlencode(data).encode() if data is not None else None
    req = _urlrequest.Request(url, data=body, headers=headers, method="POST" if body else "GET")
    try:
        with _urlrequest.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode())
    except _urlerror.HTTPError as e:
        detail = e.read().decode(errors="ignore")[:300]
        logger.warning("Strava HTTP %s sur %s : %s", e.code, url.split("?")[0], detail)
        if e.code == 429:
            raise HTTPException(429, "Limite d'appels Strava atteinte — réessaie dans 15 minutes")
        if e.code == 401:
            raise HTTPException(401, "Autorisation Strava refusée ou expirée — reconnecte Strava")
        raise HTTPException(502, f"Erreur Strava ({e.code})")
    except _urlerror.URLError as e:
        raise HTTPException(502, f"Strava injoignable : {e.reason}")


def _url_api(request: Request) -> str:
    base = os.getenv("API_PUBLIC_URL") or str(request.base_url)
    base = base.rstrip("/")
    if base.startswith("http://") and "localhost" not in base and "127.0.0.1" not in base:
        base = "https://" + base[len("http://"):]  # Render termine le TLS en amont
    return base


def _frontend() -> str:
    return (os.getenv("FRONTEND_URL") or "http://localhost:5173").rstrip("/")


def _enregistrer_tokens(user: Utilisateur, rep: dict) -> None:
    user.strava_access_token = rep["access_token"]
    user.strava_refresh_token = rep["refresh_token"]
    user.strava_expires_at = int(rep["expires_at"])
    athlete = rep.get("athlete") or {}
    if athlete.get("id"):
        user.strava_athlete_id = int(athlete["id"])


def _access_token(db: Session, user: Utilisateur) -> str:
    if not user.strava_refresh_token:
        raise HTTPException(400, "Strava n'est pas connecté")
    if user.strava_access_token and (user.strava_expires_at or 0) > time.time() + 120:
        return user.strava_access_token
    cid, secret = _config()
    rep = _http(_TOKEN_URL, {"client_id": cid, "client_secret": secret,
                             "grant_type": "refresh_token", "refresh_token": user.strava_refresh_token})
    _enregistrer_tokens(user, rep)
    db.commit()
    return user.strava_access_token


def _convertir(act: dict) -> dict:
    sport = cs.normaliser_sport(act.get("sport_type") or act.get("type"))
    debut = datetime.fromisoformat(act["start_date_local"].replace("Z", "")).replace(tzinfo=None)
    entier = lambda v: int(round(v)) if v else None
    details = {k: act.get(k) for k in ("sport_type", "average_speed", "max_speed", "average_watts",
                                        "weighted_average_watts", "average_cadence", "suffer_score",
                                        "elapsed_time", "kudos_count", "gear_id") if act.get(k) is not None}
    return {
        "sport": sport,
        "titre": act.get("name"),
        "debut": debut,
        "duree_sec": act.get("moving_time") or act.get("elapsed_time"),
        "distance_km": round(act["distance"] / 1000, 3) if act.get("distance") else None,
        "dplus_m": entier(act.get("total_elevation_gain")),
        "fc_moyenne_bpm": entier(act.get("average_heartrate")),
        "fc_max_bpm": entier(act.get("max_heartrate")),
        "calories": entier(act.get("calories") or (act.get("kilojoules") if sport == "velo" else None)),
        "est_competition": act.get("workout_type") in (1, 11),  # 1 = course (run), 11 = course (vélo)
        "details": details or None,
    }


@router.get("/api/strava/statut", summary="État de la connexion Strava")
def statut(current_user: Utilisateur = Depends(get_current_user)):
    return {
        "configure": bool(os.getenv("STRAVA_CLIENT_ID") and os.getenv("STRAVA_CLIENT_SECRET")),
        "connecte": bool(current_user.strava_refresh_token),
        "athlete_id": current_user.strava_athlete_id,
        "derniere_synchro": current_user.strava_derniere_synchro.isoformat() if current_user.strava_derniere_synchro else None,
    }


@router.get("/api/strava/connecter", summary="URL d'autorisation Strava")
def connecter(request: Request, current_user: Utilisateur = Depends(get_current_user)):
    cid, _ = _config()
    state = jwt.encode({"sub": str(current_user.id), "but": "strava",
                        "exp": datetime.utcnow() + timedelta(minutes=15)}, SECRET_KEY, algorithm=ALGORITHM)
    params = {
        "client_id": cid,
        "redirect_uri": f"{_url_api(request)}/api/strava/callback",
        "response_type": "code",
        "approval_prompt": "auto",
        "scope": "read,activity:read_all",
        "state": state,
    }
    return {"url": f"{_AUTH_URL}?{_urlparse.urlencode(params)}"}


@router.get("/api/strava/callback", include_in_schema=False)
def callback(
    state: str = Query(""),
    code: str | None = Query(None),
    error: str | None = Query(None),
    scope: str = Query(""),
    db: Session = Depends(obtenir_session),
):
    retour = f"{_frontend()}/sources"
    if error or not code:
        return RedirectResponse(f"{retour}?strava=refuse")
    try:
        payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("but") != "strava":
            raise JWTError("but invalide")
        user = db.get(Utilisateur, int(payload["sub"]))
    except (JWTError, KeyError, ValueError):
        return RedirectResponse(f"{retour}?strava=erreur")
    if not user:
        return RedirectResponse(f"{retour}?strava=erreur")
    if "activity:read" not in scope:
        return RedirectResponse(f"{retour}?strava=scope")
    cid, secret = _config()
    try:
        rep = _http(_TOKEN_URL, {"client_id": cid, "client_secret": secret,
                                 "code": code, "grant_type": "authorization_code"})
    except HTTPException:
        return RedirectResponse(f"{retour}?strava=erreur")
    _enregistrer_tokens(user, rep)
    db.commit()
    return RedirectResponse(f"{retour}?strava=ok")


@router.post("/api/strava/synchroniser", summary="Importe les activités Strava (nouvelles ou tout l'historique)")
def synchroniser(
    tout: bool = Query(False, description="Ré-importe tout l'historique au lieu des seules nouveautés"),
    page: int = Query(1, ge=1, description="Page de départ (reprise d'une synchro partielle)"),
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    token = _access_token(db, current_user)
    params = {"per_page": 100}
    if not tout and current_user.strava_derniere_synchro:
        # Marge de 2 jours : rattrape les activités envoyées en retard depuis la montre
        params["after"] = int((current_user.strava_derniere_synchro - timedelta(days=2))
                              .replace(tzinfo=timezone.utc).timestamp())
    bilan = {"cree": 0, "maj": 0, "fusion": 0, "inchange": 0}
    debut_synchro, page_suivante = time.time(), None
    while True:
        lot = _http(f"{_API}/athlete/activities?{_urlparse.urlencode({**params, 'page': page})}", token=token)
        for act in lot or []:
            _, s = cs.importer_activite(db, current_user.id, "strava", _convertir(act), id_externe=str(act["id"]))
            bilan[s] += 1
        db.commit()
        if not lot or len(lot) < params["per_page"]:
            break
        page += 1
        if time.time() - debut_synchro > 20:
            # Évite les timeouts HTTP sur un gros historique : le client relance avec `page`
            page_suivante = page
            break
    if page_suivante is None:
        current_user.strava_derniere_synchro = datetime.utcnow()
        db.commit()
    return {"ok": True, **bilan, "total": sum(bilan.values()), "page_suivante": page_suivante}


@router.delete("/api/strava", summary="Déconnecte Strava (les activités importées sont conservées)")
def deconnecter(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    if current_user.strava_access_token:
        try:
            _http("https://www.strava.com/oauth/deauthorize", {"access_token": current_user.strava_access_token})
        except HTTPException:
            pass
    current_user.strava_access_token = None
    current_user.strava_refresh_token = None
    current_user.strava_expires_at = None
    current_user.strava_athlete_id = None
    db.commit()
    return {"ok": True}
