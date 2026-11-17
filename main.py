"""
API FastAPI — Mon Carnet, suivi multi-sport.

Point d'entrée de l'application : création de l'app, middleware CORS, gestion
d'erreur globale et montage des routers par domaine (voir `routers/`).
La création des tables est faite par `startup.py` avant le lancement d'uvicorn.
"""

from __future__ import annotations

from datetime import datetime

import html
import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response

import jwt

import formulation
from deps import ALGORITHM, SECRET_KEY

logger = logging.getLogger(__name__)

from routers import admin, auth, carnet, coaching, corps, intervals, itineraires, materiel, plan, qualite, suivi, utilisateur

app = FastAPI(
    title="Mon Carnet — API",
    description="API du carnet de suivi multi-sport (séances, imports, objectifs, statistiques).",
    version="2.0.0",
)

# Hébergement tout-en-un (Koyeb) : l'API sert aussi l'interface construite (frontend/dist),
# à la même adresse. Activé seulement si DOSSIER_INTERFACE pointe vers ce dossier (voir Dockerfile).
_DIST = Path(os.getenv("DOSSIER_INTERFACE", "")).resolve() if os.getenv("DOSSIER_INTERFACE") else None
if _DIST is not None and not (_DIST / "index.html").is_file():
    logger.warning("DOSSIER_INTERFACE=%s sans index.html : interface non servie", _DIST)
    _DIST = None
_HORS_INTERFACE = ("/health", "/docs", "/redoc", "/openapi.json")


def _chemin_interface(chemin: str) -> bool:
    return _DIST is not None and not chemin.startswith("/api/") and chemin != "/api" and chemin not in _HORS_INTERFACE


_ALLOWED_ORIGINS = [
    "https://coach-perso-frontend.onrender.com",
    "http://localhost:5173",
    "http://localhost:4173",
]

# Comptes invités : formulations grand public des messages de forme (voir formulation.py).
# Ajouté avant GZip pour lire la réponse non compressée.
@app.middleware("http")
async def _formulations_grand_public(request: Request, call_next):
    reponse = await call_next(request)
    if not request.url.path.startswith("/api/") or "json" not in reponse.headers.get("content-type", ""):
        return reponse
    uid = _utilisateur_du_jeton(request)
    if uid is None or formulation.compte_admin(uid):
        return reponse
    corps = b"".join([c async for c in reponse.body_iterator])
    if formulation.a_reformuler(corps):
        try:
            corps = formulation.reformuler_json(corps)
        except ValueError:
            pass
    entetes = {k: v for k, v in reponse.headers.items() if k.lower() != "content-length"}
    return Response(content=corps, status_code=reponse.status_code, headers=entetes, media_type=reponse.media_type)


def _utilisateur_du_jeton(request: Request):
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    try:
        return int(jwt.decode(auth[7:], SECRET_KEY, algorithms=[ALGORITHM])["sub"])
    except Exception:
        return None  # jeton d'import / Claude ou invalide : la route décide


app.add_middleware(GZipMiddleware, minimum_size=2000)  # la carte des tracés pèse ~1 Mo en JSON
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# En-têtes de sécurité sur toutes les réponses de l'API (données personnelles : jamais mises en cache)
_ENTETES_SECURITE = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


# Pages de l'interface : leur politique de contenu est dans index.html (balise meta, voir vite.config.js)
_ENTETES_INTERFACE = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy": "frame-ancestors 'none'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


@app.middleware("http")
async def _entetes_securite(request: Request, call_next):
    reponse = await call_next(request)
    entetes = _ENTETES_INTERFACE if _chemin_interface(request.url.path) else _ENTETES_SECURITE
    for k, v in entetes.items():
        reponse.headers.setdefault(k, v)
    if request.url.path.startswith("/api/"):
        reponse.headers["Cache-Control"] = "no-store"
    elif request.url.path in ("/docs", "/redoc"):
        del reponse.headers["Content-Security-Policy"]  # la page de doc charge ses scripts depuis un CDN
    return reponse


@app.exception_handler(RequestValidationError)
async def _handler_validation(request: Request, exc: RequestValidationError):
    """Le raccourci iOS n'affiche rien d'une réponse 422 : pour l'import, on renvoie 200 avec la cause."""
    if request.url.path == "/api/activites/import":
        e = (exc.errors() or [{}])[0]
        lieu = ".".join(str(x) for x in e.get("loc", ()) if x != "body")
        recu = repr(e.get("input"))[:80] if e.get("type") != "missing" else ""
        return JSONResponse({"ok": False, "message": f"Requête refusée : {e.get('msg', 'invalide')}"
                             + (f" (champ {lieu})" if lieu else "") + (f" — reçu {recu}" if recu else "")})
    return await request_validation_exception_handler(request, exc)


@app.exception_handler(Exception)
async def _handler_exception_global(request: Request, exc: Exception):
    """
    Filet de sécurité : une exception non gérée renvoyée par ServerErrorMiddleware
    (en dehors du middleware CORS) apparaît comme "Network error" côté navigateur.
    On renvoie ici un JSON 500 AVEC les en-têtes CORS pour que le message d'erreur
    réel soit lisible dans l'interface.
    """
    logger.exception("Exception non gérée")
    origin = request.headers.get("origin")
    headers = {}
    if origin in _ALLOWED_ORIGINS:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    return JSONResponse(
        status_code=500,
        content={"detail": "Erreur serveur interne"},
        headers=headers,
    )


app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(utilisateur.router)
app.include_router(carnet.router)
app.include_router(plan.router)
app.include_router(intervals.router)
app.include_router(suivi.router)
app.include_router(itineraires.router)
app.include_router(materiel.router)
app.include_router(corps.router)
app.include_router(coaching.router)
app.include_router(qualite.router)


# ---------------------------------------------------------------------------
# Santé
# ---------------------------------------------------------------------------

@app.get("/", include_in_schema=False)
def racine():
    if _DIST is not None:
        return _page_interface()
    return {"statut": "Mon Carnet opérationnel", "docs": "/docs"}


@app.api_route("/health", methods=["GET", "HEAD"], include_in_schema=False)  # HEAD : moniteurs (UptimeRobot)
def sante():
    return {"statut": "ok", "timestamp": datetime.utcnow().isoformat()}


# ---------------------------------------------------------------------------
# Interface (hébergement tout-en-un seulement, voir _DIST)
# ---------------------------------------------------------------------------

def _index_html() -> str:
    page = (_DIST / "index.html").read_text(encoding="utf-8")
    # Identifiant (public) de l'app Spotify : lu au démarrage plutôt qu'au build de l'interface
    spotify = os.getenv("SPOTIFY_CLIENT_ID", "").strip()
    if spotify:
        page = page.replace("<head>", '<head>\n    <meta name="spotify-client-id" content="' + html.escape(spotify) + '" />', 1)
    return page


_INDEX = _index_html() if _DIST is not None else ""


def _page_interface():
    return HTMLResponse(_INDEX, headers={"Cache-Control": "no-cache"})


if _DIST is not None:
    @app.api_route("/{chemin:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def interface(chemin: str):
        if chemin == "api" or chemin.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        fichier = (_DIST / chemin).resolve()
        if chemin and fichier.is_file() and _DIST in fichier.parents:
            if chemin.startswith("assets/"):  # noms avec empreinte : jamais modifiés
                cache = "public, max-age=31536000, immutable"
            elif chemin in ("sw.js", "manifest.json", "index.html"):
                cache = "no-cache"
            else:
                cache = "public, max-age=86400"
            return FileResponse(fichier, headers={"Cache-Control": cache})
        return _page_interface()  # routes de l'application (React Router)
