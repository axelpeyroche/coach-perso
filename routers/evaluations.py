"""Routes du domaine évaluations : sessions de test, Demi-Cooper, Max 1 min, AMRAP Benchmark."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import obtenir_session
from models import (
    BiometrieUtilisateur,
    JournalEvaluationSeance,
    ResultatAMRAPBenchmark,
    ResultatDemiCooper,
    ResultatMax1Min,
    Utilisateur,
    VariationExercice,
)
from deps import get_current_user

router = APIRouter()

class CreerEvaluationSchema(BaseModel):
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


# ---------------------------------------------------------------------------
# Routes — Évaluations
# ---------------------------------------------------------------------------

@router.delete("/api/evaluations/incompletes", summary="Supprime les évaluations sans AMRAP ET sans Max 1 min")
def supprimer_evaluations_incompletes(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    evals = db.query(JournalEvaluationSeance).filter(JournalEvaluationSeance.utilisateur_id == current_user.id).all()
    supprimes = 0
    for ev in evals:
        if ev.benchmark_amrap is None and len(ev.resultats_max_1min) == 0:
            db.delete(ev)
            supprimes += 1
    db.commit()
    return {"supprimes": supprimes}


@router.delete("/api/evaluations/{evaluation_id}", summary="Supprimer une évaluation")
def supprimer_evaluation(evaluation_id: int, current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    evaluation = db.get(JournalEvaluationSeance, evaluation_id)
    if not evaluation or evaluation.utilisateur_id != current_user.id:
        raise HTTPException(404, "Évaluation introuvable")
    # Supprimer les biométries créées par le Demi-Cooper de cette évaluation
    if evaluation.demi_cooper and evaluation.demi_cooper.id_biometrie_instantanee:
        bio = db.get(BiometrieUtilisateur, evaluation.demi_cooper.id_biometrie_instantanee)
        if bio:
            db.delete(bio)
    db.delete(evaluation)
    db.commit()
    return {"supprime": evaluation_id}


class ModifierEvaluationSchema(BaseModel):
    distance_metres: Optional[float] = None
    amrap_tours: Optional[float] = None
    max_1min: Optional[list[dict]] = None  # [{"exercice_id": int, "repetitions": int}]

@router.patch("/api/evaluations/{evaluation_id}", summary="Modifier les données d'une évaluation existante")
def modifier_evaluation(evaluation_id: int, payload: ModifierEvaluationSchema, current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    evaluation = db.get(JournalEvaluationSeance, evaluation_id)
    if not evaluation or evaluation.utilisateur_id != current_user.id:
        raise HTTPException(404, "Évaluation introuvable")

    if payload.distance_metres is not None:
        cooper = evaluation.demi_cooper
        if cooper:
            cooper.distance_metres = payload.distance_metres
            cooper.vma_calculee_kmh = ResultatDemiCooper.calculer_vma(payload.distance_metres)
            # Met à jour la biométrie liée
            bio = (
                db.query(BiometrieUtilisateur)
                .filter(BiometrieUtilisateur.utilisateur_id == evaluation.utilisateur_id)
                .filter(BiometrieUtilisateur.enregistre_le >= evaluation.evalue_le)
                .order_by(BiometrieUtilisateur.enregistre_le.asc())
                .first()
            )
            if bio:
                bio.vma_kmh = cooper.vma_calculee_kmh

    if payload.amrap_tours is not None:
        amrap = evaluation.benchmark_amrap
        if amrap:
            amrap.tours_completes = payload.amrap_tours

    if payload.max_1min is not None:
        for item in payload.max_1min:
            r = db.query(ResultatMax1Min).filter(
                ResultatMax1Min.evaluation_id == evaluation_id,
                ResultatMax1Min.exercice_id == item["exercice_id"],
            ).first()
            if r:
                r.repetitions_realisees = item["repetitions"]

    db.commit()
    return {"ok": True}


@router.get("/api/evaluations/historique", summary="Historique des évaluations passées")
def historique_evaluations(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    evals = (
        db.query(JournalEvaluationSeance)
        .filter(JournalEvaluationSeance.utilisateur_id == current_user.id)
        .order_by(JournalEvaluationSeance.evalue_le.desc())
        .all()
    )
    result = []
    for ev in evals:
        cooper = ev.demi_cooper
        amrap = ev.benchmark_amrap
        max1min = ev.resultats_max_1min
        result.append({
            "id": ev.id,
            "date": str(ev.evalue_le)[:10],
            "est_induction": ev.est_induction,
            "vma_kmh": cooper.vma_calculee_kmh if cooper else None,
            "distance_m": cooper.distance_metres if cooper else None,
            "amrap_tours": amrap.tours_completes if amrap else None,
            "max_1min": [
                {"nom": r.exercice.nom, "reps": r.repetitions_realisees, "exercice_id": r.exercice_id}
                for r in sorted(max1min, key=lambda x: x.exercice_id)
            ],
        })
    return {"evaluations": result}


@router.post("/api/evaluations/", summary="Créer une session d'évaluation")
def creer_evaluation(payload: CreerEvaluationSchema, current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    evaluation = JournalEvaluationSeance(
        utilisateur_id=current_user.id,
        macrocycle_id=payload.macrocycle_id,
        est_induction=payload.est_induction,
        notes=payload.notes,
    )
    db.add(evaluation)
    db.commit()
    db.refresh(evaluation)
    return {"id": evaluation.id, "evalue_le": str(evaluation.evalue_le)}


@router.post(
    "/api/evaluations/{evaluation_id}/demi-cooper",
    summary="Enregistrer un résultat Demi-Cooper et recalculer la VMA",
)
def enregistrer_demi_cooper(
    evaluation_id: int,
    payload: DemiCooperSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    evaluation = db.get(JournalEvaluationSeance, evaluation_id)
    if not evaluation or evaluation.utilisateur_id != current_user.id:
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


@router.post(
    "/api/evaluations/{evaluation_id}/max-1min",
    summary="Enregistrer les scores Max Répétitions 1 Minute",
)
def enregistrer_max_1min(
    evaluation_id: int,
    payload: list[Max1MinSchema],
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    evaluation = db.get(JournalEvaluationSeance, evaluation_id)
    if not evaluation or evaluation.utilisateur_id != current_user.id:
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


@router.post(
    "/api/evaluations/{evaluation_id}/amrap-benchmark",
    summary="Enregistrer le score AMRAP Benchmark 10 minutes",
)
def enregistrer_amrap_benchmark(
    evaluation_id: int,
    payload: AMRAPBenchmarkSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    evaluation = db.get(JournalEvaluationSeance, evaluation_id)
    if not evaluation or evaluation.utilisateur_id != current_user.id:
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
SLUGS_EVALUATION = [
    "traction-stricte",
    "dip-parallettes",
    "pompe-standard",
    "abdominal-crunch",
    "squat-bw",
    "pistol-squat-gauche",
    "pistol-squat-droit",
]
@router.get("/api/exercices/evaluation", summary="Liste des exercices du protocole Max 1 min")
def exercices_evaluation(db: Session = Depends(obtenir_session)):
    exercices = (
        db.query(VariationExercice)
        .filter(VariationExercice.slug.in_(SLUGS_EVALUATION))
        .order_by(VariationExercice.id)
        .all()
    )
    return [
        {"id": e.id, "nom": e.nom, "slug": e.slug}
        for e in exercices
    ]
