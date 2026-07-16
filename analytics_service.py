"""
Service analytique EPC — prépare les métriques de la base de données
en structures JSON prêtes pour les bibliothèques de graphiques (Chart.js / Recharts).

Endpoints couverts :
    - Tendances physiologiques (VMA, Max 1 min)
    - Distribution du volume (km, D+, répartition musculaire Push/Pull/Jambes)
    - Biométrie de récupération (tendance RPE, Ratio Charge Aiguë/Chronique — ACWA)
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models import (
    BiometrieUtilisateur,
    CategorieMusculaire,
    ExerciceSeance,
    JournalEvaluationSeance,
    JournalSeance,
    Macrocycle,
    ResultatDemiCooper,
    ResultatMax1Min,
    SeanceEntrainement,
    SemaineEntrainement,
    TypeSeance,
    VariationExercice,
)

# Seuil ACWA au-delà duquel le risque de blessure est élevé
SEUIL_ACWA_RISQUE = 1.5
# Fenêtre de charge chronique (semaines)
FENETRE_CHRONIQUE_SEMAINES = 4


# ---------------------------------------------------------------------------
# Tendances physiologiques
# ---------------------------------------------------------------------------

def tendances_physiologiques(db: Session, utilisateur_id: int) -> dict[str, Any]:
    """
    Retourne l'évolution de la VMA et des scores Max 1 min au fil des macrocycles.

    Format de sortie :
    {
        "vma": [{"date": "2024-01-15", "valeur": 14.5, "numero_cycle": 1}, ...],
        "max_1min": {
            "traction-stricte": [{"date": "...", "repetitions": 12, "numero_cycle": 1}, ...],
            ...
        }
    }
    """
    # --- Historique VMA ---
    biometries = (
        db.query(BiometrieUtilisateur)
        .filter(BiometrieUtilisateur.utilisateur_id == utilisateur_id)
        .order_by(BiometrieUtilisateur.enregistre_le)
        .all()
    )

    def _kmh_to_pace(kmh: float) -> str:
        if kmh <= 0:
            return "—"
        total_sec = 3600 / kmh
        mins = int(total_sec // 60)
        secs = int(total_sec % 60)
        return f"{mins}:{secs:02d}"

    historique_vma = [
        {
            "date": str(b.enregistre_le.date()),
            "valeur": b.vma_kmh,
            "numero_cycle": None,
            "zones": {
                "Z1": [b.z1_min_kmh, b.z1_max_kmh],
                "Z2": [b.z2_min_kmh, b.z2_max_kmh],
                "Z3": [b.z3_min_kmh, b.z3_max_kmh],
                "Z4": [b.z4_min_kmh, b.z4_max_kmh],
                "Z5": [b.z5_min_kmh, b.z5_max_kmh],
            },
            "zones_pace": {
                "Z1": [_kmh_to_pace(b.z1_max_kmh), _kmh_to_pace(b.z1_min_kmh)],
                "Z2": [_kmh_to_pace(b.z2_max_kmh), _kmh_to_pace(b.z2_min_kmh)],
                "Z3": [_kmh_to_pace(b.z3_max_kmh), _kmh_to_pace(b.z3_min_kmh)],
                "Z4": [_kmh_to_pace(b.z4_max_kmh), _kmh_to_pace(b.z4_min_kmh)],
                "Z5": [_kmh_to_pace(b.z5_max_kmh), _kmh_to_pace(b.z5_min_kmh)],
            },
            "zones_fc": {
                "Z1": [b.z1_fc_min, b.z1_fc_max],
                "Z2": [b.z2_fc_min, b.z2_fc_max],
                "Z3": [b.z3_fc_min, b.z3_fc_max],
                "Z4": [b.z4_fc_min, b.z4_fc_max],
                "Z5": [b.z5_fc_min, b.z5_fc_max],
            },
            "fc_max": b.fc_max,
        }
        for b in biometries
    ]

    # --- Historique Max 1 min par mouvement ---
    resultats_1min = (
        db.query(ResultatMax1Min, VariationExercice, JournalEvaluationSeance)
        .join(VariationExercice, ResultatMax1Min.exercice_id == VariationExercice.id)
        .join(JournalEvaluationSeance, ResultatMax1Min.evaluation_id == JournalEvaluationSeance.id)
        .filter(JournalEvaluationSeance.utilisateur_id == utilisateur_id)
        .order_by(JournalEvaluationSeance.evalue_le)
        .all()
    )

    historique_1min: dict[str, list] = defaultdict(list)
    for r, ex, ev in resultats_1min:
        historique_1min[ex.slug].append(
            {
                "date": str(ev.evalue_le.date()),
                "repetitions": r.repetitions_realisees,
                "numero_cycle": None,
                "mouvement": ex.nom,
            }
        )

    return {
        "vma": historique_vma,
        "max_1min": dict(historique_1min),
    }


# ---------------------------------------------------------------------------
# Distribution du volume
# ---------------------------------------------------------------------------

def distribution_volume(
    db: Session,
    utilisateur_id: int,
    macrocycle_id: int | None = None,
) -> dict[str, Any]:
    """
    Retourne la répartition hebdomadaire du volume course et musculation.

    Format de sortie :
    {
        "semaines": [
            {
                "numero_semaine": 1,
                "macrophase": "surcharge",
                "km_course": 18.4,
                "dplus_m": 120,
                "volume_muscu": {"push": 24, "pull": 20, "jambes": 18, "gainage": 10}
            },
            ...
        ]
    }
    """
    filtre_macrocycle = (
        [Macrocycle.id == macrocycle_id] if macrocycle_id else []
    )

    semaines = (
        db.execute(
            select(SemaineEntrainement, Macrocycle.numero_cycle)
            .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
            .where(Macrocycle.utilisateur_id == utilisateur_id, *filtre_macrocycle)
            .order_by(Macrocycle.numero_cycle, SemaineEntrainement.numero_semaine)
        )
        .all()
    )

    resultats = []
    for row in semaines:
        semaine = row.SemaineEntrainement

        # Volume course depuis les journaux
        stats_course = db.execute(
            select(
                func.sum(JournalSeance.distance_reelle_km).label("km_total"),
                func.sum(JournalSeance.dplus_reel_m).label("dplus_total"),
            )
            .join(SeanceEntrainement, JournalSeance.seance_id == SeanceEntrainement.id)
            .where(
                SeanceEntrainement.semaine_id == semaine.id,
                SeanceEntrainement.type_seance == TypeSeance.COURSE,
            )
        ).one()

        # Volume musculaire — séries par catégorie (depuis les ExerciceSeance des séances validées)
        series_par_categorie = db.execute(
            select(
                VariationExercice.categorie_musculaire,
                func.sum(ExerciceSeance.series).label("total_series"),
            )
            .join(SeanceEntrainement, ExerciceSeance.seance_id == SeanceEntrainement.id)
            .join(VariationExercice, ExerciceSeance.exercice_id == VariationExercice.id)
            .join(JournalSeance, JournalSeance.seance_id == SeanceEntrainement.id)
            .where(
                SeanceEntrainement.semaine_id == semaine.id,
                JournalSeance.completee == True,
            )
            .group_by(VariationExercice.categorie_musculaire)
        ).all()

        volume_muscu = {cat.value: 0 for cat in CategorieMusculaire}
        for s in series_par_categorie:
            volume_muscu[s.categorie_musculaire.value] = s.total_series

        resultats.append(
            {
                "numero_semaine": semaine.numero_semaine,
                "numero_cycle": row.numero_cycle,
                "macrophase": semaine.macrophase.value,
                "date_debut": str(semaine.date_debut),
                "km_course": round(stats_course.km_total or 0.0, 2),
                "dplus_m": stats_course.dplus_total or 0,
                "multiplicateur_volume": semaine.multiplicateur_volume,
                "volume_muscu": volume_muscu,
            }
        )

    return {"semaines": resultats}


# ---------------------------------------------------------------------------
# Biométrie de récupération — RPE & ACWA
# ---------------------------------------------------------------------------

def biometrie_recuperation(
    db: Session,
    utilisateur_id: int,
    macrocycle_id: int | None = None,
) -> dict[str, Any]:
    """
    Retourne :
    1. Tendance RPE réel vs RPE cible par séance
    2. Ratio Charge Aiguë / Chronique (ACWA) semaine par semaine
       avec drapeau de risque si ACWA > 1.5

    Format de sortie :
    {
        "tendance_rpe": [
            {"date": "...", "titre_seance": "...", "rpe_reel": 7.5, "rpe_cible": 7.0}, ...
        ],
        "acwa": [
            {
                "semaine": 4, "date_debut": "...",
                "charge_aigue_km": 21.0, "charge_chronique_km": 16.2,
                "ratio": 1.30, "alerte_risque": false
            },
            ...
        ],
        "alerte_active": false,
        "message_alerte": null
    }
    """
    filtre = [JournalSeance.utilisateur_id == utilisateur_id]
    if macrocycle_id:
        filtre.append(Macrocycle.id == macrocycle_id)

    # --- Tendance RPE ---
    journaux = (
        db.execute(
            select(JournalSeance, SeanceEntrainement.titre, SeanceEntrainement.date_seance)
            .join(SeanceEntrainement, JournalSeance.seance_id == SeanceEntrainement.id)
            .join(SemaineEntrainement, SeanceEntrainement.semaine_id == SemaineEntrainement.id)
            .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
            .where(
                JournalSeance.utilisateur_id == utilisateur_id,
                JournalSeance.rpe.is_not(None),
                *([] if not macrocycle_id else [Macrocycle.id == macrocycle_id]),
            )
            .order_by(SeanceEntrainement.date_seance)
        )
        .all()
    )

    tendance_rpe = [
        {
            "date": str(j.date_seance),
            "titre_seance": j.titre or "Séance",
            "rpe_reel": j.JournalSeance.rpe,
            "rpe_cible": j.JournalSeance.rpe_cible,
            "ecart": (
                round(j.JournalSeance.rpe - j.JournalSeance.rpe_cible, 1)
                if j.JournalSeance.rpe_cible
                else None
            ),
        }
        for j in journaux
    ]

    # --- Calcul ACWA ---
    # Charge = km course par semaine (proxy de charge externe)
    semaines = (
        db.execute(
            select(
                SemaineEntrainement.id,
                SemaineEntrainement.numero_semaine,
                SemaineEntrainement.date_debut,
                func.sum(JournalSeance.distance_reelle_km).label("km_semaine"),
            )
            .join(SeanceEntrainement, SeanceEntrainement.semaine_id == SemaineEntrainement.id)
            .join(JournalSeance, JournalSeance.seance_id == SeanceEntrainement.id)
            .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
            .where(
                Macrocycle.utilisateur_id == utilisateur_id,
                *([] if not macrocycle_id else [Macrocycle.id == macrocycle_id]),
            )
            .group_by(SemaineEntrainement.id, SemaineEntrainement.numero_semaine, SemaineEntrainement.date_debut)
            .order_by(SemaineEntrainement.date_debut)
        )
        .all()
    )

    acwa_data = []
    alerte_active = False
    message_alerte = None

    for i, semaine in enumerate(semaines):
        charge_aigue = semaine.km_semaine or 0.0

        # Charge chronique = moyenne des 4 semaines précédentes
        debut_fenetre = max(0, i - FENETRE_CHRONIQUE_SEMAINES)
        semaines_chronique = semaines[debut_fenetre:i]
        if semaines_chronique:
            charge_chronique = sum(
                s.km_semaine or 0.0 for s in semaines_chronique
            ) / len(semaines_chronique)
        else:
            charge_chronique = charge_aigue  # première semaine : ratio neutre

        ratio = round(charge_aigue / charge_chronique, 2) if charge_chronique > 0 else 1.0
        alerte = ratio > SEUIL_ACWA_RISQUE

        if alerte:
            alerte_active = True
            message_alerte = (
                f"Risque élevé de blessure détecté (ACWA = {ratio}). "
                "Le volume de la prochaine semaine sera automatiquement plafonné."
            )

        acwa_data.append(
            {
                "semaine": semaine.numero_semaine,
                "date_debut": str(semaine.date_debut),
                "charge_aigue_km": round(charge_aigue, 2),
                "charge_chronique_km": round(charge_chronique, 2),
                "ratio": ratio,
                "alerte_risque": alerte,
            }
        )

    return {
        "tendance_rpe": tendance_rpe,
        "acwa": acwa_data,
        "alerte_active": alerte_active,
        "message_alerte": message_alerte,
        "seuil_acwa": SEUIL_ACWA_RISQUE,
    }
