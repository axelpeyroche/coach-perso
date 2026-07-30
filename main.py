"""
API FastAPI — Coach d'Entraînement Hybride EPC.

Point d'entrée de l'application : création de l'app, middleware CORS, gestion
d'erreur globale, démarrage (création des tables + scheduler de notifications)
et montage des routers par domaine (voir le dossier `routers/`).
"""

from __future__ import annotations

from datetime import datetime

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

import deps
from routers import (
    admin,
    analytics,
    auth,
    evaluations,
    import_ios,
    journal,
    objectif_course,
    programme,
    push,
    seances,
    utilisateur,
)

app = FastAPI(
    title="Coach EPC — API",
    description="API du coach d'entraînement hybride Course & Musculation au poids du corps.",
    version="1.0.0",
)

_ALLOWED_ORIGINS = [
    "https://coach-perso-frontend.onrender.com",
    "http://localhost:5173",
    "http://localhost:4173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.on_event("startup")
def demarrage():
    deps.demarrage()


app.include_router(auth.router)
app.include_router(utilisateur.router)
app.include_router(evaluations.router)
app.include_router(journal.router)
app.include_router(push.router)
app.include_router(analytics.router)
app.include_router(programme.router)
app.include_router(seances.router)
app.include_router(admin.router)
app.include_router(objectif_course.router)
app.include_router(import_ios.router)


# ---------------------------------------------------------------------------
# Santé
# ---------------------------------------------------------------------------

@app.get("/", include_in_schema=False)
def racine():
    return {"statut": "Coach EPC opérationnel", "docs": "/docs"}


@app.get("/health", include_in_schema=False)
def sante():
    return {"statut": "ok", "timestamp": datetime.utcnow().isoformat()}
