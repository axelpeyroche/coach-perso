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

from datetime import datetime, date, timedelta
from typing import Optional

import io
import re

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
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
    ObjectifCourse,
    ResultatAMRAPBenchmark,
    ResultatDemiCooper,
    ResultatMax1Min,
    SeanceEntrainement,
    SemaineEntrainement,
    Utilisateur,
    VariationExercice,
)

app = FastAPI(
    title="Coach EPC — API",
    description="API du coach d'entraînement hybride Course & Musculation au poids du corps.",
    version="1.0.0",
)

def _initialiser_donnees_demo():
    """Crée un utilisateur et 2 macrocycles (Module 1 + Module 2) si la base est vide."""
    from models import Utilisateur, SemaineEntrainement
    from periodization_rules import BLUEPRINT_MACROCYCLE, generer_dates_semaines
    db = next(obtenir_session())
    try:
        if db.query(Utilisateur).count() == 0:
            user = Utilisateur(email="coach@perso.fr", nom="Athlète EPC")
            db.add(user)
            db.flush()

            debut_mc1 = date.today()
            debut_mc2 = debut_mc1 + timedelta(weeks=8)

            for numero_cycle, debut in ((1, debut_mc1), (2, debut_mc2)):
                mc = Macrocycle(
                    utilisateur_id=user.id,
                    numero_cycle=numero_cycle,
                    date_debut=debut,
                    date_fin=debut + timedelta(weeks=8),
                )
                db.add(mc)
                db.flush()
                dates = generer_dates_semaines(debut)
                for regle, date_sem in zip(BLUEPRINT_MACROCYCLE, dates):
                    sem = SemaineEntrainement(
                        macrocycle_id=mc.id,
                        numero_semaine=regle.numero,
                        macrophase=regle.macrophase,
                        date_debut=date_sem,
                        multiplicateur_volume=regle.multiplicateur_volume,
                        objectif_km_course=regle.objectif_km_course,
                        objectif_amrap_min=regle.objectif_amrap_min,
                    )
                    db.add(sem)
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


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
    _initialiser_donnees_demo()


# ---------------------------------------------------------------------------
# Schémas Pydantic
# ---------------------------------------------------------------------------

class ProfilFCSchema(BaseModel):
    fc_max: Optional[int] = Field(None, gt=0, lt=250)
    fc_repos: Optional[int] = Field(None, gt=0, lt=150)

@app.get("/api/utilisateur/profil-fc", summary="Récupère fc_max et fc_repos de l'utilisateur")
def get_profil_fc(utilisateur_id: int = 1, db: Session = Depends(obtenir_session)):
    u = db.query(Utilisateur).filter(Utilisateur.id == utilisateur_id).first()
    if not u:
        raise HTTPException(404, "Utilisateur non trouvé")
    return {"fc_max": u.fc_max, "fc_repos": u.fc_repos}

@app.patch("/api/utilisateur/profil-fc", summary="Met à jour fc_max et/ou fc_repos")
def patch_profil_fc(payload: ProfilFCSchema, utilisateur_id: int = 1, db: Session = Depends(obtenir_session)):
    u = db.query(Utilisateur).filter(Utilisateur.id == utilisateur_id).first()
    if not u:
        raise HTTPException(404, "Utilisateur non trouvé")
    if payload.fc_max is not None:
        u.fc_max = payload.fc_max
    if payload.fc_repos is not None:
        u.fc_repos = payload.fc_repos
    db.commit()
    return {"fc_max": u.fc_max, "fc_repos": u.fc_repos}


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

@app.delete("/api/evaluations/incompletes", summary="Supprime les évaluations sans AMRAP ET sans Max 1 min")
def supprimer_evaluations_incompletes(utilisateur_id: int = Query(1), db: Session = Depends(obtenir_session)):
    evals = db.query(JournalEvaluationSeance).filter(JournalEvaluationSeance.utilisateur_id == utilisateur_id).all()
    supprimes = 0
    for ev in evals:
        if ev.benchmark_amrap is None and len(ev.resultats_max_1min) == 0:
            db.delete(ev)
            supprimes += 1
    db.commit()
    return {"supprimes": supprimes}


class ModifierEvaluationSchema(BaseModel):
    distance_metres: Optional[float] = None
    amrap_tours: Optional[float] = None
    max_1min: Optional[list[dict]] = None  # [{"exercice_id": int, "repetitions": int}]

@app.patch("/api/evaluations/{evaluation_id}", summary="Modifier les données d'une évaluation existante")
def modifier_evaluation(evaluation_id: int, payload: ModifierEvaluationSchema, db: Session = Depends(obtenir_session)):
    evaluation = db.get(JournalEvaluationSeance, evaluation_id)
    if not evaluation:
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


@app.get("/api/evaluations/historique", summary="Historique des évaluations passées")
def historique_evaluations(utilisateur_id: int = Query(1), db: Session = Depends(obtenir_session)):
    evals = (
        db.query(JournalEvaluationSeance)
        .filter(JournalEvaluationSeance.utilisateur_id == utilisateur_id)
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


class PrefillSeanceSchema(BaseModel):
    utilisateur_id: int = 1
    duree_reelle_min: Optional[int] = None
    distance_reelle_km: Optional[float] = None
    dplus_reel_m: Optional[int] = None
    fc_moyenne_bpm: Optional[int] = None
    fc_max_bpm: Optional[int] = None


@app.post(
    "/api/seances/{seance_id}/journal/prefill",
    summary="Pré-remplit les métriques physiques — en attente du RPE",
)
def prefill_seance(
    seance_id: int,
    payload: PrefillSeanceSchema,
    db: Session = Depends(obtenir_session),
):
    seance = db.get(SeanceEntrainement, seance_id)
    if not seance:
        raise HTTPException(404, "Séance introuvable")

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
            utilisateur_id=payload.utilisateur_id,
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


@app.patch(
    "/api/seances/{seance_id}/journal/valider",
    summary="Finalise la séance avec le RPE — marque completee=True",
)
def valider_rpe(
    seance_id: int,
    payload: ValiderRPESchema,
    db: Session = Depends(obtenir_session),
):
    seance = db.get(SeanceEntrainement, seance_id)
    if not seance or not seance.journal:
        raise HTTPException(404, "Journal introuvable — lance d'abord un prefill")
    seance.journal.rpe = payload.rpe
    seance.journal.notes = payload.notes
    seance.journal.completee = True
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


@app.post(
    "/api/seances/{seance_id}/journal/analyse-screenshot",
    summary="Analyse un screenshot Forme via OCR et pré-remplit les métriques",
)
async def analyser_screenshot(
    seance_id: int,
    utilisateur_id: int = Query(1),
    file: UploadFile = File(...),
    db: Session = Depends(obtenir_session),
):
    from PIL import Image
    from rapidocr_onnxruntime import RapidOCR

    seance = db.get(SeanceEntrainement, seance_id)
    if not seance:
        raise HTTPException(404, "Séance introuvable")

    contenu = await file.read()
    try:
        image = Image.open(io.BytesIO(contenu)).convert("RGB")
        import numpy as np
        arr = np.array(image)
        ocr = RapidOCR()
        result, _ = ocr(arr)
        texte = "\n".join(r[1] for r in result) if result else ""
    except Exception as exc:
        raise HTTPException(500, f"OCR échoué : {exc}")

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
            utilisateur_id=utilisateur_id,
            seance_id=seance_id,
            completee=False,
            **metriques,
        )
        db.add(journal)
    db.commit()
    return {"ok": True, "metriques": metriques}


# ---------------------------------------------------------------------------
# Routes — Semaine courante
# ---------------------------------------------------------------------------

@app.get("/api/semaine-courante", summary="Retourne les séances de la semaine en cours")
def semaine_courante(utilisateur_id: int = Query(1), db: Session = Depends(obtenir_session)):
    aujourd_hui = date.today()

    semaine = (
        db.query(SemaineEntrainement)
        .join(Macrocycle)
        .filter(
            Macrocycle.utilisateur_id == utilisateur_id,
            SemaineEntrainement.date_debut <= aujourd_hui,
            SemaineEntrainement.date_debut + timedelta(days=7) > aujourd_hui,
        )
        .first()
    )

    if not semaine:
        # Retourne la prochaine semaine à venir si aucune en cours
        semaine = (
            db.query(SemaineEntrainement)
            .join(Macrocycle)
            .filter(
                Macrocycle.utilisateur_id == utilisateur_id,
                SemaineEntrainement.date_debut > aujourd_hui,
            )
            .order_by(SemaineEntrainement.date_debut)
            .first()
        )

    if not semaine:
        raise HTTPException(404, "Aucune semaine trouvée")

    mc = semaine.macrocycle
    return {
        "semaine_id": semaine.id,
        "numero_semaine": semaine.numero_semaine,
        "macrophase": semaine.macrophase.value,
        "date_debut": str(semaine.date_debut),
        "macrocycle": {
            "id": mc.id,
            "numero_cycle": mc.numero_cycle,
            "nom": {1: "Module 1 — Adaptation", 2: "Module 2 — Révélation", 3: "Module 3 — Confirmation"}.get(mc.numero_cycle, f"Module {mc.numero_cycle}"),
        },
        "seances": [
            {
                "id": s.id,
                "type": s.type_seance.value,
                "titre": s.titre,
                "date": str(s.date_seance),
                "zone_cible": s.zone_cible.value if s.zone_cible else None,
                "duree_cible_min": s.duree_cible_min,
                "dplus_cible_m": s.dplus_cible_m,
                "temps_limite_min": s.temps_limite_min,
                "description": s.description,
                "exercices": [
                    {
                        "nom": ex.exercice.nom,
                        "repetitions": ex.repetitions,
                        "duree_sec": ex.duree_sec,
                        "tempo": ex.tempo_effectif,
                        "duree_bloc_min": ex.duree_bloc_min,
                    }
                    for ex in s.exercices
                ],
                "journal": {
                    "completee": s.journal.completee,
                    "rpe": s.journal.rpe,
                    "notes": s.journal.notes,
                } if s.journal else None,
            }
            for s in sorted(semaine.seances, key=lambda x: x.date_seance)
        ],
    }


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
                        "description": seance.description,
                        "date": str(seance.date_seance),
                        "zone_cible": seance.zone_cible.value if seance.zone_cible else None,
                        "distance_cible_km": seance.distance_cible_km,
                        "duree_cible_min": seance.duree_cible_min,
                        "dplus_cible_m": seance.dplus_cible_m,
                        "temps_limite_min": seance.temps_limite_min,
                        "exercices": [
                            {
                                "nom": ex.exercice.nom,
                                "slug": ex.exercice.slug,
                                "repetitions": ex.repetitions,
                                "duree_sec": ex.duree_sec,
                                "tempo": ex.tempo_effectif,
                                "duree_bloc_min": ex.duree_bloc_min,
                            }
                            for ex in seance.exercices
                        ],
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
# Exercices
# ---------------------------------------------------------------------------

SLUGS_EVALUATION = [
    "traction-stricte",
    "dip-parallettes",
    "pompe-standard",
    "abdominal-crunch",
    "squat-bw",
    "pistol-squat-gauche",
    "pistol-squat-droit",
]

@app.get("/api/programme/toutes-semaines", summary="Toutes les semaines du programme — vue à plat sans notion de module")
def toutes_semaines_programme(utilisateur_id: int = Query(1), db: Session = Depends(obtenir_session)):
    mcs = db.query(Macrocycle).filter(Macrocycle.utilisateur_id == utilisateur_id).order_by(Macrocycle.numero_cycle).all()
    semaine_globale = 0
    result = []
    for mc in mcs:
        for s in sorted(mc.semaines, key=lambda x: x.numero_semaine):
            semaine_globale += 1
            result.append({
                "semaine_globale": semaine_globale,
                "macrocycle_id": mc.id,
                "numero_semaine": s.numero_semaine,
                "macrophase": s.macrophase.value,
                "date_debut": str(s.date_debut),
                "multiplicateur_volume": s.multiplicateur_volume,
                "seances": [
                    {
                        "id": seance.id,
                        "type": seance.type_seance.value,
                        "titre": seance.titre,
                        "description": seance.description,
                        "date": str(seance.date_seance),
                        "zone_cible": seance.zone_cible.value if seance.zone_cible else None,
                        "distance_cible_km": seance.distance_cible_km,
                        "duree_cible_min": seance.duree_cible_min,
                        "dplus_cible_m": seance.dplus_cible_m,
                        "temps_limite_min": seance.temps_limite_min,
                        "exercices": [
                            {
                                "nom": ex.exercice.nom,
                                "slug": ex.exercice.slug,
                                "repetitions": ex.repetitions,
                                "duree_sec": ex.duree_sec,
                                "tempo": ex.tempo_effectif,
                                "duree_bloc_min": ex.duree_bloc_min,
                            }
                            for ex in seance.exercices
                        ],
                        "journal": {
                            "completee": seance.journal.completee,
                            "rpe": seance.journal.rpe,
                            "notes": seance.journal.notes,
                            "duree_reelle_min": seance.journal.duree_reelle_min,
                            "distance_reelle_km": seance.journal.distance_reelle_km,
                            "dplus_reel_m": seance.journal.dplus_reel_m,
                            "fc_moyenne_bpm": seance.journal.fc_moyenne_bpm,
                            "fc_max_bpm": seance.journal.fc_max_bpm,
                        } if seance.journal else None,
                    }
                    for seance in s.seances
                ],
            })
    return {"semaines": result, "total": semaine_globale}


@app.get("/api/macrocycles", summary="Liste tous les macrocycles de l'utilisateur")
def lister_macrocycles(utilisateur_id: int = Query(1), db: Session = Depends(obtenir_session)):
    mcs = db.query(Macrocycle).filter(Macrocycle.utilisateur_id == utilisateur_id).order_by(Macrocycle.numero_cycle).all()
    return [
        {
            "id": mc.id,
            "numero_cycle": mc.numero_cycle,
            "date_debut": str(mc.date_debut),
            "date_fin": str(mc.date_fin),
            "nom": {1: "Module 1 — Adaptation", 2: "Module 2 — Révélation", 3: "Module 3 — Confirmation"}.get(mc.numero_cycle, f"Module {mc.numero_cycle}"),
        }
        for mc in mcs
    ]


@app.post("/api/admin/seed-seances", summary="Génère toutes les séances des 16 semaines EPC (2 macrocycles)")
def seed_seances_route(db: Session = Depends(obtenir_session)):
    from seed_seances import seed_module1, seed_module2, seed_module3
    try:
        seed_module1()
        seed_module2()
        seed_module3()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erreur seed : {exc}")
    return {"message": "Seed terminé."}


@app.post("/api/admin/init-macrocycles", summary="Crée les 2 macrocycles si absents (pour utilisateurs existants)")
def init_macrocycles(utilisateur_id: int = Query(1), db: Session = Depends(obtenir_session)):
    from models import Utilisateur, SemaineEntrainement
    from periodization_rules import BLUEPRINT_MACROCYCLE, generer_dates_semaines

    user = db.query(Utilisateur).filter(Utilisateur.id == utilisateur_id).first()
    if not user:
        return {"erreur": f"Utilisateur {utilisateur_id} introuvable"}

    existants = {mc.numero_cycle for mc in db.query(Macrocycle).filter(Macrocycle.utilisateur_id == utilisateur_id).all()}
    crees = []
    debut_mc1 = date.today()
    debuts = {1: debut_mc1, 2: debut_mc1 + timedelta(weeks=8), 3: debut_mc1 + timedelta(weeks=16)}

    for numero_cycle in [1, 2, 3]:
        if numero_cycle in existants:
            continue
        debut = debuts[numero_cycle]
        mc = Macrocycle(
            utilisateur_id=user.id,
            numero_cycle=numero_cycle,
            date_debut=debut,
            date_fin=debut + timedelta(weeks=8),
        )
        db.add(mc)
        db.flush()
        for regle, date_sem in zip(BLUEPRINT_MACROCYCLE, generer_dates_semaines(debut)):
            db.add(SemaineEntrainement(
                macrocycle_id=mc.id,
                numero_semaine=regle.numero,
                macrophase=regle.macrophase,
                date_debut=date_sem,
                multiplicateur_volume=regle.multiplicateur_volume,
                objectif_km_course=regle.objectif_km_course,
                objectif_amrap_min=regle.objectif_amrap_min,
            ))
        crees.append(numero_cycle)

    db.commit()
    return {"macrocycles_crees": crees, "deja_existants": list(existants)}


@app.post("/api/admin/reseed", summary="Réinsère les exercices par défaut")
def reseed(db: Session = Depends(obtenir_session)):
    from models import VariationExercice
    from periodization_rules import EXERCICES_DEFAUT
    existants = {e.slug for e in db.query(VariationExercice).all()}
    nouveaux = 0
    for data in EXERCICES_DEFAUT:
        if data["slug"] in existants:
            continue
        e = VariationExercice(
            nom=data["nom"], slug=data["slug"],
            categorie_musculaire=data["categorie_musculaire"],
            niveau_progression=data["niveau_progression"],
            tempo=data.get("tempo"),
            pause_isometrique_sec=data.get("pause_isometrique_sec"),
            muscles_principaux=data.get("muscles_principaux"),
            est_mouvement_evaluation=data.get("est_mouvement_evaluation", False),
        )
        db.add(e)
        nouveaux += 1
    db.commit()
    total = db.query(VariationExercice).count()
    return {"inseres": nouveaux, "total_en_base": total}


@app.get("/api/exercices/evaluation", summary="Liste des exercices du protocole Max 1 min")
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


# ---------------------------------------------------------------------------
# Objectif course — race goal
# ---------------------------------------------------------------------------

class ObjectifCourseSchema(BaseModel):
    nom: str
    date_course: str  # dd/mm/yyyy
    distance_km: float
    dplus_m: Optional[int] = 0
    objectif_temps_min: int
    notes: Optional[str] = None


def _allures_depuis_objectif(distance_km: float, objectif_temps_min: int) -> dict:
    """Calcule les allures cibles Z2/Z4/Z5 depuis l'objectif de course."""
    allure_course = objectif_temps_min / distance_km  # min/km
    def fmt(m: float) -> str:
        mins = int(m); secs = int((m - mins) * 60)
        return f"{mins}:{secs:02d}/km"
    return {
        "course": fmt(allure_course),
        "z2":     fmt(allure_course * 1.30),
        "z4":     fmt(allure_course * 1.07),
        "z5":     fmt(allure_course * 0.92),
        "course_min_km": round(allure_course, 2),
    }


@app.get("/api/objectif-course", summary="Récupère le prochain objectif de course")
def get_objectif_course(utilisateur_id: int = Query(1), db: Session = Depends(obtenir_session)):
    obj = (
        db.query(ObjectifCourse)
        .filter(ObjectifCourse.utilisateur_id == utilisateur_id)
        .order_by(ObjectifCourse.cree_le.desc())
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="Aucun objectif de course enregistré")
    jours_restants = (obj.date_course - date.today()).days
    allures = _allures_depuis_objectif(obj.distance_km, obj.objectif_temps_min)
    h, m = divmod(obj.objectif_temps_min, 60)
    return {
        "id": obj.id,
        "nom": obj.nom,
        "date_course": obj.date_course.strftime("%d/%m/%Y"),
        "distance_km": obj.distance_km,
        "dplus_m": obj.dplus_m,
        "objectif_temps_min": obj.objectif_temps_min,
        "objectif_temps_str": f"{h}h{m:02d}" if h else f"{m} min",
        "jours_restants": jours_restants,
        "notes": obj.notes,
        "allures": allures,
    }


@app.post("/api/objectif-course", summary="Enregistre/remplace le prochain objectif de course")
def set_objectif_course(
    payload: ObjectifCourseSchema,
    utilisateur_id: int = Query(1),
    db: Session = Depends(obtenir_session),
):
    # Remplace l'objectif existant
    db.query(ObjectifCourse).filter(ObjectifCourse.utilisateur_id == utilisateur_id).delete()
    try:
        date_course = datetime.strptime(payload.date_course, "%d/%m/%Y").date()
    except ValueError:
        raise HTTPException(400, "Format de date invalide — attendu jj/mm/aaaa")
    obj = ObjectifCourse(
        utilisateur_id=utilisateur_id,
        nom=payload.nom,
        date_course=date_course,
        distance_km=payload.distance_km,
        dplus_m=payload.dplus_m or 0,
        objectif_temps_min=payload.objectif_temps_min,
        notes=payload.notes,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    allures = _allures_depuis_objectif(obj.distance_km, obj.objectif_temps_min)
    h, m = divmod(obj.objectif_temps_min, 60)
    return {
        "id": obj.id,
        "nom": obj.nom,
        "date_course": obj.date_course.strftime("%d/%m/%Y"),
        "distance_km": obj.distance_km,
        "dplus_m": obj.dplus_m,
        "objectif_temps_str": f"{h}h{m:02d}" if h else f"{m} min",
        "jours_restants": (obj.date_course - date.today()).days,
        "allures": allures,
    }


# ---------------------------------------------------------------------------
# Admin — reset macrocycles (dates)
# ---------------------------------------------------------------------------

@app.post("/api/admin/reset-macrocycles", summary="Recrée les 3 macrocycles depuis la date indiquée")
def reset_macrocycles(
    utilisateur_id: int = Query(1),
    date_debut: Optional[str] = Query(None, description="Date début au format jj/mm/aaaa (défaut : lundi prochain)"),
    db: Session = Depends(obtenir_session),
):
    from models import SemaineEntrainement
    from periodization_rules import BLUEPRINT_MACROCYCLE, generer_dates_semaines

    user = db.query(Utilisateur).filter(Utilisateur.id == utilisateur_id).first()
    if not user:
        raise HTTPException(404, f"Utilisateur {utilisateur_id} introuvable")

    # Calcul du lundi prochain si pas de date fournie
    if date_debut:
        try:
            debut_mc1 = datetime.strptime(date_debut, "%d/%m/%Y").date()
        except ValueError:
            raise HTTPException(400, "Format de date invalide — attendu jj/mm/aaaa")
    else:
        today = date.today()
        jours = (7 - today.weekday()) % 7 or 7  # lundi prochain
        debut_mc1 = today + timedelta(days=jours)

    # Suppression des macrocycles existants (cascade ORM)
    for mc in db.query(Macrocycle).filter(Macrocycle.utilisateur_id == utilisateur_id).all():
        db.delete(mc)
    db.flush()

    debuts = {1: debut_mc1, 2: debut_mc1 + timedelta(weeks=8), 3: debut_mc1 + timedelta(weeks=16)}
    crees = []
    for numero_cycle in [1, 2, 3]:
        debut = debuts[numero_cycle]
        mc = Macrocycle(
            utilisateur_id=user.id,
            numero_cycle=numero_cycle,
            date_debut=debut,
            date_fin=debut + timedelta(weeks=8),
        )
        db.add(mc)
        db.flush()
        for regle, date_sem in zip(BLUEPRINT_MACROCYCLE, generer_dates_semaines(debut)):
            db.add(SemaineEntrainement(
                macrocycle_id=mc.id,
                numero_semaine=regle.numero,
                macrophase=regle.macrophase,
                date_debut=date_sem,
                multiplicateur_volume=regle.multiplicateur_volume,
                objectif_km_course=regle.objectif_km_course,
                objectif_amrap_min=regle.objectif_amrap_min,
            ))
        crees.append({"numero_cycle": numero_cycle, "debut": debut.strftime("%d/%m/%Y")})

    db.commit()
    return {
        "message": "Macrocycles recréés. Lance maintenant /api/admin/seed-seances.",
        "macrocycles": crees,
    }


# ---------------------------------------------------------------------------
# Programme — initialisation depuis l'UI
# ---------------------------------------------------------------------------

class InitProgrammePayload(BaseModel):
    date_debut: str = Field(..., description="Date début du programme (lundi) au format jj/mm/aaaa")
    utilisateur_id: int = 1


@app.get("/api/programme/statut", summary="Statut du programme : existe-t-il ? quelle date de début ?")
def statut_programme(utilisateur_id: int = Query(1), db: Session = Depends(obtenir_session)):
    mcs = db.query(Macrocycle).filter(Macrocycle.utilisateur_id == utilisateur_id).order_by(Macrocycle.numero_cycle).all()
    if not mcs:
        return {"programme_existe": False}

    mc1 = mcs[0]
    mc_last = mcs[-1]
    obj = db.query(ObjectifCourse).filter(ObjectifCourse.utilisateur_id == utilisateur_id).order_by(ObjectifCourse.id.desc()).first()

    semaines_totales = sum(len(mc.semaines) for mc in mcs)
    return {
        "programme_existe": True,
        "date_debut": mc1.date_debut.strftime("%d/%m/%Y"),
        "date_fin": mc_last.date_fin.strftime("%d/%m/%Y"),
        "nb_modules": len(mcs),
        "semaines_totales": semaines_totales,
        "objectif_course": {
            "nom": obj.nom,
            "date_course": obj.date_course.strftime("%d/%m/%Y"),
            "distance_km": obj.distance_km,
        } if obj else None,
    }


@app.delete("/api/programme", summary="Supprime tous les macrocycles et séances de l'utilisateur")
def supprimer_programme(utilisateur_id: int = Query(1), db: Session = Depends(obtenir_session)):
    mcs = db.query(Macrocycle).filter(Macrocycle.utilisateur_id == utilisateur_id).all()
    for mc in mcs:
        db.delete(mc)
    db.commit()
    return {"message": f"{len(mcs)} macrocycle(s) supprimé(s)."}


@app.post("/api/programme/initialiser", summary="Génère le programme depuis la date choisie dans l'UI")
def initialiser_programme(payload: InitProgrammePayload, db: Session = Depends(obtenir_session)):
    from models import SemaineEntrainement
    from periodization_rules import (
        BLUEPRINT_MACROCYCLE, generer_dates_semaines, generer_blueprint_course,
    )
    from seed_seances import (
        MODULE1, MODULE2, MODULE3,
        _POOL_SURCHARGE, _semaine_course, _inserer_seances_en_session,
    )

    try:
        debut_mc1 = datetime.strptime(payload.date_debut, "%d/%m/%Y").date()
    except ValueError:
        raise HTTPException(400, "Format de date invalide — attendu jj/mm/aaaa")

    if debut_mc1.weekday() != 0:
        raise HTTPException(400, "La date de début doit être un lundi")

    user = db.query(Utilisateur).filter(Utilisateur.id == payload.utilisateur_id).first()
    if not user:
        raise HTTPException(404, f"Utilisateur {payload.utilisateur_id} introuvable")

    obj = db.query(ObjectifCourse).filter(
        ObjectifCourse.utilisateur_id == payload.utilisateur_id
    ).order_by(ObjectifCourse.id.desc()).first()

    # Suppression des macrocycles existants (cascade ORM — même session)
    for mc_old in db.query(Macrocycle).filter(Macrocycle.utilisateur_id == payload.utilisateur_id).all():
        db.delete(mc_old)
    db.flush()

    try:
        # ── CAS 1 : course planifiée → programme adaptatif N semaines ───────
        if obj:
            n_semaines = (obj.date_course - debut_mc1).days // 7
            if n_semaines < 4:
                raise HTTPException(400, f"La course est dans {n_semaines} semaine(s) — trop proche (minimum 4 semaines).")

            n_surcharge = n_semaines - 3
            blueprint = generer_blueprint_course(n_semaines)
            dates = [debut_mc1 + timedelta(weeks=i) for i in range(n_semaines)]

            mc = Macrocycle(
                utilisateur_id=user.id,
                numero_cycle=1,
                date_debut=debut_mc1,
                date_fin=debut_mc1 + timedelta(weeks=n_semaines),
            )
            db.add(mc)
            db.flush()
            for regle, date_sem in zip(blueprint, dates):
                db.add(SemaineEntrainement(
                    macrocycle_id=mc.id,
                    numero_semaine=regle.numero,
                    macrophase=regle.macrophase,
                    date_debut=date_sem,
                    multiplicateur_volume=regle.multiplicateur_volume,
                    objectif_km_course=regle.objectif_km_course,
                    objectif_amrap_min=regle.objectif_amrap_min,
                ))
            db.flush()

            # Contenu : pool surcharge + décharge M1S6 + affûtage M1S7 + semaine course
            content: dict = {}
            for i in range(1, n_surcharge + 1):
                content[i] = _POOL_SURCHARGE[min(i, 15)]
            content[n_surcharge + 1] = MODULE1[6]
            content[n_surcharge + 2] = MODULE1[7]
            content[n_semaines]      = _semaine_course(obj.date_course, obj.nom)

            _inserer_seances_en_session(db, mc, content)
            db.commit()

            return {
                "message": f"Programme orienté course généré : {n_semaines} semaines ({n_surcharge} de build + 2 de taper + semaine course).",
                "semaines_totales": n_semaines,
                "course": obj.nom,
            }

        # ── CAS 2 : pas de course → programme standard 3 × 8 semaines ───────
        mcs_crees = []
        for numero_cycle in range(1, 4):
            debut = debut_mc1 + timedelta(weeks=8 * (numero_cycle - 1))
            mc = Macrocycle(
                utilisateur_id=user.id,
                numero_cycle=numero_cycle,
                date_debut=debut,
                date_fin=debut + timedelta(weeks=8),
            )
            db.add(mc)
            db.flush()
            for regle, date_sem in zip(BLUEPRINT_MACROCYCLE, generer_dates_semaines(debut)):
                db.add(SemaineEntrainement(
                    macrocycle_id=mc.id,
                    numero_semaine=regle.numero,
                    macrophase=regle.macrophase,
                    date_debut=date_sem,
                    multiplicateur_volume=regle.multiplicateur_volume,
                    objectif_km_course=regle.objectif_km_course,
                    objectif_amrap_min=regle.objectif_amrap_min,
                ))
            db.flush()
            module_data = {1: MODULE1, 2: MODULE2, 3: MODULE3}[numero_cycle]
            _inserer_seances_en_session(db, mc, module_data)
            mcs_crees.append(numero_cycle)

        db.commit()
        return {
            "message": "Programme performance générale généré : 3 modules × 8 semaines.",
            "semaines_totales": 24,
        }

    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(500, detail=f"Erreur génération : {type(exc).__name__}: {exc}")


# ---------------------------------------------------------------------------
# Santé
# ---------------------------------------------------------------------------

@app.get("/", include_in_schema=False)
def racine():
    return {"statut": "Coach EPC opérationnel", "docs": "/docs"}


@app.get("/health", include_in_schema=False)
def sante():
    return {"statut": "ok", "timestamp": datetime.utcnow().isoformat()}
