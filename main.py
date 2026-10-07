"""
API FastAPI — Carnet de suivi multi-sport.

Point d'entrée de l'application : création de l'app, middleware CORS, gestion
d'erreur globale et montage des routers par domaine (voir `routers/`).
La création des tables est faite par `startup.py` avant le lancement d'uvicorn.
"""

from __future__ import annotations

from datetime import datetime

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

from routers import auth, carnet, plan, utilisateur

app = FastAPI(
    title="Carnet — API",
    description="API du carnet de suivi multi-sport (séances, imports, objectifs, statistiques).",
    version="2.0.0",
)

_ALLOWED_ORIGINS = [
    "https://coach-perso-frontend.onrender.com",
    "http://localhost:5173",
    "http://localhost:4173",
]

app.add_middleware(GZipMiddleware, minimum_size=2000)  # la carte des tracés pèse ~1 Mo en JSON
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
app.include_router(utilisateur.router)
app.include_router(carnet.router)
app.include_router(plan.router)


# ---------------------------------------------------------------------------
# Santé
# ---------------------------------------------------------------------------

@app.get("/", include_in_schema=False)
def racine():
    return {"statut": "Carnet opérationnel", "docs": "/docs"}


@app.get("/health", include_in_schema=False)
def sante():
    return {"statut": "ok", "timestamp": datetime.utcnow().isoformat()}
