"""
Seed des séances EPC — 8 semaines complètes.
Basé sur la méthodologie MODULE 1 (Adaptation) et MODULE 2 (Révélation).

Structure hebdomadaire :
    Lundi    : Course Z2 (endurance fondamentale)
    Mardi    : Musculation AMRAP
    Mercredi : Repos
    Jeudi    : Course intervalles Z4/Z5
    Vendredi : Musculation EMOM
    Samedi   : Course longue Z2/Z3
    Dimanche : Repos

Semaines 1-5 : Surcharge progressive
Semaines 6-7 : Décharge
Semaine 8    : Évaluation
"""

from datetime import date, timedelta
from database import SessionLocal, creer_tables
from models import (
    Macrocycle, SemaineEntrainement, SeanceEntrainement,
    ExerciceSeance, VariationExercice, TypeSeance, ZoneCourse
)

# ---------------------------------------------------------------------------
# Blueprint des séances par semaine
# ---------------------------------------------------------------------------

SEANCES_PAR_SEMAINE = {
    # -----------------------------------------------------------------------
    # SEMAINE 1 — Adaptation (AMRAP 20 min)
    # -----------------------------------------------------------------------
    1: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Endurance fondamentale Z2",
            "zone": ZoneCourse.Z2, "duree_min": 30, "description":
            "Allure conversationnelle. Objectif : rester en Z2 toute la sortie. Respiration nasale prioritaire."
        },
        {
            "jour": 2, "type": TypeSeance.AMRAP, "titre": "AMRAP 20 min — Circuit 1",
            "temps_limite": 20, "description":
            "Tempo strict sur chaque mouvement. Focus technique avant la vitesse.",
            "exercices": [
                {"slug": "traction-stricte", "reps": 5, "tempo": "X/1/2/0"},
                {"slug": "pompe-standard", "reps": 10, "tempo": "2/1/X/0"},
                {"slug": "squat-bw", "reps": 15, "tempo": "3/1/X/0"},
                {"slug": "dip-parallettes", "reps": 8, "tempo": "2/1/X/0"},
                {"slug": "mountain-climber", "reps": 10, "tempo": "X/0/X/0"},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.COURSE, "titre": "Intervalles courts Z4",
            "zone": ZoneCourse.Z4, "duree_min": 25, "description":
            "Échauffement 8 min Z1/Z2. 6 x 1 min Z4 / 1 min récup Z1. Retour calme 5 min."
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM 16 min — Technique",
            "temps_limite": 16, "description":
            "4 rounds de 4 min. Chaque minute : 1 mouvement. Focus amplitude et tempo.",
            "exercices": [
                {"slug": "traction-australienne", "reps": 8, "tempo": "X/1/2/0"},
                {"slug": "pompe-standard", "reps": 12, "tempo": "2/0/X/0"},
                {"slug": "squat-bw", "reps": 15, "tempo": "2/1/X/0"},
                {"slug": "abdominal-crunch", "reps": 15, "tempo": "2/0/2/0"},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue Z2",
            "zone": ZoneCourse.Z2, "distance_km": 8.0, "description":
            "Sortie longue à allure facile. Maintien Z2 strict. Hydratation toutes les 20 min."
        },
    ],

    # -----------------------------------------------------------------------
    # SEMAINE 2 — Adaptation (AMRAP 22 min)
    # -----------------------------------------------------------------------
    2: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Endurance fondamentale Z2",
            "zone": ZoneCourse.Z2, "duree_min": 35, "description":
            "5 min de plus que la semaine 1. Allure identique, volume augmenté."
        },
        {
            "jour": 2, "type": TypeSeance.AMRAP, "titre": "AMRAP 22 min — Circuit 1",
            "temps_limite": 22, "description":
            "Même circuit que S1 + 2 min. Maintien du tempo strict.",
            "exercices": [
                {"slug": "traction-stricte", "reps": 5, "tempo": "X/1/2/0"},
                {"slug": "pompe-standard", "reps": 10, "tempo": "2/1/X/0"},
                {"slug": "squat-bw", "reps": 15, "tempo": "3/1/X/0"},
                {"slug": "dip-parallettes", "reps": 8, "tempo": "2/1/X/0"},
                {"slug": "mountain-climber", "reps": 10, "tempo": "X/0/X/0"},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.COURSE, "titre": "Intervalles Z4 — progression",
            "zone": ZoneCourse.Z4, "duree_min": 30, "description":
            "Échauffement 8 min. 8 x 1 min Z4 / 1 min récup Z1. Retour calme 5 min."
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM 20 min — Technique",
            "temps_limite": 20, "description":
            "5 rounds de 4 min. Introduction de la pause isométrique sur les tractions.",
            "exercices": [
                {"slug": "traction-stricte", "reps": 6, "tempo": "X/1/2/0", "pause_iso": 1.0},
                {"slug": "pompe-standard", "reps": 12, "tempo": "2/1/X/0"},
                {"slug": "squat-bw", "reps": 15, "tempo": "3/1/X/0"},
                {"slug": "abdominal-crunch", "reps": 15, "tempo": "2/0/2/0"},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue Z2",
            "zone": ZoneCourse.Z2, "distance_km": 10.0, "description":
            "Sortie longue +2 km vs S1. Même allure Z2."
        },
    ],

    # -----------------------------------------------------------------------
    # SEMAINE 3 — Adaptation (AMRAP 25 min) — Introduction tempos stricts
    # -----------------------------------------------------------------------
    3: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Endurance + accélérations Z2/Z3",
            "zone": ZoneCourse.Z2, "duree_min": 35, "description":
            "30 min Z2 + 3 x 2 min en Z3 intégrées. Introduction progressive du seuil."
        },
        {
            "jour": 2, "type": TypeSeance.AMRAP, "titre": "AMRAP 25 min — Tempos stricts",
            "temps_limite": 25, "description":
            "Tempos renforcés. Pause isométrique sur dips et tractions. Qualité > quantité.",
            "exercices": [
                {"slug": "traction-stricte", "reps": 6, "tempo": "X/1/2/0", "pause_iso": 1.0},
                {"slug": "pompe-standard", "reps": 10, "tempo": "3/1/X/0"},
                {"slug": "squat-bw", "reps": 15, "tempo": "3/2/X/0"},
                {"slug": "dip-parallettes", "reps": 8, "tempo": "3/1/X/0", "pause_iso": 1.0},
                {"slug": "burpee", "reps": 8, "tempo": "X/0/X/0"},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.COURSE, "titre": "Seuil Z3/Z4",
            "zone": ZoneCourse.Z3, "duree_min": 35, "description":
            "Échauffement 8 min. 3 x 5 min Z3 / 2 min récup Z1. 2 x 2 min Z4 / 2 min récup. Retour 5 min."
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM 20 min — Force",
            "temps_limite": 20, "description":
            "Focus gainage et force. Tempos lents sur toutes les phases excentriques.",
            "exercices": [
                {"slug": "traction-stricte", "reps": 5, "tempo": "X/2/3/0", "pause_iso": 1.0},
                {"slug": "dip-parallettes", "reps": 8, "tempo": "3/1/X/0"},
                {"slug": "squat-bw", "reps": 20, "tempo": "3/1/X/0"},
                {"slug": "abdominal-crunch", "reps": 20, "tempo": "2/1/2/0"},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue Z2",
            "zone": ZoneCourse.Z2, "distance_km": 12.0, "description":
            "Sortie longue. Objectif : maintien Z2 strict sur la totalité."
        },
    ],

    # -----------------------------------------------------------------------
    # SEMAINE 4 — Surcharge peak (AMRAP 28 min)
    # -----------------------------------------------------------------------
    4: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Endurance Z2 + tempo",
            "zone": ZoneCourse.Z2, "duree_min": 40, "description":
            "35 min Z2 + 5 min Z3 en fin de sortie. Pic de volume aérobie."
        },
        {
            "jour": 2, "type": TypeSeance.AMRAP, "titre": "AMRAP 28 min — Intensité maximale",
            "temps_limite": 28, "description":
            "Pic de charge musculaire. Tempos exigeants, pauses iso systématiques sur PULL/PUSH.",
            "exercices": [
                {"slug": "traction-stricte", "reps": 6, "tempo": "X/2/3/0", "pause_iso": 1.0},
                {"slug": "pompe-standard", "reps": 10, "tempo": "3/1/X/0"},
                {"slug": "squat-bw", "reps": 20, "tempo": "3/2/X/0"},
                {"slug": "dip-parallettes", "reps": 8, "tempo": "3/2/X/0", "pause_iso": 1.0},
                {"slug": "burpee", "reps": 10, "tempo": "X/0/X/0"},
                {"slug": "mountain-climber", "reps": 10, "tempo": "X/0/X/0"},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.COURSE, "titre": "Intervalles Z4/Z5",
            "zone": ZoneCourse.Z4, "duree_min": 40, "description":
            "Échauffement 10 min. 4 x 3 min Z4 / 2 min récup. 4 x 30 sec Z5 / 90 sec récup. Retour 8 min."
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM 24 min — Force/Endurance",
            "temps_limite": 24, "description":
            "6 rounds. Mix force et gainage. Tempos lents maintenus.",
            "exercices": [
                {"slug": "traction-stricte", "reps": 6, "tempo": "X/2/3/0", "pause_iso": 1.0},
                {"slug": "dip-parallettes", "reps": 10, "tempo": "3/1/X/0", "pause_iso": 1.0},
                {"slug": "squat-bw", "reps": 20, "tempo": "3/2/X/0"},
                {"slug": "abdominal-crunch", "reps": 20, "tempo": "2/1/2/0"},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue Z2/Z3",
            "zone": ZoneCourse.Z2, "distance_km": 14.0, "description":
            "12 km Z2 + 2 km Z3 en fin. Pic de volume course de la phase surcharge."
        },
    ],

    # -----------------------------------------------------------------------
    # SEMAINE 5 — Consolidation (AMRAP 33 min) — Pic total
    # -----------------------------------------------------------------------
    5: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Endurance Z2",
            "zone": ZoneCourse.Z2, "duree_min": 40, "description":
            "Maintien du volume S4. Récupération active entre les blocs d'intensité."
        },
        {
            "jour": 2, "type": TypeSeance.AMRAP, "titre": "AMRAP 33 min — Pic musculaire",
            "temps_limite": 33, "description":
            "AMRAP le plus long du programme. Gestion de l'effort sur la durée. Tempos maintenus même en fatigue.",
            "exercices": [
                {"slug": "traction-stricte", "reps": 6, "tempo": "X/2/3/0", "pause_iso": 1.0},
                {"slug": "pompe-standard", "reps": 10, "tempo": "3/1/X/0"},
                {"slug": "squat-bw", "reps": 20, "tempo": "3/2/X/0"},
                {"slug": "dip-parallettes", "reps": 8, "tempo": "3/2/X/0", "pause_iso": 1.0},
                {"slug": "burpee", "reps": 10, "tempo": "X/0/X/0"},
                {"slug": "mountain-climber", "reps": 10, "tempo": "X/0/X/0"},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.COURSE, "titre": "Intervalles Z4/Z5 — pic",
            "zone": ZoneCourse.Z4, "duree_min": 45, "description":
            "Séance la plus intense en course. 5 x 3 min Z4 / 2 min récup. 5 x 30 sec Z5 / 90 sec récup."
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM 28 min — Consolidation",
            "temps_limite": 28, "description":
            "7 rounds. Consolidation des acquis. Maintien tempos. Observation des sensations.",
            "exercices": [
                {"slug": "traction-stricte", "reps": 7, "tempo": "X/2/3/0", "pause_iso": 1.0},
                {"slug": "dip-parallettes", "reps": 10, "tempo": "3/1/X/0", "pause_iso": 1.0},
                {"slug": "squat-bw", "reps": 20, "tempo": "3/2/X/0"},
                {"slug": "abdominal-crunch", "reps": 20, "tempo": "2/1/2/0"},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue Z2",
            "zone": ZoneCourse.Z2, "distance_km": 15.0, "description":
            "Pic de volume course. Allure Z2 stricte. Course par ressenti."
        },
    ],

    # -----------------------------------------------------------------------
    # SEMAINE 6 — Décharge (volume -30%)
    # -----------------------------------------------------------------------
    6: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Récupération active Z1/Z2",
            "zone": ZoneCourse.Z1, "duree_min": 25, "description":
            "Allure très légère. Aucune pression de performance. Objectif : vider la fatigue."
        },
        {
            "jour": 2, "type": TypeSeance.AMRAP, "titre": "AMRAP 20 min — Décharge",
            "temps_limite": 20, "description":
            "Volume réduit. Mêmes mouvements mais reps réduites. Focus technique pure.",
            "exercices": [
                {"slug": "traction-stricte", "reps": 4, "tempo": "X/1/2/0"},
                {"slug": "pompe-standard", "reps": 8, "tempo": "2/1/X/0"},
                {"slug": "squat-bw", "reps": 12, "tempo": "3/1/X/0"},
                {"slug": "dip-parallettes", "reps": 6, "tempo": "2/1/X/0"},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.COURSE, "titre": "Sortie courte Z2",
            "zone": ZoneCourse.Z2, "duree_min": 25, "description":
            "Sortie courte et facile. Aucune intensité."
        },
        {
            "jour": 5, "type": TypeSeance.DECHARGE, "titre": "Mobilité & Récupération",
            "description":
            "45 min : 15 min foam rolling (mollets, ischio, dorsaux, pecs). "
            "20 min étirements statiques profonds. 10 min respiration/relaxation."
        },
    ],

    # -----------------------------------------------------------------------
    # SEMAINE 7 — Affûtage (volume -40%)
    # -----------------------------------------------------------------------
    7: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Sortie légère Z1",
            "zone": ZoneCourse.Z1, "duree_min": 20, "description":
            "Sortie très courte. Uniquement pour activer la circulation. Aucun effort."
        },
        {
            "jour": 3, "type": TypeSeance.DECHARGE, "titre": "Yoga & Mobilité",
            "description":
            "60 min : séance de yoga axée mobilité des hanches, épaules et colonne vertébrale. "
            "Étirements profonds. Respiration abdominale."
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM 15 min — Activation",
            "temps_limite": 15, "description":
            "Légère activation neuromusculaire. Reps basses, vitesse normale, aucune fatigue.",
            "exercices": [
                {"slug": "traction-stricte", "reps": 3, "tempo": "X/1/2/0"},
                {"slug": "pompe-standard", "reps": 6, "tempo": "2/0/X/0"},
                {"slug": "squat-bw", "reps": 10, "tempo": "2/0/X/0"},
            ]
        },
    ],

    # -----------------------------------------------------------------------
    # SEMAINE 8 — Évaluation
    # -----------------------------------------------------------------------
    8: [
        {
            "jour": 1, "type": TypeSeance.EVALUATION, "titre": "Demi-Cooper — Test VMA",
            "description":
            "Échauffement 10 min Z1/Z2. Test : 6 minutes à allure maximale soutenable sur piste plane. "
            "VMA = distance parcourue (m) / 100. Récupération 15 min avant les tests muscu."
        },
        {
            "jour": 3, "type": TypeSeance.EVALUATION, "titre": "Max Répétitions 1 Minute",
            "description":
            "7 mouvements enchaînés avec 3 min de récupération entre chaque : "
            "Tractions → Dips → Pompes → Abdominaux → Squats → Pistol G → Pistol D. "
            "Score = répétitions en 60 secondes strictes."
        },
        {
            "jour": 5, "type": TypeSeance.EVALUATION, "titre": "AMRAP Benchmark 10 min",
            "description":
            "Circuit fixe EPC : 10 Tractions / 10 Pompes / 10 Squats / 10 Dips / 10 Burpees / 10 Mountain Climbers. "
            "Score = tours totaux (ex. 2.9 = 2 tours + 9 reps). "
            "Récupération 5 min avant de démarrer."
        },
    ],
}


# ---------------------------------------------------------------------------
# Insertion en base
# ---------------------------------------------------------------------------

def seed_seances():
    creer_tables()
    db = SessionLocal()
    try:
        from sqlalchemy import text

        # Récupérer le macrocycle existant (id=1)
        macrocycle = db.query(Macrocycle).filter(Macrocycle.id == 1).first()
        if not macrocycle:
            print("Aucun macrocycle trouvé. Lance d'abord le seed principal.")
            return

        semaines = {s.numero_semaine: s for s in macrocycle.semaines}
        exercices_map = {e.slug: e for e in db.query(VariationExercice).all()}

        total_seances = 0
        total_exercices = 0

        for num_sem, seances in SEANCES_PAR_SEMAINE.items():
            semaine = semaines.get(num_sem)
            if not semaine:
                print(f"Semaine {num_sem} introuvable en base.")
                continue

            # Supprimer les séances existantes de cette semaine
            for seance_ex in semaine.seances:
                db.delete(seance_ex)
            db.flush()

            date_lundi = semaine.date_debut

            for ordre, s in enumerate(seances, 1):
                date_seance = date_lundi + timedelta(days=s["jour"] - 1)

                seance = SeanceEntrainement(
                    semaine_id=semaine.id,
                    date_seance=date_seance,
                    type_seance=s["type"],
                    titre=s["titre"],
                    description=s.get("description"),
                    ordre_dans_semaine=ordre,
                    zone_cible=s.get("zone"),
                    distance_cible_km=s.get("distance_km"),
                    duree_cible_min=s.get("duree_min"),
                    temps_limite_min=s.get("temps_limite"),
                )
                db.add(seance)
                db.flush()
                total_seances += 1

                for pos, ex_data in enumerate(s.get("exercices", []), 1):
                    exercice = exercices_map.get(ex_data["slug"])
                    if not exercice:
                        print(f"  ⚠️  Exercice introuvable : {ex_data['slug']}")
                        continue
                    ex_seance = ExerciceSeance(
                        seance_id=seance.id,
                        exercice_id=exercice.id,
                        ordre=pos,
                        repetitions=ex_data.get("reps"),
                        tempo_override=ex_data.get("tempo"),
                        pause_isometrique_override_sec=ex_data.get("pause_iso"),
                    )
                    db.add(ex_seance)
                    total_exercices += 1

        db.commit()
        print(f"Seed séances terminé — {total_seances} séances, {total_exercices} exercices insérés.")

    except Exception as e:
        db.rollback()
        print(f"Erreur : {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_seances()
