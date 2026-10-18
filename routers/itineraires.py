"""
Itinéraires : boucles ou aller simple proposés par BRouter (secours OpenRouteService),
à exporter en GPX.

La clé ORS (ORS_API_KEY) reste côté serveur ; le navigateur ne voit que les tracés.
"""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import itineraires_service as it
from deps import get_current_user, limiter
from models import Utilisateur

router = APIRouter()

Point = list[float]


class DemandeItineraire(BaseModel):
    sport: Literal["course", "trail", "randonnee", "velo", "gravel", "vtt"] = "course"
    depart: Point = Field(..., min_length=2, max_length=2, description="[lat, lon]")
    arrivee: Optional[Point] = Field(None, min_length=2, max_length=2)
    distance_km: Optional[float] = Field(None, gt=0.5, le=250)
    dplus_m: Optional[int] = Field(None, ge=0, le=8000)
    sentiers: bool = False
    eviter_routes: bool = False
    essai: int = Field(0, ge=0, le=20, description="0, puis 1, 2… pour d'autres propositions")


@router.get("/api/itineraires", summary="Le calcul d'itinéraires est-il disponible ?")
def statut(current_user: Utilisateur = Depends(get_current_user)):
    return {"disponible": True}  # BRouter ne demande pas de clé


@router.post("/api/itineraires", summary="Proposer des itinéraires (boucle ou A → B)")
def proposer(p: DemandeItineraire, current_user: Utilisateur = Depends(get_current_user)):
    for lat, lon in [p.depart] + ([p.arrivee] if p.arrivee else []):
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise HTTPException(422, "Coordonnées invalides")
    pied = p.sport in ("course", "trail", "randonnee")
    if p.distance_km and pied and p.distance_km > 80:
        raise HTTPException(422, "Boucle à pied limitée à 80 km")
    # Une recherche de boucle coûte six calculs sur un serveur public partagé
    limiter(f"itineraires:{current_user.id}", 5, 60)
    try:
        return it.proposer(p.sport, p.depart, p.arrivee, p.distance_km, p.dplus_m, p.sentiers, p.eviter_routes, p.essai)
    except it.ItineraireErreur as e:
        raise HTTPException(502, str(e))
