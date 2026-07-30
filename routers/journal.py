"""Routes du domaine journal : journalisation des séances, RPE, planification, OCR screenshot Forme."""

from __future__ import annotations

import io
import logging
import re
import threading as _threading
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import obtenir_session
from models import JournalSeance, Utilisateur
from deps import get_current_user, _obtenir_seance_utilisateur, _planifier_notification

logger = logging.getLogger(__name__)

router = APIRouter()


class JournalSeanceSchema(BaseModel):
    utilisateur_id: Optional[int] = None  # ignoré — on utilise current_user.id
    completee: bool = True
    rpe: Optional[float] = Field(None, ge=1, le=10)
    rpe_cible: Optional[float] = Field(None, ge=1, le=10)
    type_course: Optional[str] = None  # "route" | "trail"
    distance_reelle_km: Optional[float] = None
    distance_repos_km: Optional[float] = None  # récupération trottinée entre blocs
    duree_reelle_min: Optional[int] = None
    dplus_reel_m: Optional[int] = None
    fc_moyenne_bpm: Optional[int] = None
    fc_max_bpm: Optional[int] = None
    tours_amrap_completes: Optional[float] = None
    total_reps_enregistrees: Optional[int] = None
    notes: Optional[str] = None
    details_intervalles: Optional[str] = None  # JSON string


@router.post(
    "/api/seances/{seance_id}/journal",
    summary="Journaliser une séance complétée",
)
def journaliser_seance(
    seance_id: int,
    payload: JournalSeanceSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    seance = _obtenir_seance_utilisateur(db, seance_id, current_user)

    if seance.journal:
        raise HTTPException(409, "Journal déjà créé pour cette séance — utilisez PATCH")

    # RPE cible automatique depuis la zone de la séance si non fourni
    _RPE_PAR_ZONE = {"Z1": 5.0, "Z2": 6.0, "Z3": 7.0, "Z4": 8.0, "Z5": 9.0}
    rpe_cible_final = payload.rpe_cible
    if rpe_cible_final is None and seance.zone_cible:
        rpe_cible_final = _RPE_PAR_ZONE.get(seance.zone_cible.value)

    # Calcul automatique distance_reelle_km pour séances fractionnées
    distance_km = payload.distance_reelle_km
    if distance_km is None and payload.details_intervalles:
        try:
            import json as _json
            blocs = _json.loads(payload.details_intervalles)
            distance_km = sum(b.get("distance_km") or 0 for b in blocs)
            if payload.distance_repos_km:
                distance_km += payload.distance_repos_km
            distance_km = round(distance_km, 3) if distance_km else None
        except Exception:
            logger.warning("details_intervalles illisible pour la séance %s", seance_id)

    journal = JournalSeance(
        utilisateur_id=current_user.id,
        seance_id=seance_id,
        completee=payload.completee,
        rpe=payload.rpe,
        rpe_cible=rpe_cible_final,
        type_course=payload.type_course or current_user.type_course,
        distance_reelle_km=distance_km,
        distance_repos_km=round(payload.distance_repos_km, 2) if payload.distance_repos_km is not None else None,
        duree_reelle_min=payload.duree_reelle_min,
        dplus_reel_m=payload.dplus_reel_m,
        fc_moyenne_bpm=payload.fc_moyenne_bpm,
        fc_max_bpm=payload.fc_max_bpm,
        tours_amrap_completes=payload.tours_amrap_completes,
        total_reps_enregistrees=payload.total_reps_enregistrees,
        notes=payload.notes,
        details_intervalles=payload.details_intervalles,
    )
    db.add(journal)
    db.commit()
    db.refresh(journal)
    conseil = _conseil_recuperation(payload.rpe) if payload.rpe and payload.completee else None
    return {"id": journal.id, "enregistre_le": str(journal.enregistre_le), "conseil_recuperation": conseil}


class PrefillSeanceSchema(BaseModel):
    duree_reelle_min: Optional[int] = None
    distance_reelle_km: Optional[float] = None
    dplus_reel_m: Optional[int] = None
    fc_moyenne_bpm: Optional[int] = None
    fc_max_bpm: Optional[int] = None


@router.post(
    "/api/seances/{seance_id}/journal/prefill",
    summary="Pré-remplit les métriques physiques — en attente du RPE",
)
def prefill_seance(
    seance_id: int,
    payload: PrefillSeanceSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    seance = _obtenir_seance_utilisateur(db, seance_id, current_user)

    existing = seance.journal
    if existing:
        existing.duree_reelle_min = payload.duree_reelle_min
        existing.distance_reelle_km = payload.distance_reelle_km
        existing.dplus_reel_m = payload.dplus_reel_m
        existing.fc_moyenne_bpm = payload.fc_moyenne_bpm
        existing.fc_max_bpm = payload.fc_max_bpm
        existing.completee = False
    else:
        journal = JournalSeance(
            utilisateur_id=current_user.id,
            seance_id=seance_id,
            completee=False,
            duree_reelle_min=payload.duree_reelle_min,
            distance_reelle_km=payload.distance_reelle_km,
            dplus_reel_m=payload.dplus_reel_m,
            fc_moyenne_bpm=payload.fc_moyenne_bpm,
            fc_max_bpm=payload.fc_max_bpm,
        )
        db.add(journal)
    db.commit()
    return {"ok": True}


class ValiderRPESchema(BaseModel):
    rpe: float = Field(..., ge=1, le=10)
    notes: Optional[str] = None


def _conseil_recuperation(rpe: float) -> dict:
    r = int(round(rpe))
    if r <= 4:
        return {"niveau": "facile", "titre": "Récupération standard",
                "conseil": "Belle séance légère ! Hydratation normale et 7-8h de sommeil suffisent."}
    elif r <= 6:
        return {"niveau": "modere", "titre": "Récupération classique",
                "conseil": "Étirements 10 min ce soir. Dors 8h et bois au moins 2L d'eau."}
    elif r <= 8:
        return {"niveau": "intense", "titre": "Récupération active",
                "conseil": "Protéines dans les 30 min (20-30 g). Étirements + foam roller. Vise 8-9h de sommeil."}
    elif r == 9:
        return {"niveau": "tres_intense", "titre": "Récupération prioritaire",
                "conseil": "Repos actif ou complet demain. Jambes surélevées 15 min. Minimum 9h de sommeil."}
    else:
        return {"niveau": "depassement", "titre": "Repos obligatoire",
                "conseil": "2 jours de repos minimum. Alimentation anti-inflammatoire. Consulte un médecin si douleurs persistantes."}


@router.patch(
    "/api/seances/{seance_id}/journal/valider",
    summary="Finalise la séance avec le RPE — marque completee=True",
)
def valider_rpe(
    seance_id: int,
    payload: ValiderRPESchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    seance = _obtenir_seance_utilisateur(db, seance_id, current_user)
    if not seance.journal:
        raise HTTPException(404, "Journal introuvable — lance d'abord un prefill")
    seance.journal.rpe = payload.rpe
    seance.journal.notes = payload.notes
    seance.journal.completee = True
    db.commit()
    return {"ok": True, "conseil_recuperation": _conseil_recuperation(payload.rpe)}


@router.delete(
    "/api/seances/{seance_id}/journal",
    summary="Supprime le journal d'une séance (annule la validation)",
)
def supprimer_journal_seance(
    seance_id: int,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    seance = _obtenir_seance_utilisateur(db, seance_id, current_user)
    if not seance.journal:
        raise HTTPException(404, "Journal introuvable")
    db.delete(seance.journal)
    db.commit()
    return {"ok": True}


class PlanifierSchema(BaseModel):
    date_planifiee: Optional[str] = None   # "YYYY-MM-DD" ou null pour annuler
    heure_planifiee: Optional[str] = None  # "HH:MM" ou null


@router.patch("/api/seances/{seance_id}/planifier", summary="Planifie ou déplanifie une séance")
def planifier_seance(
    seance_id: int,
    payload: PlanifierSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    seance = _obtenir_seance_utilisateur(db, seance_id, current_user)
    seance.date_planifiee = date.fromisoformat(payload.date_planifiee) if payload.date_planifiee else None
    seance.heure_planifiee = payload.heure_planifiee or None
    db.commit()
    _planifier_notification(seance.id, seance.date_planifiee, seance.heure_planifiee)
    return {"ok": True}


@router.patch(
    "/api/seances/{seance_id}/journal",
    summary="Modifie les données d'un journal existant",
)
def modifier_journal_seance(
    seance_id: int,
    payload: JournalSeanceSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    seance = _obtenir_seance_utilisateur(db, seance_id, current_user)
    if not seance.journal:
        raise HTTPException(404, "Journal introuvable")
    j = seance.journal
    if payload.type_course is not None: j.type_course = payload.type_course
    if payload.rpe is not None: j.rpe = payload.rpe
    if payload.notes is not None: j.notes = payload.notes
    if payload.duree_reelle_min is not None: j.duree_reelle_min = payload.duree_reelle_min
    if payload.dplus_reel_m is not None: j.dplus_reel_m = payload.dplus_reel_m
    if payload.fc_moyenne_bpm is not None: j.fc_moyenne_bpm = payload.fc_moyenne_bpm
    if payload.fc_max_bpm is not None: j.fc_max_bpm = payload.fc_max_bpm
    if payload.distance_repos_km is not None:
        j.distance_repos_km = round(payload.distance_repos_km, 2)
    if payload.details_intervalles is not None:
        j.details_intervalles = payload.details_intervalles
        # Recalculer distance_reelle_km depuis les blocs si non fournie explicitement
        if payload.distance_reelle_km is None:
            try:
                import json as _json
                blocs = _json.loads(payload.details_intervalles)
                total = sum(b.get("distance_km") or 0 for b in blocs)
                repos = payload.distance_repos_km if payload.distance_repos_km is not None else (j.distance_repos_km or 0)
                total += repos
                if total > 0:
                    j.distance_reelle_km = round(total, 3)
            except Exception:
                logger.warning("details_intervalles illisible pour la séance %s", seance_id)
    if payload.distance_reelle_km is not None:
        j.distance_reelle_km = payload.distance_reelle_km
    j.completee = True
    db.commit()
    return {"ok": True}


def _extraire_metriques_forme(texte: str) -> dict:
    """Parse le texte OCR d'un screenshot de l'app Forme (Apple Watch)."""
    metriques = {}

    # Durée — ex. "40:00" ou "1:05:30"
    m = re.search(r"\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b", texte)
    if m:
        if m.group(3):
            metriques["duree_reelle_min"] = int(m.group(1)) * 60 + int(m.group(2))
        else:
            metriques["duree_reelle_min"] = int(m.group(1)) * 60 + int(m.group(2))
            # Si format MM:SS et durée < 10 min, probablement des secondes
            if metriques["duree_reelle_min"] < 10:
                metriques["duree_reelle_min"] = int(m.group(1))

    # Distance — ex. "6,19 KM" ou "6.19 KM"
    m = re.search(r"([\d][,\.][\d]+|\d+)\s*K[Mm]", texte)
    if m:
        metriques["distance_reelle_km"] = float(m.group(1).replace(",", "."))

    # Dénivelé — ex. "Dénivelé : 19 M" ou "19 m"
    m = re.search(r"[Dd][ée]niv[eé]l[eé]\s*:?\s*(\d+)\s*[Mm]", texte)
    if m:
        metriques["dplus_reel_m"] = int(m.group(1))

    # FC moyenne — ex. "Moyenne : 153 BPM" (la première occurrence)
    matches_bpm = re.findall(r"[Mm]oyenne\s*:?\s*(\d+)\s*[Bb][Pp][Mm]", texte)
    if matches_bpm:
        metriques["fc_moyenne_bpm"] = int(matches_bpm[0])

    # FC max — ex. "89–165 BPM" ou "89-165 BPM"
    m = re.search(r"(\d+)\s*[–-]\s*(\d+)\s*[Bb][Pp][Mm]", texte)
    if m:
        metriques["fc_max_bpm"] = int(m.group(2))

    return metriques


_ocr_singleton = None
_ocr_lock = _threading.Lock()


def _obtenir_ocr():
    global _ocr_singleton
    if _ocr_singleton is None:
        with _ocr_lock:
            if _ocr_singleton is None:
                from rapidocr_onnxruntime import RapidOCR
                _ocr_singleton = RapidOCR()
    return _ocr_singleton


def _executer_ocr_bloquant(contenu: bytes) -> str:
    from PIL import Image
    import numpy as np

    image = Image.open(io.BytesIO(contenu)).convert("RGB")
    arr = np.array(image)
    ocr = _obtenir_ocr()
    result, _ = ocr(arr)
    return "\n".join(r[1] for r in result) if result else ""


@router.post(
    "/api/seances/{seance_id}/journal/analyse-screenshot",
    summary="Analyse un screenshot Forme via OCR et pré-remplit les métriques",
)
async def analyser_screenshot(
    seance_id: int,
    file: UploadFile = File(...),
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    seance = _obtenir_seance_utilisateur(db, seance_id, current_user)

    contenu = await file.read()
    try:
        texte = await run_in_threadpool(_executer_ocr_bloquant, contenu)
    except Exception:
        logger.exception("OCR échoué")
        raise HTTPException(500, "Échec de l'analyse du screenshot")

    metriques = _extraire_metriques_forme(texte)
    if not metriques:
        raise HTTPException(422, f"Aucune métrique détectée. Texte extrait : {texte[:300]!r}")

    existing = seance.journal
    if existing:
        for k, v in metriques.items():
            setattr(existing, k, v)
        existing.completee = False
    else:
        journal = JournalSeance(
            utilisateur_id=current_user.id,
            seance_id=seance_id,
            completee=False,
            **metriques,
        )
        db.add(journal)
    db.commit()
    return {"ok": True, "metriques": metriques}
