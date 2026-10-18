"""
Matériel (usure des chaussures), segments personnels et sorties sur le même parcours.
"""
from __future__ import annotations

import json
from datetime import date
from typing import Optional, Union

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import carnet_service as cs
import materiel_service as ms
import parcours_service as ps
from database import obtenir_session
from deps import get_current_user, limiter
from models import Activite, Equipement, EquipementActivite, Segment, TraceGPS, Utilisateur

router = APIRouter()


def _activite(db: Session, user: Utilisateur, activite_id: int) -> Activite:
    a = db.query(Activite).filter(Activite.id == activite_id, Activite.utilisateur_id == user.id).first()
    if not a:
        raise HTTPException(404, "Activité introuvable")
    return a


# ---------------------------------------------------------------------------
# Matériel
# ---------------------------------------------------------------------------

class EquipementSchema(BaseModel):
    nom: str = Field(..., min_length=1, max_length=120)
    sports: list[str] = Field(default_factory=lambda: ["course"], max_length=10)
    par_defaut: bool = True
    mise_en_service: date
    km_initial: float = Field(0, ge=0, le=100_000)
    limite_km: Optional[int] = Field(700, ge=0, le=100_000)
    retire_le: Optional[date] = None
    notes: Optional[str] = Field(None, max_length=2000)


def _appliquer(e: Equipement, p: EquipementSchema) -> None:
    sports = [s for s in p.sports if s in cs.SPORTS]
    if not sports:
        raise HTTPException(400, "Choisir au moins un sport")
    if p.retire_le and p.retire_le < p.mise_en_service:
        raise HTTPException(400, "La date de retrait précède la mise en service")
    e.nom, e.sports, e.par_defaut = p.nom.strip(), ",".join(sports), p.par_defaut
    e.mise_en_service, e.km_initial, e.limite_km = p.mise_en_service, p.km_initial, p.limite_km or None
    e.retire_le, e.notes = p.retire_le, (p.notes or "").strip() or None


def _equipement(db: Session, user: Utilisateur, eid: int) -> Equipement:
    e = db.query(Equipement).filter(Equipement.id == eid, Equipement.utilisateur_id == user.id).first()
    if not e:
        raise HTTPException(404, "Matériel introuvable")
    return e


@router.get("/api/equipements", summary="Matériel et km parcourus avec chacun")
def lister_equipements(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    return ms.lister(db, current_user.id)


@router.post("/api/equipements", summary="Ajoute du matériel")
def creer_equipement(payload: EquipementSchema, current_user: Utilisateur = Depends(get_current_user),
                     db: Session = Depends(obtenir_session)):
    if db.query(Equipement).filter(Equipement.utilisateur_id == current_user.id).count() >= 100:
        raise HTTPException(400, "Trop de matériel enregistré")
    e = Equipement(utilisateur_id=current_user.id)
    _appliquer(e, payload)
    db.add(e)
    db.commit()
    return {"ok": True, "id": e.id}


@router.put("/api/equipements/{eid}", summary="Modifie du matériel")
def modifier_equipement(eid: int, payload: EquipementSchema, current_user: Utilisateur = Depends(get_current_user),
                        db: Session = Depends(obtenir_session)):
    e = _equipement(db, current_user, eid)
    _appliquer(e, payload)
    db.commit()
    return {"ok": True}


@router.delete("/api/equipements/{eid}", summary="Supprime du matériel (les séances n'en gardent pas trace)")
def supprimer_equipement(eid: int, current_user: Utilisateur = Depends(get_current_user),
                         db: Session = Depends(obtenir_session)):
    e = _equipement(db, current_user, eid)
    db.query(EquipementActivite).filter(EquipementActivite.equipement_id == e.id).delete()
    db.delete(e)
    db.commit()
    return {"ok": True}


@router.get("/api/activites/{activite_id}/equipement", summary="Matériel compté pour une séance")
def equipement_activite(activite_id: int, current_user: Utilisateur = Depends(get_current_user),
                        db: Session = Depends(obtenir_session)):
    return ms.de_activite(db, current_user.id, _activite(db, current_user, activite_id))


class ChoixEquipement(BaseModel):
    # identifiant du matériel, "aucun", ou null pour revenir au matériel par défaut
    equipement_id: Union[int, str, None] = None


@router.put("/api/activites/{activite_id}/equipement", summary="Choisit le matériel d'une séance")
def choisir_equipement(activite_id: int, payload: ChoixEquipement,
                       current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    a = _activite(db, current_user, activite_id)
    choix = db.get(EquipementActivite, a.id)
    v = payload.equipement_id
    if v is None:
        if choix:
            db.delete(choix)
    else:
        eid = None
        if v != "aucun":
            try:
                eid = _equipement(db, current_user, int(v)).id
            except ValueError:
                raise HTTPException(400, "Choix invalide")
        if choix:
            choix.equipement_id = eid
        else:
            db.add(EquipementActivite(activite_id=a.id, equipement_id=eid))
    db.commit()
    return ms.de_activite(db, current_user.id, a)


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
