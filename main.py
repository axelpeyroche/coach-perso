"""
API FastAPI — Coach d'Entraînement Hybride EPC.

Routes :
    POST /api/evaluations/              Créer une session d'évaluation
    POST /api/evaluations/{id}/demi-cooper      Enregistrer un Demi-Cooper
    POST /api/evaluations/{id}/max-1min         Enregistrer les scores Max 1 min
    POST /api/evaluations/{id}/amrap-benchmark  Enregistrer le score AMRAP Benchmark
    GET  /api/analytics/tendances-physiologiques
    GET  /api/analytics/distribution-volume
    GET  /api/analytics/biometrie-recuperation
    GET  /api/macrocycles/{id}/semaines
    POST /api/seances/{id}/journal              Journaliser une séance complétée
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import analytics_service
from database import creer_tables, obtenir_session
from models import (
    BiometrieUtilisateur,
    JournalEvaluationSeance,
    JournalSeance,
    Macrocycle,
    ResultatAMRAPBenchmark,
    ResultatDemiCooper,
    ResultatMax1Min,
    SeanceEntrainement,
    SemaineEntrainement,
)

app = FastAPI(
    title="Coach EPC — API",
    description="API du coach d'entraînement hybride Course & Musculation au poids du corps.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def demarrage():
    creer_tables()


# ---------------------------------------------------------------------------
# Schémas Pydantic
# ---------------------------------------------------------------------------

class CreerEvaluationSchema(BaseModel):
    utilisateur_id: int
    macrocycle_id: Optional[int] = None
    est_induction: bool = False
    notes: Optional[str] = None


class DemiCooperSchema(BaseModel):
    distance_metres: float = Field(..., gt=0, description="Distance parcourue en 6 minutes (mètres)")
    conditions: Optional[str] = None
    fc_max: Optional[int] = Field(None, gt=0, lt=250)


class Max1MinSchema(BaseModel):
    exercice_id: int
    repetitions_realisees: int = Field(..., ge=0)
    notes: Optional[str] = None


class AMRAPBenchmarkSchema(BaseModel):
    tours_completes: float = Field(..., ge=0, description="Ex. 2.9 = 2 tours + 9 reps")
    total_reps: Optional[int] = None
    tractions_dernier_partiel: Optional[int] = None
    pompes_dernier_partiel: Optional[int] = None
    squats_dernier_partiel: Optional[int] = None
    dips_dernier_partiel: Optional[int] = None
    burpees_dernier_partiel: Optional[int] = None
    mountain_climbers_dernier_partiel: Optional[int] = None
    fc_moyenne_bpm: Optional[int] = None
    fc_max_bpm: Optional[int] = None
    notes: Optional[str] = None


class JournalSeanceSchema(BaseModel):
    utilisateur_id: int
    completee: bool = True
    rpe: Optional[float] = Field(None, ge=1, le=10)
    rpe_cible: Optional[float] = Field(None, ge=1, le=10)
    distance_reelle_km: Optional[float] = None
    duree_reelle_min: Optional[int] = None
    dplus_reel_m: Optional[int] = None
    fc_moyenne_bpm: Optional[int] = None
    fc_max_bpm: Optional[int] = None
    tours_amrap_completes: Optional[float] = None
    total_reps_enregistrees: Optional[int] = None
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Routes — Évaluations
# ---------------------------------------------------------------------------

@app.post("/api/evaluations/", summary="Créer une session d'évaluation")
def creer_evaluation(payload: CreerEvaluationSchema, db: Session = Depends(obtenir_session)):
    evaluation = JournalEvaluationSeance(
        utilisateur_id=payload.utilisateur_id,
        macrocycle_id=payload.macrocycle_id,
        est_induction=payload.est_induction,
        notes=payload.notes,
    )
    db.add(evaluation)
    db.commit()
    db.refresh(evaluation)
    return {"id": evaluation.id, "evalue_le": str(evaluation.evalue_le)}


@app.post(
    "/api/evaluations/{evaluation_id}/demi-cooper",
    summary="Enregistrer un résultat Demi-Cooper et recalculer la VMA",
)
def enregistrer_demi_cooper(
    evaluation_id: int,
    payload: DemiCooperSchema,
    db: Session = Depends(obtenir_session),
):
    evaluation = db.get(JournalEvaluationSeance, evaluation_id)
    if not evaluation:
        raise HTTPException(404, "Évaluation introuvable")

    vma = ResultatDemiCooper.calculer_vma(payload.distance_metres)

    # Créer le snapshot biométrique avec toutes les zones recalculées
    biometrie = BiometrieUtilisateur.depuis_demi_cooper(
        utilisateur_id=evaluation.utilisateur_id,
        distance_metres=payload.distance_metres,
        fc_max=payload.fc_max,
    )
    db.add(biometrie)
    db.flush()  # obtenir l'id avant de le référencer

    resultat = ResultatDemiCooper(
        evaluation_id=evaluation_id,
        distance_metres=payload.distance_metres,
        vma_calculee_kmh=vma,
        conditions=payload.conditions,
        id_biometrie_instantanee=biometrie.id,
    )
    db.add(resultat)
    db.commit()
    db.refresh(biometrie)

    return {
        "vma_kmh": vma,
        "biometrie_id": biometrie.id,
        "zones": {
            "Z1": {"min": biometrie.z1_min_kmh, "max": biometrie.z1_max_kmh},
            "Z2": {"min": biometrie.z2_min_kmh, "max": biometrie.z2_max_kmh},
            "Z3": {"min": biometrie.z3_min_kmh, "max": biometrie.z3_max_kmh},
            "Z4": {"min": biometrie.z4_min_kmh, "max": biometrie.z4_max_kmh},
            "Z5": {"min": biometrie.z5_min_kmh, "max": biometrie.z5_max_kmh},
        },
    }


@app.post(
    "/api/evaluations/{evaluation_id}/max-1min",
    summary="Enregistrer les scores Max Répétitions 1 Minute",
)
def enregistrer_max_1min(
    evaluation_id: int,
    payload: list[Max1MinSchema],
    db: Session = Depends(obtenir_session),
):
    evaluation = db.get(JournalEvaluationSeance, evaluation_id)
    if not evaluation:
        raise HTTPException(404, "Évaluation introuvable")

    resultats = []
    for item in payload:
        r = ResultatMax1Min(
            evaluation_id=evaluation_id,
            exercice_id=item.exercice_id,
            repetitions_realisees=item.repetitions_realisees,
            notes=item.notes,
        )
        db.add(r)
        resultats.append({"exercice_id": item.exercice_id, "repetitions": item.repetitions_realisees})

    db.commit()
    return {"enregistres": len(resultats), "resultats": resultats}


@app.post(
    "/api/evaluations/{evaluation_id}/amrap-benchmark",
    summary="Enregistrer le score AMRAP Benchmark 10 minutes",
)
def enregistrer_amrap_benchmark(
    evaluation_id: int,
    payload: AMRAPBenchmarkSchema,
    db: Session = Depends(obtenir_session),
):
    evaluation = db.get(JournalEvaluationSeance, evaluation_id)
    if not evaluation:
        raise HTTPException(404, "Évaluation introuvable")

    benchmark = ResultatAMRAPBenchmark(
        evaluation_id=evaluation_id,
        tours_completes=payload.tours_completes,
        total_reps=payload.total_reps,
        tractions_dernier_partiel=payload.tractions_dernier_partiel,
        pompes_dernier_partiel=payload.pompes_dernier_partiel,
        squats_dernier_partiel=payload.squats_dernier_partiel,
        dips_dernier_partiel=payload.dips_dernier_partiel,
        burpees_dernier_partiel=payload.burpees_dernier_partiel,
        mountain_climbers_dernier_partiel=payload.mountain_climbers_dernier_partiel,
        fc_moyenne_bpm=payload.fc_moyenne_bpm,
        fc_max_bpm=payload.fc_max_bpm,
        notes=payload.notes,
    )
    db.add(benchmark)
    db.commit()
    db.refresh(benchmark)
    return {"id": benchmark.id, "tours_completes": benchmark.tours_completes}


# ---------------------------------------------------------------------------
# Routes — Journalisation des séances
# ---------------------------------------------------------------------------

@app.post(
    "/api/seances/{seance_id}/journal",
    summary="Journaliser une séance complétée",
)
def journaliser_seance(
    seance_id: int,
    payload: JournalSeanceSchema,
    db: Session = Depends(obtenir_session),
):
    seance = db.get(SeanceEntrainement, seance_id)
    if not seance:
        raise HTTPException(404, "Séance introuvable")

    journal = JournalSeance(
        utilisateur_id=payload.utilisateur_id,
        seance_id=seance_id,
        completee=payload.completee,
        rpe=payload.rpe,
        rpe_cible=payload.rpe_cible,
        distance_reelle_km=payload.distance_reelle_km,
        duree_reelle_min=payload.duree_reelle_min,
        dplus_reel_m=payload.dplus_reel_m,
        fc_moyenne_bpm=payload.fc_moyenne_bpm,
        fc_max_bpm=payload.fc_max_bpm,
        tours_amrap_completes=payload.tours_amrap_completes,
        total_reps_enregistrees=payload.total_reps_enregistrees,
        notes=payload.notes,
    )
    db.add(journal)
    db.commit()
    db.refresh(journal)
    return {"id": journal.id, "enregistre_le": str(journal.enregistre_le)}


# ---------------------------------------------------------------------------
# Routes — Macrocycles
# ---------------------------------------------------------------------------

@app.get(
    "/api/macrocycles/{macrocycle_id}/semaines",
    summary="Récupérer les semaines d'un macrocycle avec leurs séances",
)
def obtenir_semaines_macrocycle(
    macrocycle_id: int,
    db: Session = Depends(obtenir_session),
):
    macrocycle = db.get(Macrocycle, macrocycle_id)
    if not macrocycle:
        raise HTTPException(404, "Macrocycle introuvable")

    return {
        "macrocycle_id": macrocycle_id,
        "numero_cycle": macrocycle.numero_cycle,
        "date_debut": str(macrocycle.date_debut),
        "date_fin": str(macrocycle.date_fin),
        "semaines": [
            {
                "numero_semaine": s.numero_semaine,
                "macrophase": s.macrophase.value,
                "date_debut": str(s.date_debut),
                "multiplicateur_volume": s.multiplicateur_volume,
                "objectif_km_course": s.objectif_km_course,
                "objectif_amrap_min": s.objectif_amrap_min,
                "seances": [
                    {
                        "id": seance.id,
                        "type": seance.type_seance.value,
                        "titre": seance.titre,
                        "date": str(seance.date_seance),
                        "zone_cible": seance.zone_cible.value if seance.zone_cible else None,
                        "distance_cible_km": seance.distance_cible_km,
                        "temps_limite_min": seance.temps_limite_min,
                    }
                    for seance in s.seances
                ],
            }
            for s in macrocycle.semaines
        ],
    }


# ---------------------------------------------------------------------------
# Routes — Analytique
# ---------------------------------------------------------------------------

@app.get(
    "/api/analytics/tendances-physiologiques",
    summary="Évolution VMA et scores Max 1 min au fil des macrocycles",
)
def tendances_physiologiques(
    utilisateur_id: int = Query(...),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.tendances_physiologiques(db, utilisateur_id)


@app.get(
    "/api/analytics/distribution-volume",
    summary="Kilométrage hebdomadaire, D+ cumulé et répartition musculaire Push/Pull/Jambes",
)
def distribution_volume(
    utilisateur_id: int = Query(...),
    macrocycle_id: Optional[int] = Query(None),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.distribution_volume(db, utilisateur_id, macrocycle_id)


@app.get(
    "/api/analytics/biometrie-recuperation",
    summary="Tendance RPE et Ratio Charge Aiguë/Chronique (ACWA) avec alerte risque blessure",
)
def biometrie_recuperation(
    utilisateur_id: int = Query(...),
    macrocycle_id: Optional[int] = Query(None),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.biometrie_recuperation(db, utilisateur_id, macrocycle_id)


# ---------------------------------------------------------------------------
# Santé
# ---------------------------------------------------------------------------

@app.get("/", include_in_schema=False)
def racine():
    return {"statut": "Coach EPC opérationnel", "docs": "/docs"}


@app.get("/health", include_in_schema=False)
def sante():
    return {"statut": "ok", "timestamp": datetime.utcnow().isoformat()}
