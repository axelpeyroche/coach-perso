"""
Itinéraires : boucles ou aller simple proposés par BRouter (secours OpenRouteService),
à exporter en GPX.

La clé ORS (ORS_API_KEY) reste côté serveur ; le navigateur ne voit que les tracés.
"""
from __future__ import annotations

import json
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import itineraires_service as it
from database import obtenir_session
from deps import get_current_user, limiter
from models import Activite, ItineraireFavori, TraceGPS, Utilisateur

router = APIRouter()

Point = list[float]
Sport = Literal["course", "trail", "randonnee", "velo", "gravel", "vtt"]


class DemandeItineraire(BaseModel):
    sport: Sport = "course"
    depart: Point = Field(..., min_length=2, max_length=2, description="[lat, lon]")
    arrivee: Optional[Point] = Field(None, min_length=2, max_length=2)
    distance_km: Optional[float] = Field(None, gt=0.5, le=250)
    dplus_m: Optional[int] = Field(None, ge=0, le=8000)
    sentiers: bool = False
    eviter_routes: bool = False
    essai: int = Field(0, ge=0, le=20, description="0, puis 1, 2… pour d'autres propositions")
    rayon_km: float = Field(0, ge=0, le=15, description="Boucle : départ cherché jusqu'à cette distance, dans les chemins")


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
        return it.proposer(p.sport, p.depart, p.arrivee, p.distance_km, p.dplus_m, p.sentiers, p.eviter_routes, p.essai,
                           rayon_km=p.rayon_km)
    except it.ItineraireErreur as e:
        raise HTTPException(502, str(e))


def _verifier(points: list[Point]) -> None:
    for p in points:
        if len(p) < 2 or not (-90 <= p[0] <= 90 and -180 <= p[1] <= 180):
            raise HTTPException(422, "Coordonnées invalides")


class DemandeTrace(BaseModel):
    sport: Sport = "course"
    points: list[Point] = Field(..., min_length=2, max_length=40, description="[[lat, lon], …] dans l'ordre de passage")
    sentiers: bool = False


@router.post("/api/itineraires/trace", summary="Tracé passant par des points choisis (retouche à la main)")
def tracer(p: DemandeTrace, current_user: Utilisateur = Depends(get_current_user)):
    _verifier(p.points)
    # Un calcul par retouche : on laisse de la marge pour corriger plusieurs fois de suite
    limiter(f"itineraires-trace:{current_user.id}", 40, 60)
    try:
        return it.tracer(p.sport, [x[:2] for x in p.points], p.sentiers)
    except it.ItineraireErreur as e:
        raise HTTPException(502, str(e))


class DemandeDroite(BaseModel):
    points: list[Point] = Field(..., min_length=2, max_length=2, description="[[lat, lon], [lat, lon]]")


@router.post("/api/itineraires/droite", summary="Tronçon en ligne droite, hors des chemins (création à la main)")
def ligne_droite(p: DemandeDroite, current_user: Utilisateur = Depends(get_current_user)):
    _verifier(p.points)
    a, b = p.points[0][:2], p.points[1][:2]
    if it._dist_ll(a, b) > 20000:
        raise HTTPException(422, "Ligne droite limitée à 20 km : ajoute des points intermédiaires.")
    # Une seule demande d'altitudes par tronçon ; le service public accepte environ un appel par seconde
    limiter(f"itineraires-droite:{current_user.id}", 30, 60)
    return it.ligne_droite(a, b)


@router.get("/api/itineraires/sorties", summary="Dernières séances avec un tracé GPS (point de départ d'un parcours)")
def sorties(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    q = (db.query(Activite, TraceGPS.distance_km, TraceGPS.dplus_m)
         .join(TraceGPS, TraceGPS.activite_id == Activite.id)
         .filter(Activite.utilisateur_id == current_user.id)
         .order_by(Activite.debut.desc()).limit(40))
    return [{"id": a.id, "date": a.debut.date().isoformat(), "titre": a.titre, "sport": a.sport,
             "distance_km": round(d, 2) if d is not None else a.distance_km, "dplus_m": dp} for a, d, dp in q]


@router.get("/api/itineraires/allures", summary="Allure habituelle par sport (temps estimé des parcours)")
def allures(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    return it.allures(db, current_user.id)


# ── Parcours enregistrés ──

class FavoriSchema(BaseModel):
    nom: str = Field(..., min_length=1, max_length=120)
    sport: Sport
    boucle: bool = True
    distance_km: float = Field(..., ge=0, le=500)
    dplus_m: int = Field(..., ge=0, le=20000)
    points: list[list[Optional[float]]] = Field(..., min_length=2, max_length=20000)
    terrains: list[list] = Field(default_factory=list, max_length=5000)
    repartition: Optional[dict] = None
    etapes: list[int] = Field(default_factory=list, max_length=100)
    depart: Optional[Point] = None


class RenommerSchema(BaseModel):
    nom: str = Field(..., min_length=1, max_length=120)


def _resume(f: ItineraireFavori) -> dict:
    return {"id": f.id, "nom": f.nom, "sport": f.sport, "boucle": f.boucle, "distance_km": f.distance_km,
            "dplus_m": f.dplus_m, "maj_le": f.maj_le.isoformat() if f.maj_le else None}


def _favori(db: Session, user: Utilisateur, favori_id: int) -> ItineraireFavori:
    f = db.get(ItineraireFavori, favori_id)
    if not f or f.utilisateur_id != user.id:
        raise HTTPException(404, "Parcours introuvable")
    return f


def _remplir(f: ItineraireFavori, p: FavoriSchema) -> None:
    _verifier([x for x in p.points if x[0] is not None and x[1] is not None])
    f.nom, f.sport, f.boucle = p.nom.strip(), p.sport, p.boucle
    f.distance_km, f.dplus_m = round(p.distance_km, 2), p.dplus_m
    f.donnees = json.dumps({"points": p.points, "terrains": p.terrains, "repartition": p.repartition,
                            "etapes": p.etapes, "depart": p.depart}, separators=(",", ":"))


@router.get("/api/itineraires/favoris", summary="Parcours enregistrés (sans les tracés)")
def lister_favoris(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    q = (db.query(ItineraireFavori).filter(ItineraireFavori.utilisateur_id == current_user.id)
         .order_by(ItineraireFavori.maj_le.desc(), ItineraireFavori.id.desc()))
    return [_resume(f) for f in q]


@router.get("/api/itineraires/favoris/{favori_id}", summary="Parcours enregistré avec son tracé")
def detail_favori(favori_id: int, current_user: Utilisateur = Depends(get_current_user),
                  db: Session = Depends(obtenir_session)):
    f = _favori(db, current_user, favori_id)
    return {**_resume(f), **json.loads(f.donnees)}


@router.post("/api/itineraires/favoris", summary="Enregistre un parcours")
def creer_favori(p: FavoriSchema, current_user: Utilisateur = Depends(get_current_user),
                 db: Session = Depends(obtenir_session)):
    if db.query(ItineraireFavori).filter(ItineraireFavori.utilisateur_id == current_user.id).count() >= 200:
        raise HTTPException(422, "200 parcours enregistrés au maximum : supprime-en quelques-uns.")
    f = ItineraireFavori(utilisateur_id=current_user.id)
    _remplir(f, p)
    db.add(f)
    db.commit()
    db.refresh(f)
    return _resume(f)


@router.put("/api/itineraires/favoris/{favori_id}", summary="Remplace le tracé d'un parcours enregistré")
def modifier_favori(favori_id: int, p: FavoriSchema, current_user: Utilisateur = Depends(get_current_user),
                    db: Session = Depends(obtenir_session)):
    f = _favori(db, current_user, favori_id)
    _remplir(f, p)
    db.commit()
    db.refresh(f)
    return _resume(f)


@router.patch("/api/itineraires/favoris/{favori_id}", summary="Renomme un parcours enregistré")
def renommer_favori(favori_id: int, p: RenommerSchema, current_user: Utilisateur = Depends(get_current_user),
                    db: Session = Depends(obtenir_session)):
    f = _favori(db, current_user, favori_id)
    f.nom = p.nom.strip()
    db.commit()
    db.refresh(f)
    return _resume(f)


@router.delete("/api/itineraires/favoris/{favori_id}", summary="Supprime un parcours enregistré")
def supprimer_favori(favori_id: int, current_user: Utilisateur = Depends(get_current_user),
                     db: Session = Depends(obtenir_session)):
    db.delete(_favori(db, current_user, favori_id))
    db.commit()
    return {"ok": True}
