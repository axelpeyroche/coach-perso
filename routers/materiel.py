"""
Segments personnels et sorties sur le même parcours.
"""
from __future__ import annotations

import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import parcours_service as ps
from database import obtenir_session
from deps import get_current_user, limiter
from models import Activite, Segment, TraceGPS, Utilisateur

router = APIRouter()


def _activite(db: Session, user: Utilisateur, activite_id: int) -> Activite:
    a = db.query(Activite).filter(Activite.id == activite_id, Activite.utilisateur_id == user.id).first()
    if not a:
        raise HTTPException(404, "Activité introuvable")
    return a


# ---------------------------------------------------------------------------
# Segments
# ---------------------------------------------------------------------------

class SegmentSchema(BaseModel):
    activite_id: int
    debut_km: float = Field(..., ge=0)
    fin_km: float = Field(..., gt=0)
    nom: str = Field(..., min_length=1, max_length=120)


@router.get("/api/segments", summary="Segments, avec le meilleur temps et le nombre de passages")
def lister_segments(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    segments = db.query(Segment).filter(Segment.utilisateur_id == current_user.id).order_by(Segment.nom).all()
    if not segments:
        return []
    limiter(f"segments:{current_user.id}", 20, 60)
    tous = ps.tous_les_passages(db, current_user.id)
    return [ps.resume_segment(s, tous.get(s.id) or []) for s in segments]


@router.post("/api/segments", summary="Crée un segment à partir d'une portion du tracé d'une séance")
def creer_segment(payload: SegmentSchema, current_user: Utilisateur = Depends(get_current_user),
                  db: Session = Depends(obtenir_session)):
    a = _activite(db, current_user, payload.activite_id)
    t = db.query(TraceGPS).filter(TraceGPS.activite_id == a.id).first()
    if not t:
        raise HTTPException(400, "Pas de tracé pour cette séance")
    if db.query(Segment).filter(Segment.utilisateur_id == current_user.id).count() >= 200:
        raise HTTPException(400, "Trop de segments enregistrés")
    pts = ps.reechantillonner(ps.portion(json.loads(t.points), payload.debut_km, payload.fin_km), ps.PAS_SEGMENT)
    longueur = (len(pts) - 1) * ps.PAS_SEGMENT if len(pts) > 1 else 0
    if longueur < ps.SEGMENT_MIN_M or longueur > ps.SEGMENT_MAX_M:
        raise HTTPException(400, f"Un segment fait entre {ps.SEGMENT_MIN_M} m et {ps.SEGMENT_MAX_M // 1000} km")
    s = Segment(utilisateur_id=current_user.id, nom=payload.nom.strip(), sport=a.sport,
                distance_m=float(longueur), dplus_m=ps.denivele(pts), points=json.dumps(pts, separators=(",", ":")),
                activite_id=a.id)
    db.add(s)
    db.commit()
    return {"ok": True, "id": s.id}


@router.get("/api/segments/{sid}", summary="Détail d'un segment et tous ses passages")
def detail_segment(sid: int, current_user: Utilisateur = Depends(get_current_user),
                   db: Session = Depends(obtenir_session)):
    s = db.query(Segment).filter(Segment.id == sid, Segment.utilisateur_id == current_user.id).first()
    if not s:
        raise HTTPException(404, "Segment introuvable")
    limiter(f"segments:{current_user.id}", 20, 60)
    pas = ps.tous_les_passages(db, current_user.id).get(s.id) or []
    return {**ps.resume_segment(s, pas), "passages": pas,
            "points": [[p[0], p[1]] for p in json.loads(s.points)]}


class RenommerSegment(BaseModel):
    nom: str = Field(..., min_length=1, max_length=120)


@router.put("/api/segments/{sid}", summary="Renomme un segment")
def renommer_segment(sid: int, payload: RenommerSegment, current_user: Utilisateur = Depends(get_current_user),
                     db: Session = Depends(obtenir_session)):
    s = db.query(Segment).filter(Segment.id == sid, Segment.utilisateur_id == current_user.id).first()
    if not s:
        raise HTTPException(404, "Segment introuvable")
    s.nom = payload.nom.strip()
    db.commit()
    return {"ok": True}


@router.delete("/api/segments/{sid}", summary="Supprime un segment (les séances ne changent pas)")
def supprimer_segment(sid: int, current_user: Utilisateur = Depends(get_current_user),
                      db: Session = Depends(obtenir_session)):
    s = db.query(Segment).filter(Segment.id == sid, Segment.utilisateur_id == current_user.id).first()
    if not s:
        raise HTTPException(404, "Segment introuvable")
    db.delete(s)
    db.commit()
    ps.oublier(current_user.id)
    return {"ok": True}


@router.get("/api/activites/{activite_id}/segments", summary="Segments parcourus pendant une séance")
def segments_activite(activite_id: int, current_user: Utilisateur = Depends(get_current_user),
                      db: Session = Depends(obtenir_session)):
    a = _activite(db, current_user, activite_id)
    limiter(f"segments:{current_user.id}", 20, 60)
    return ps.segments_de_activite(db, current_user.id, a)


# ---------------------------------------------------------------------------
# Même parcours
# ---------------------------------------------------------------------------

@router.get("/api/activites/{activite_id}/meme-parcours", summary="Sorties sur le même parcours")
def meme_parcours(activite_id: int, current_user: Utilisateur = Depends(get_current_user),
                  db: Session = Depends(obtenir_session)):
    a = _activite(db, current_user, activite_id)
    limiter(f"meme-parcours:{current_user.id}", 30, 60)
    return ps.meme_parcours(db, current_user.id, a)
