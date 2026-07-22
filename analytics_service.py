"""
Service analytique EPC — prépare les métriques de la base de données
en structures JSON prêtes pour les bibliothèques de graphiques (Chart.js / Recharts).

Endpoints couverts :
    - Tendances physiologiques (VMA, Max 1 min)
    - Distribution du volume (km, D+, répartition musculaire Push/Pull/Jambes)
    - Biométrie de récupération (tendance RPE, Ratio Charge Aiguë/Chronique — ACWA)
"""

from __future__ import annotations

import json as _json
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
    # Seules les biométries issues d'un vrai test Demi-Cooper (liées à un ResultatDemiCooper)
    biometries = (
        db.query(BiometrieUtilisateur)
        .join(ResultatDemiCooper, ResultatDemiCooper.id_biometrie_instantanee == BiometrieUtilisateur.id)
        .filter(BiometrieUtilisateur.utilisateur_id == utilisateur_id)
        .order_by(BiometrieUtilisateur.enregistre_le)
        .all()
    )
    # Si aucun test réel, afficher la biométrie d'onboarding (la plus ancienne)
    if not biometries:
        bio_init = (
            db.query(BiometrieUtilisateur)
            .filter(BiometrieUtilisateur.utilisateur_id == utilisateur_id)
            .order_by(BiometrieUtilisateur.enregistre_le)
            .first()
        )
        biometries = [bio_init] if bio_init else []

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

        # Volume course depuis les journaux (séances validées uniquement)
        journaux_course = db.execute(
            select(JournalSeance)
            .join(SeanceEntrainement, JournalSeance.seance_id == SeanceEntrainement.id)
            .where(
                SeanceEntrainement.semaine_id == semaine.id,
                SeanceEntrainement.type_seance == TypeSeance.COURSE,
                JournalSeance.completee == True,
            )
        ).scalars().all()

        km_total = 0.0
        km_route = 0.0
        km_trail = 0.0
        dplus_total = 0
        for j in journaux_course:
            dplus_total += j.dplus_reel_m or 0
            km_j = 0.0
            if j.distance_reelle_km is not None:
                km_j = j.distance_reelle_km
            elif j.details_intervalles:
                try:
                    blocs = _json.loads(j.details_intervalles)
                    km_j = sum(b.get("distance_km") or 0 for b in blocs)
                    km_j += j.distance_repos_km or 0
                except Exception:
                    pass
            elif j.duree_reelle_min:
                km_j = j.duree_reelle_min * 10.0 / 60.0
            km_total += km_j
            if j.type_course == "trail":
                km_trail += km_j
            else:
                km_route += km_j

        class _StatsCourse:
            def __init__(self, km, km_r, km_t, dplus):
                self.km_total = km
                self.km_route = km_r
                self.km_trail = km_t
                self.dplus_total = dplus
        stats_course = _StatsCourse(round(km_total, 2), round(km_route, 2), round(km_trail, 2), dplus_total)

        # Volume vélo de route (séances VELO validées)
        journaux_velo = db.execute(
            select(JournalSeance)
            .join(SeanceEntrainement, JournalSeance.seance_id == SeanceEntrainement.id)
            .where(
                SeanceEntrainement.semaine_id == semaine.id,
                SeanceEntrainement.type_seance == TypeSeance.VELO,
                JournalSeance.completee == True,
            )
        ).scalars().all()
        km_velo = 0.0
        for j in journaux_velo:
            if j.distance_reelle_km is not None:
                km_velo += j.distance_reelle_km
        km_velo = round(km_velo, 2)

        volume_muscu = {cat.value: 0 for cat in CategorieMusculaire}

        # Cas 1 — exercices liés à une VariationExercice (poids du corps, barre, EMOM, AMRAP…)
        # COALESCE(series, 1) : pour EMOM/AMRAP où series=NULL, on compte 1 passage par exercice
        series_avec_cat = db.execute(
            select(
                VariationExercice.categorie_musculaire,
                func.sum(func.coalesce(ExerciceSeance.series, 1)).label("total_series"),
            )
            .join(SeanceEntrainement, ExerciceSeance.seance_id == SeanceEntrainement.id)
            .join(VariationExercice, ExerciceSeance.exercice_id == VariationExercice.id)
            .join(JournalSeance, JournalSeance.seance_id == SeanceEntrainement.id)
            .where(
                SeanceEntrainement.semaine_id == semaine.id,
                JournalSeance.completee == True,
                ExerciceSeance.exercice_id.is_not(None),
            )
            .group_by(VariationExercice.categorie_musculaire)
        ).all()
        for s in series_avec_cat:
            volume_muscu[s.categorie_musculaire.value] += s.total_series or 0

        # Cas 2 — exercices machines (exercice_id NULL) → catégorie inférée depuis le type de séance
        series_machines = db.execute(
            select(
                SeanceEntrainement.type_seance,
                func.sum(func.coalesce(ExerciceSeance.series, 1)).label("total_series"),
            )
            .join(ExerciceSeance, ExerciceSeance.seance_id == SeanceEntrainement.id)
            .join(JournalSeance, JournalSeance.seance_id == SeanceEntrainement.id)
            .where(
                SeanceEntrainement.semaine_id == semaine.id,
                JournalSeance.completee == True,
                ExerciceSeance.exercice_id.is_(None),
                SeanceEntrainement.type_seance.in_([
                    TypeSeance.GYM_UPPER, TypeSeance.GYM_LOWER, TypeSeance.GYM_FULL,
                ]),
            )
            .group_by(SeanceEntrainement.type_seance)
        ).all()
        for mr in series_machines:
            n = mr.total_series or 0
            if mr.type_seance == TypeSeance.GYM_UPPER:
                volume_muscu["push"] += n // 2
                volume_muscu["pull"] += n - n // 2
            elif mr.type_seance == TypeSeance.GYM_LOWER:
                volume_muscu["jambes"] += n
            elif mr.type_seance == TypeSeance.GYM_FULL:
                volume_muscu["push"] += n // 3
                volume_muscu["pull"] += n // 3
                volume_muscu["jambes"] += n - 2 * (n // 3)

        resultats.append(
            {
                "numero_semaine": semaine.numero_semaine,
                "numero_cycle": row.numero_cycle,
                "macrophase": semaine.macrophase.value,
                "date_debut": str(semaine.date_debut),
                "km_course": round(stats_course.km_total or 0.0, 2),
                "km_route": round(stats_course.km_route or 0.0, 2),
                "km_trail": round(stats_course.km_trail or 0.0, 2),
                "km_velo": km_velo,
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

    # Agréger par semaine (moyenne RPE réel et cible)
    from collections import defaultdict
    _RPE_PAR_ZONE = {"Z1": 5.0, "Z2": 6.0, "Z3": 7.0, "Z4": 8.0, "Z5": 9.0}
    _rpe_par_sem: dict[int, dict] = defaultdict(lambda: {"rpe_reel": [], "rpe_cible": []})
    for j in journaux:
        _rpe_par_sem[j.JournalSeance.seance.semaine.numero_semaine]["rpe_reel"].append(j.JournalSeance.rpe)
        rpe_c = j.JournalSeance.rpe_cible
        if rpe_c is None and j.JournalSeance.seance.zone_cible:
            rpe_c = _RPE_PAR_ZONE.get(j.JournalSeance.seance.zone_cible.value)
        if rpe_c is not None:
            _rpe_par_sem[j.JournalSeance.seance.semaine.numero_semaine]["rpe_cible"].append(rpe_c)

    tendance_rpe = [
        {
            "semaine": sem,
            "rpe_reel": round(sum(v["rpe_reel"]) / len(v["rpe_reel"]), 1) if v["rpe_reel"] else None,
            "rpe_cible": round(sum(v["rpe_cible"]) / len(v["rpe_cible"]), 1) if v["rpe_cible"] else None,
        }
        for sem, v in sorted(_rpe_par_sem.items())
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

    # --- Score de forme (readiness 0-100) ---
    # Basé sur le ratio ACWA courant et l'écart RPE réel/cible de la dernière semaine
    forme = None
    if acwa_data:
        dernier = acwa_data[-1]
        ratio_courant = dernier["ratio"]
        score = 100.0
        # Pénalité surcharge : ratio > 1.0 → jusqu'à -50 pts à ratio 1.5
        if ratio_courant > 1.0:
            score -= min(50.0, (ratio_courant - 1.0) * 100.0)
        # Pénalité sous-entraînement léger : ratio < 0.8 → -10 pts max
        elif ratio_courant < 0.8:
            score -= min(10.0, (0.8 - ratio_courant) * 50.0)
        # Pénalité RPE : réel > cible sur la dernière semaine → jusqu'à -30 pts
        if tendance_rpe:
            dernier_rpe = tendance_rpe[-1]
            if dernier_rpe["rpe_reel"] is not None and dernier_rpe["rpe_cible"] is not None:
                ecart = dernier_rpe["rpe_reel"] - dernier_rpe["rpe_cible"]
                if ecart > 0:
                    score -= min(30.0, ecart * 15.0)
        score = max(5.0, round(score))
        if score >= 75:
            message_forme = "Bonne forme — tu peux pousser 💪"
        elif score >= 50:
            message_forme = "Forme correcte — séance normale"
        elif score >= 30:
            message_forme = "Fatigue notable — allège la séance"
        else:
            message_forme = "Récupération recommandée — repos ou Z1"
        forme = {"score": int(score), "message": message_forme, "ratio": ratio_courant}

    return {
        "tendance_rpe": tendance_rpe,
        "acwa": acwa_data,
        "alerte_active": alerte_active,
        "message_alerte": message_alerte,
        "seuil_acwa": SEUIL_ACWA_RISQUE,
        "forme": forme,
    }


# ---------------------------------------------------------------------------
# Zones FC hebdomadaires — temps passé par zone cardiaque
# ---------------------------------------------------------------------------

def zones_fc_hebdo(db: Session, utilisateur_id: int) -> dict[str, Any]:
    """
    Minutes passées par zone FC (Z1-Z5) et par semaine, estimées depuis la FC
    moyenne des séances course (ou des blocs d'intervalles quand disponibles).
    """
    from models import Utilisateur

    # Bornes FC : dernière biométrie, sinon % FCmax utilisateur
    bio = (
        db.query(BiometrieUtilisateur)
        .filter(BiometrieUtilisateur.utilisateur_id == utilisateur_id)
        .order_by(BiometrieUtilisateur.enregistre_le.desc())
        .first()
    )
    user = db.get(Utilisateur, utilisateur_id)
    fc_max = (user.fc_max if user else None) or (bio.fc_max if bio else None)

    def _zone_depuis_fc(fc: float) -> str | None:
        if fc is None:
            return None
        if bio and bio.z1_fc_max:
            for z, borne in [("Z1", bio.z1_fc_max), ("Z2", bio.z2_fc_max), ("Z3", bio.z3_fc_max), ("Z4", bio.z4_fc_max)]:
                if fc <= borne:
                    return z
            return "Z5"
        if fc_max:
            pct = fc / fc_max
            if pct < 0.65: return "Z1"
            if pct < 0.75: return "Z2"
            if pct < 0.82: return "Z3"
            if pct < 0.89: return "Z4"
            return "Z5"
        return None

    _TYPES_AVEC_FC = [
        TypeSeance.COURSE,
        TypeSeance.EMOM,
        TypeSeance.AMRAP,
        TypeSeance.GYM_UPPER,
        TypeSeance.GYM_LOWER,
        TypeSeance.GYM_FULL,
    ]

    journaux = (
        db.execute(
            select(JournalSeance, SemaineEntrainement.numero_semaine)
            .join(SeanceEntrainement, JournalSeance.seance_id == SeanceEntrainement.id)
            .join(SemaineEntrainement, SeanceEntrainement.semaine_id == SemaineEntrainement.id)
            .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
            .where(
                Macrocycle.utilisateur_id == utilisateur_id,
                JournalSeance.completee == True,
                SeanceEntrainement.type_seance.in_(_TYPES_AVEC_FC),
            )
        )
        .all()
    )

    minutes_par_sem: dict[int, dict[str, float]] = defaultdict(lambda: {z: 0.0 for z in ["Z1", "Z2", "Z3", "Z4", "Z5"]})
    for row in journaux:
        j = row.JournalSeance
        sem = row.numero_semaine
        # Blocs d'intervalles détaillés : durée = distance / vitesse
        blocs_traites = False
        if j.details_intervalles:
            try:
                blocs = _json.loads(j.details_intervalles)
                for b in blocs:
                    fc = b.get("fc_moyenne_bpm")
                    dist = b.get("distance_km") or 0
                    vit = b.get("vitesse_kmh") or 0
                    if fc and dist and vit:
                        zone = _zone_depuis_fc(fc)
                        if zone:
                            minutes_par_sem[sem][zone] += dist / vit * 60.0
                            blocs_traites = True
            except Exception:
                pass
        if not blocs_traites and j.fc_moyenne_bpm and j.duree_reelle_min:
            zone = _zone_depuis_fc(j.fc_moyenne_bpm)
            if zone:
                minutes_par_sem[sem][zone] += j.duree_reelle_min

    return {
        "semaines": [
            {"numero_semaine": sem, **{z: round(v, 1) for z, v in zones.items()}}
            for sem, zones in sorted(minutes_par_sem.items())
        ],
        "fc_max_utilisee": fc_max,
    }


# ---------------------------------------------------------------------------
# Allure endurance — progression de l'allure en Z1/Z2
# ---------------------------------------------------------------------------

def allure_endurance(db: Session, utilisateur_id: int) -> dict[str, Any]:
    """
    Allure moyenne (min/km) des sorties Z1/Z2 complétées, dans le temps.
    Meilleur indicateur de progression aérobie entre deux tests VMA.
    """
    journaux = (
        db.execute(
            select(JournalSeance, SeanceEntrainement.date_seance, SeanceEntrainement.zone_cible)
            .join(SeanceEntrainement, JournalSeance.seance_id == SeanceEntrainement.id)
            .join(SemaineEntrainement, SeanceEntrainement.semaine_id == SemaineEntrainement.id)
            .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
            .where(
                Macrocycle.utilisateur_id == utilisateur_id,
                JournalSeance.completee == True,
                SeanceEntrainement.type_seance == TypeSeance.COURSE,
                JournalSeance.distance_reelle_km.is_not(None),
                JournalSeance.duree_reelle_min.is_not(None),
            )
            .order_by(SeanceEntrainement.date_seance)
        )
        .all()
    )

    points = []
    for row in journaux:
        j = row.JournalSeance
        zone = row.zone_cible.value if row.zone_cible else None
        if zone not in ("Z1", "Z2"):
            continue
        if not j.distance_reelle_km or j.distance_reelle_km <= 0:
            continue
        allure = j.duree_reelle_min / j.distance_reelle_km  # min/km
        if allure < 2.5 or allure > 12:  # valeurs aberrantes
            continue
        points.append(
            {
                "date": str(row.date_seance),
                "allure_min_km": round(allure, 2),
                "fc_moyenne": j.fc_moyenne_bpm,
                "distance_km": j.distance_reelle_km,
            }
        )
    return {"points": points}


# ---------------------------------------------------------------------------
# Prédiction de temps de course depuis la VMA
# ---------------------------------------------------------------------------

def _fraction_vma_soutenable(distance_km: float) -> float:
    """Fraction de VMA soutenable selon la distance (interpolation linéaire)."""
    reperes = [(5.0, 0.92), (10.0, 0.86), (21.1, 0.80), (42.2, 0.74)]
    if distance_km <= reperes[0][0]:
        return reperes[0][1]
    if distance_km >= reperes[-1][0]:
        return reperes[-1][1]
    for (d1, f1), (d2, f2) in zip(reperes, reperes[1:]):
        if d1 <= distance_km <= d2:
            return f1 + (f2 - f1) * (distance_km - d1) / (d2 - d1)
    return 0.80


def prediction_course(db: Session, utilisateur_id: int) -> dict[str, Any]:
    """
    Temps prédit sur l'objectif course pour chaque test VMA historique.
    Permet de tracer la convergence prédiction → objectif.
    """
    from models import ObjectifCourse

    objectif = (
        db.query(ObjectifCourse)
        .filter(ObjectifCourse.utilisateur_id == utilisateur_id)
        .order_by(ObjectifCourse.cree_le.desc())
        .first()
    )
    if not objectif:
        return {"objectif": None, "predictions": []}

    # Distance équivalente plat : +1 km par 100 m de D+
    distance_eff = objectif.distance_km + (objectif.dplus_m or 0) / 100.0
    fraction = _fraction_vma_soutenable(distance_eff)

    biometries = (
        db.query(BiometrieUtilisateur)
        .filter(BiometrieUtilisateur.utilisateur_id == utilisateur_id)
        .order_by(BiometrieUtilisateur.enregistre_le)
        .all()
    )
    # Déduplique par date : garde le dernier enregistrement de chaque jour
    seen: dict = {}
    for b in biometries:
        if b.vma_kmh and b.vma_kmh > 0:
            seen[b.enregistre_le.date()] = b

    predictions = []
    for date_key in sorted(seen):
        b = seen[date_key]
        temps_min = distance_eff / (b.vma_kmh * fraction) * 60.0
        predictions.append(
            {
                "date": str(date_key),
                "vma": b.vma_kmh,
                "temps_predit_min": round(temps_min, 1),
            }
        )

    return {
        "objectif": {
            "nom": objectif.nom,
            "date_course": str(objectif.date_course),
            "distance_km": objectif.distance_km,
            "dplus_m": objectif.dplus_m,
            "objectif_temps_min": objectif.objectif_temps_min,
        },
        "predictions": predictions,
    }


# ---------------------------------------------------------------------------
# Records personnels
# ---------------------------------------------------------------------------

def records_personnels(db: Session, utilisateur_id: int) -> dict[str, Any]:
    """Meilleures performances toutes séances confondues + jalons."""
    journaux = (
        db.execute(
            select(JournalSeance, SeanceEntrainement.date_seance, SeanceEntrainement.type_seance, SemaineEntrainement.numero_semaine, SemaineEntrainement.id.label("semaine_id"))
            .join(SeanceEntrainement, JournalSeance.seance_id == SeanceEntrainement.id)
            .join(SemaineEntrainement, SeanceEntrainement.semaine_id == SemaineEntrainement.id)
            .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
            .where(
                Macrocycle.utilisateur_id == utilisateur_id,
                JournalSeance.completee == True,
            )
            .order_by(SeanceEntrainement.date_seance)
        )
        .all()
    )

    plus_longue = None       # (km, date)
    plus_gros_dplus = None   # (m, date)
    plus_longue_duree = None # (min, date)
    km_par_semaine: dict[int, float] = defaultdict(float)
    semaines_actives: set[int] = set()

    # Records dédoublés par discipline (course / vélo)
    rec = {
        "course": {"longue": None, "dplus": None, "duree": None, "km_sem": defaultdict(float)},
        "velo":   {"longue": None, "dplus": None, "duree": None, "km_sem": defaultdict(float)},
    }

    for row in journaux:
        j = row.JournalSeance
        d = str(row.date_seance)
        semaines_actives.add(row.semaine_id)
        disc = "course" if row.type_seance == TypeSeance.COURSE else ("velo" if row.type_seance == TypeSeance.VELO else None)
        if j.distance_reelle_km:
            km_par_semaine[row.numero_semaine] += j.distance_reelle_km
            if plus_longue is None or j.distance_reelle_km > plus_longue[0]:
                plus_longue = (j.distance_reelle_km, d)
        if j.dplus_reel_m:
            if plus_gros_dplus is None or j.dplus_reel_m > plus_gros_dplus[0]:
                plus_gros_dplus = (j.dplus_reel_m, d)
        if j.duree_reelle_min:
            if plus_longue_duree is None or j.duree_reelle_min > plus_longue_duree[0]:
                plus_longue_duree = (j.duree_reelle_min, d)
        # Variante par discipline
        if disc:
            r = rec[disc]
            if j.distance_reelle_km:
                r["km_sem"][row.numero_semaine] += j.distance_reelle_km
                if r["longue"] is None or j.distance_reelle_km > r["longue"][0]:
                    r["longue"] = (j.distance_reelle_km, d)
            if j.dplus_reel_m and (r["dplus"] is None or j.dplus_reel_m > r["dplus"][0]):
                r["dplus"] = (j.dplus_reel_m, d)
            if j.duree_reelle_min and (r["duree"] is None or j.duree_reelle_min > r["duree"][0]):
                r["duree"] = (j.duree_reelle_min, d)

    meilleure_semaine = max(km_par_semaine.items(), key=lambda kv: kv[1]) if km_par_semaine else None

    def _split(disc: str) -> dict:
        r = rec[disc]
        best_sem = max(r["km_sem"].items(), key=lambda kv: kv[1]) if r["km_sem"] else None
        return {
            "plus_longue_sortie": {"km": round(r["longue"][0], 2), "date": r["longue"][1]} if r["longue"] else None,
            "plus_gros_dplus": {"m": r["dplus"][0], "date": r["dplus"][1]} if r["dplus"] else None,
            "plus_longue_duree": {"min": r["duree"][0], "date": r["duree"][1]} if r["duree"] else None,
            "meilleure_semaine": {"semaine": best_sem[0], "km": round(best_sem[1], 2)} if best_sem else None,
        }

    # VMA max historique
    vma_max = (
        db.query(func.max(BiometrieUtilisateur.vma_kmh))
        .filter(BiometrieUtilisateur.utilisateur_id == utilisateur_id)
        .scalar()
    )

    # Streak : semaines consécutives (par date_debut) avec au moins une séance complétée
    semaines_toutes = (
        db.execute(
            select(SemaineEntrainement.id, SemaineEntrainement.date_debut)
            .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
            .where(
                Macrocycle.utilisateur_id == utilisateur_id,
                SemaineEntrainement.date_debut <= date.today(),
            )
            .order_by(SemaineEntrainement.date_debut)
        )
        .all()
    )
    streak = 0
    for s in reversed(semaines_toutes):
        # ignorer la semaine en cours si pas encore de séance faite
        if s.id in semaines_actives:
            streak += 1
        elif s.date_debut <= date.today() - timedelta(days=7):
            break

    return {
        "plus_longue_sortie": {"km": round(plus_longue[0], 2), "date": plus_longue[1]} if plus_longue else None,
        "plus_gros_dplus": {"m": plus_gros_dplus[0], "date": plus_gros_dplus[1]} if plus_gros_dplus else None,
        "plus_longue_duree": {"min": plus_longue_duree[0], "date": plus_longue_duree[1]} if plus_longue_duree else None,
        "meilleure_semaine": {"semaine": meilleure_semaine[0], "km": round(meilleure_semaine[1], 2)} if meilleure_semaine else None,
        # Variantes par discipline (pour affichage course / vélo côte à côte)
        "course": _split("course"),
        "velo": _split("velo"),
        "vma_max": vma_max,
        "streak_semaines": streak,
        "seances_completees": len(journaux),
    }


# ---------------------------------------------------------------------------
# Semaine en cours — prévu vs réalisé
# ---------------------------------------------------------------------------

def semaine_en_cours(db: Session, utilisateur_id: int) -> dict[str, Any]:
    """Progression de la semaine calendaire en cours : km et séances, prévu vs fait."""
    aujourd_hui = date.today()
    semaine = (
        db.execute(
            select(SemaineEntrainement)
            .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
            .where(
                Macrocycle.utilisateur_id == utilisateur_id,
                SemaineEntrainement.date_debut <= aujourd_hui,
                SemaineEntrainement.date_debut > aujourd_hui - timedelta(days=7),
            )
        )
        .scalars()
        .first()
    )
    if not semaine:
        return {"semaine": None}

    seances = (
        db.execute(
            select(SeanceEntrainement)
            .where(
                SeanceEntrainement.semaine_id == semaine.id,
                SeanceEntrainement.type_seance.not_in([TypeSeance.REPOS]),
            )
        )
        .scalars()
        .all()
    )
    km_prevu = sum(s.distance_cible_km or 0 for s in seances if s.type_seance == TypeSeance.COURSE)
    seances_prevues = len(seances)

    journaux = (
        db.execute(
            select(JournalSeance)
            .join(SeanceEntrainement, JournalSeance.seance_id == SeanceEntrainement.id)
            .where(
                SeanceEntrainement.semaine_id == semaine.id,
                JournalSeance.completee == True,
            )
        )
        .scalars()
        .all()
    )
    km_fait = sum(j.distance_reelle_km or 0 for j in journaux)
    seances_faites = len(journaux)
    jours_restants = (semaine.date_debut + timedelta(days=7) - aujourd_hui).days

    return {
        "semaine": {
            "numero_semaine": semaine.numero_semaine,
            "date_debut": str(semaine.date_debut),
            "macrophase": semaine.macrophase.value,
            "km_prevu": round(km_prevu, 1),
            "km_fait": round(km_fait, 1),
            "seances_prevues": seances_prevues,
            "seances_faites": seances_faites,
            "jours_restants": jours_restants,
        }
    }


# ---------------------------------------------------------------------------
# Résumé hebdomadaire — bilan de la dernière semaine terminée
# ---------------------------------------------------------------------------

def resume_hebdo(db: Session, utilisateur_id: int) -> dict[str, Any]:
    """Bilan de la dernière semaine terminée + tendance vs la précédente."""
    aujourd_hui = date.today()
    semaines = (
        db.execute(
            select(SemaineEntrainement)
            .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
            .where(
                Macrocycle.utilisateur_id == utilisateur_id,
                SemaineEntrainement.date_debut <= aujourd_hui - timedelta(days=7),
            )
            .order_by(SemaineEntrainement.date_debut.desc())
            .limit(2)
        )
        .scalars()
        .all()
    )
    if not semaines:
        return {"resume": None}

    def _stats_semaine(sem: SemaineEntrainement) -> dict:
        journaux = (
            db.execute(
                select(JournalSeance)
                .join(SeanceEntrainement, JournalSeance.seance_id == SeanceEntrainement.id)
                .where(SeanceEntrainement.semaine_id == sem.id, JournalSeance.completee == True)
            )
            .scalars()
            .all()
        )
        seances_prevues = (
            db.execute(
                select(func.count(SeanceEntrainement.id))
                .where(
                    SeanceEntrainement.semaine_id == sem.id,
                    SeanceEntrainement.type_seance.not_in([TypeSeance.REPOS]),
                )
            )
            .scalar()
        )
        km = sum(j.distance_reelle_km or 0 for j in journaux)
        rpes = [j.rpe for j in journaux if j.rpe is not None]
        return {
            "km": round(km, 1),
            "seances_faites": len(journaux),
            "seances_prevues": seances_prevues or 0,
            "rpe_moyen": round(sum(rpes) / len(rpes), 1) if rpes else None,
        }

    courante = _stats_semaine(semaines[0])
    precedente = _stats_semaine(semaines[1]) if len(semaines) > 1 else None
    delta_km = round(courante["km"] - precedente["km"], 1) if precedente else None

    # Message de synthèse
    taux = courante["seances_faites"] / courante["seances_prevues"] if courante["seances_prevues"] else 0
    if taux >= 1:
        message = "Semaine complète, bravo ✅"
    elif taux >= 0.7:
        message = "Bonne semaine — presque toutes les séances faites"
    elif taux > 0:
        message = "Semaine partielle — essaie de caler les séances manquées"
    else:
        message = "Aucune séance validée la semaine dernière"

    return {
        "resume": {
            "numero_semaine": semaines[0].numero_semaine,
            "date_debut": str(semaines[0].date_debut),
            **courante,
            "delta_km": delta_km,
            "message": message,
        }
    }


# ---------------------------------------------------------------------------
# Événements — tests, courses, pour annoter les graphiques
# ---------------------------------------------------------------------------

def evenements(db: Session, utilisateur_id: int) -> dict[str, Any]:
    """Événements (tests d'évaluation, objectif course) mappés sur les numéros de semaine."""
    from models import JournalEvaluationSeance as _JES, ObjectifCourse

    semaines = (
        db.execute(
            select(SemaineEntrainement.numero_semaine, SemaineEntrainement.date_debut)
            .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
            .where(Macrocycle.utilisateur_id == utilisateur_id)
            .order_by(SemaineEntrainement.date_debut)
        )
        .all()
    )

    def _semaine_pour(d: date) -> int | None:
        for s in semaines:
            if s.date_debut <= d < s.date_debut + timedelta(days=7):
                return s.numero_semaine
        return None

    evts = []
    evaluations = (
        db.query(_JES)
        .filter(_JES.utilisateur_id == utilisateur_id)
        .order_by(_JES.evalue_le)
        .all()
    )
    for ev in evaluations:
        sem = _semaine_pour(ev.evalue_le.date())
        if sem is not None:
            evts.append({"semaine": sem, "type": "test", "label": "🧪 Test", "date": str(ev.evalue_le.date())})

    objectif = (
        db.query(ObjectifCourse)
        .filter(ObjectifCourse.utilisateur_id == utilisateur_id)
        .order_by(ObjectifCourse.cree_le.desc())
        .first()
    )
    if objectif:
        sem = _semaine_pour(objectif.date_course)
        if sem is not None:
            evts.append({"semaine": sem, "type": "course", "label": "🏁 Course", "date": str(objectif.date_course)})

    return {"evenements": evts}


# ---------------------------------------------------------------------------
# Détail des séances d'une semaine (pour le clic sur un graphique)
# ---------------------------------------------------------------------------

def seances_semaine(db: Session, utilisateur_id: int, numero_semaine: int) -> dict[str, Any]:
    """Liste des séances (planifiées + réalisées) de la semaine donnée."""
    rows = (
        db.execute(
            select(SeanceEntrainement, SemaineEntrainement.date_debut)
            .join(SemaineEntrainement, SeanceEntrainement.semaine_id == SemaineEntrainement.id)
            .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
            .where(
                Macrocycle.utilisateur_id == utilisateur_id,
                SemaineEntrainement.numero_semaine == numero_semaine,
            )
            .order_by(SeanceEntrainement.date_seance)
        )
        .all()
    )
    seances = []
    for row in rows:
        s = row.SeanceEntrainement
        if s.type_seance == TypeSeance.REPOS:
            continue
        j = s.journal
        seances.append(
            {
                "id": s.id,
                "date": str(s.date_seance),
                "titre": s.titre,
                "type_seance": s.type_seance.value,
                "zone_cible": s.zone_cible.value if s.zone_cible else None,
                "completee": bool(j and j.completee),
                "distance_km": j.distance_reelle_km if j else None,
                "duree_min": j.duree_reelle_min if j else None,
                "rpe": j.rpe if j else None,
            }
        )
    return {"numero_semaine": numero_semaine, "seances": seances}
