"""
Seed des séances EPC — 8 semaines complètes.

Sources :
  S1-S4 → MODULE 1 ADAPTATION (semaines 1-4)
  S5-S8 → MODULE 2 RÉVÉLATION (semaines 1 + 6 + 7 + Tests)

Notation EMOM issue des modules :
  "9D2/3/4"   = 9 min EMOM, progression reps : 2 (min 1-3) → 3 (min 4-6) → 4 (min 7-9)
  "5D10"       = 5 min EMOM, 10 reps par minute
  "9D10/10/X"  = 9 min EMOM en triplet : 10 reps A / 10 reps B / repos (cycle × 3)
  "9D30sec"    = 9 min EMOM, tenir 30 secondes par minute

Sorties longues : minimum 1h30 conformément aux consignes.
"""

from datetime import date, timedelta
from database import SessionLocal, creer_tables
from models import (
    Macrocycle, SemaineEntrainement, SeanceEntrainement,
    ExerciceSeance, VariationExercice, TypeSeance, ZoneCourse
)

# ---------------------------------------------------------------------------
# Semaines : Module 1 (S1-S4) + Module 2 (S5-S8)
# ---------------------------------------------------------------------------

SEANCES_PAR_SEMAINE = {

    # ===================================================================
    # SEMAINE 1 — MODULE 1 ADAPTATION
    # Course : EF 35min D+80m | SL 1h30 trail D+120m
    # Muscu  : EMOM PULL | AMRAP 20min FULL BODY | EMOM PUSH
    # ===================================================================
    1: [
        # --- COURSE ---
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Endurance fondamentale Z1-Z2 — 35 min",
            "zone": ZoneCourse.Z2, "duree_min": 35, "dplus_m": 80,
            "description": (
                "Terrain : trail ou chemin (D+ 80 m).\n"
                "Allure Z1-Z2 — très confortable, repos actif sur les descentes.\n"
                "Respiration nasale prioritaire. Allure conversationnelle stricte."
            ),
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z1-Z2 — 1h30",
            "zone": ZoneCourse.Z2, "duree_min": 90, "dplus_m": 120,
            "description": (
                "Terrain : trail (D+ 120 m).\n"
                "Durée : 1h30 en Z1-Z2 continu. Marcher les montées si FC dépasse Z2.\n"
                "Allure cible : Z2 — ajuster selon le dénivelé.\n"
                "Hydratation : gorgée toutes les 20 min."
            ),
        },
        # --- MUSCU ---
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PULL — 32 min (Module 1 S1)",
            "temps_limite": 32,
            "description": (
                "Structure EMOM PULL — 4 blocs enchaînés :\n"
                "  • Bloc A — 9 min : Traction stricte (tempo X/1/2/0)\n"
                "      2 reps (min 1-3) → 3 reps (min 4-6) → 4 reps (min 7-9)\n"
                "  • Bloc B — 9 min : Dips parallettes (allure libre)\n"
                "      3 reps → 4 reps → 5 reps\n"
                "  • Bloc C — 5 min : Traction australienne\n"
                "      10 reps × 5 minutes\n"
                "  • Bloc D — 9 min : Curl biceps en traction + Hollow actif\n"
                "      8 reps traction / 20 sec hollow (alternés chaque minute)\n"
                "Repos = fin de minute restante après les reps."
            ),
            "exercices": [
                {"slug": "traction-stricte",    "reps": 3, "tempo": "X/1/2/0", "pause_iso": 1.0},
                {"slug": "dip-parallettes",     "reps": 4, "tempo": None,      "pause_iso": None},
                {"slug": "traction-australienne","reps": 10,"tempo": "X/1/2/0", "pause_iso": None},
                {"slug": "curl-biceps-traction", "reps": 8, "tempo": "X/1/2/0", "pause_iso": None},
                {"slug": "hollow-actif",         "reps": None,"tempo": None,   "pause_iso": None},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 20 min — FULL BODY (Module 1 S1)",
            "temps_limite": 20,
            "description": (
                "Circuit AMRAP 20 min — enchaîner sans repos imposé :\n"
                "  1. 5 Tractions pronation\n"
                "  2. 8 Dips aux parallettes\n"
                "  3. 12 Pompes standard\n"
                "  4. 15 Sit ups\n"
                "  5. 20 Squats poids du corps\n"
                "  6. 6 Pistol squat gauche (*)\n"
                "  7. 6 Pistol squat droit (*)\n"
                "(*) Régression autorisée : s'aider d'un anneau ou d'un montant.\n"
                "Score : nombre de tours complets + reps dans le tour suivant (ex. 3.4)."
            ),
            "exercices": [
                {"slug": "traction-stricte",    "reps": 5,  "tempo": "X/1/2/0", "pause_iso": None},
                {"slug": "dip-parallettes",     "reps": 8,  "tempo": "2/1/X/0", "pause_iso": None},
                {"slug": "pompe-standard",      "reps": 12, "tempo": "2/1/X/0", "pause_iso": None},
                {"slug": "sit-up",              "reps": 15, "tempo": "X/0/2/0", "pause_iso": None},
                {"slug": "squat-bw",            "reps": 20, "tempo": "3/1/X/0", "pause_iso": None},
                {"slug": "pistol-squat-gauche", "reps": 6,  "tempo": "3/1/X/0", "pause_iso": None},
                {"slug": "pistol-squat-droit",  "reps": 6,  "tempo": "3/1/X/0", "pause_iso": None},
            ]
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM PUSH — 18 min (Module 1 S1)",
            "temps_limite": 18,
            "description": (
                "Structure EMOM PUSH — 2 blocs + footing final :\n"
                "  • Bloc A — 9 min : Pompes standard (tempo 2/1/X/0)\n"
                "      Reps libres — vise la qualité de tempo sur chaque rep\n"
                "  • Bloc B — 9 min : Extension triceps / Position proactive dips\n"
                "      10 reps extension triceps / 20 sec position tenue (alternés)\n"
                "  • Fin de séance : 10 min de trot Z2 pour la récupération active"
            ),
            "exercices": [
                {"slug": "pompe-standard",           "reps": 10, "tempo": "2/1/X/0", "pause_iso": None},
                {"slug": "triceps-extension-dips",   "reps": 10, "tempo": "2/1/X/0", "pause_iso": None},
            ]
        },
    ],

    # ===================================================================
    # SEMAINE 2 — MODULE 1 ADAPTATION
    # Course : EF 40min | SL 1h30 trail D+150m
    # Muscu  : EMOM PUSH | AMRAP 22min | EMOM PULL + RENFO
    # ===================================================================
    2: [
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Endurance fondamentale Z1-Z2 — 40 min",
            "zone": ZoneCourse.Z2, "duree_min": 40, "dplus_m": 0,
            "description": (
                "Terrain : route ou chemin plat.\n"
                "+5 min vs S1. Allure Z1-Z2 strictement conversationnelle."
            ),
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z1-Z2 — 1h30",
            "zone": ZoneCourse.Z2, "duree_min": 90, "dplus_m": 150,
            "description": (
                "Terrain : trail (D+ 150 m).\n"
                "Durée : 1h30 en Z1-Z2. Léger dénivelé introduit progressivement.\n"
                "Marcher les sections en montée si nécessaire pour rester en Z2."
            ),
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH — 32 min (Module 1 S2)",
            "temps_limite": 32,
            "description": (
                "Structure EMOM PUSH — 4 blocs :\n"
                "  • Bloc A — 9 min : Pompes (tempo 3/1*/X/0, alterner prise)\n"
                "      3 reps → 3 reps → 4 reps (min 1-3 / 4-6 / 7-9)\n"
                "  • Bloc B — 9 min : Pompes (même tempo)\n"
                "      4 reps → 5 reps → 6 reps\n"
                "  • Bloc C — 5 min : Planche dynamique (tapotements alternés)\n"
                "      12 reps × 5 minutes (*alterner chaque bras)\n"
                "  • Bloc D — 9 min : Sit ups / Hollow actif (alternés)\n"
                "      Sit ups × reps libres / Hollow actif 20 sec"
            ),
            "exercices": [
                {"slug": "pompe-standard",     "reps": 4,  "tempo": "3/1/X/0", "pause_iso": None},
                {"slug": "planche-dynamique",  "reps": 12, "tempo": "X/0/X/0", "pause_iso": None},
                {"slug": "sit-up",             "reps": 15, "tempo": "X/0/2/0", "pause_iso": None},
                {"slug": "hollow-actif",       "reps": None,"tempo": None,     "pause_iso": None},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 22 min — FULL BODY (Module 1 S2)",
            "temps_limite": 22,
            "description": (
                "Circuit AMRAP 22 min — +2 min et +1 mouvement vs S1 :\n"
                "  1. 10 Planches dynamiques (tapotements alternés)\n"
                "  2. 5 Tractions pronation\n"
                "  3. 8 Dips aux parallettes\n"
                "  4. 12 Pompes standard\n"
                "  5. 15 Sit ups\n"
                "  6. 20 Squats poids du corps\n"
                "  7. 6 Pistol squat gauche\n"
                "  8. 6 Pistol squat droit\n"
                "Score cible : dépasser le score de S1."
            ),
            "exercices": [
                {"slug": "planche-dynamique",   "reps": 10, "tempo": "X/0/X/0", "pause_iso": None},
                {"slug": "traction-stricte",    "reps": 5,  "tempo": "X/1/2/0", "pause_iso": None},
                {"slug": "dip-parallettes",     "reps": 8,  "tempo": "2/1/X/0", "pause_iso": None},
                {"slug": "pompe-standard",      "reps": 12, "tempo": "2/1/X/0", "pause_iso": None},
                {"slug": "sit-up",              "reps": 15, "tempo": "X/0/2/0", "pause_iso": None},
                {"slug": "squat-bw",            "reps": 20, "tempo": "3/1/X/0", "pause_iso": None},
                {"slug": "pistol-squat-gauche", "reps": 6,  "tempo": "3/1/X/0", "pause_iso": None},
                {"slug": "pistol-squat-droit",  "reps": 6,  "tempo": "3/1/X/0", "pause_iso": None},
            ]
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM PULL + RENFO — 18 min (Module 1 S2)",
            "temps_limite": 18,
            "description": (
                "Structure EMOM PULL + Renforcement — 2 blocs :\n"
                "  • Bloc A — 9 min : Superman (extension dorsale)\n"
                "      Tenir 30 sec par minute (9 holds)\n"
                "  • Bloc B — 9 min : Hollow actif (triplet)\n"
                "      20 sec Hollow actif / 20 sec repos / repos (cycle × 3)\n"
                "Focus : renforcement de la chaîne postérieure et du gainage."
            ),
            "exercices": [
                {"slug": "superman",     "reps": None, "tempo": None, "pause_iso": None},
                {"slug": "hollow-actif", "reps": None, "tempo": None, "pause_iso": None},
            ]
        },
    ],

    # ===================================================================
    # SEMAINE 3 — MODULE 1 ADAPTATION
    # Course : Seuil 3×10min Z4 | SL 1h30 trail D+200m
    # Muscu  : EMOM PUSH (avec pauses) | AMRAP 24min | EMOM PULL
    # ===================================================================
    3: [
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Seuil Z4 — 3×10 min (R=2 min)",
            "zone": ZoneCourse.Z4, "duree_min": 45, "dplus_m": 0,
            "description": (
                "Terrain : route plate ou légèrement montante.\n"
                "Structure :\n"
                "  • Échauffement : 8 min Z1/Z2\n"
                "  • 3 × 10 min Z4 minimum (87-95% VMA) / 2 min récup Z1 trot\n"
                "  • Retour au calme : 5 min Z1\n"
                "Total : ~45 min. 1ère séance seuil du programme."
            ),
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z1-Z2 — 1h30",
            "zone": ZoneCourse.Z2, "duree_min": 90, "dplus_m": 200,
            "description": (
                "Terrain : trail (D+ 200 m).\n"
                "Durée : 1h30 en Z1-Z2. Dénivelé progressif.\n"
                "Marcher les montées raides pour rester en Z2."
            ),
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH (pauses) — 32 min (Module 1 S3)",
            "temps_limite": 32,
            "description": (
                "Structure EMOM PUSH avec pauses isométriques — 4 blocs :\n"
                "  • Bloc A — 5 min : Dips avec pause en bas\n"
                "      11 reps × 5 minutes (pause 1 sec en position basse)\n"
                "  • Bloc B — 9 min : Tractions strictes + hold\n"
                "      11 reps / 30 sec en position haute (alternés chaque minute)\n"
                "  • Bloc C — 9 min : Pompes standard (tempo libre)\n"
                "      Reps libres — maintenir le volume\n"
                "  • Bloc D — 9 min : Extension triceps + Pause proactive\n"
                "      9 reps extension / 25 sec position tenue (alternés)"
            ),
            "exercices": [
                {"slug": "dip-parallettes",        "reps": 11, "tempo": "2/1/X/0", "pause_iso": 1.0},
                {"slug": "traction-stricte",       "reps": 11, "tempo": "X/1/2/0", "pause_iso": 1.0},
                {"slug": "pompe-standard",         "reps": 10, "tempo": "2/0/X/0", "pause_iso": None},
                {"slug": "triceps-extension-dips", "reps": 9,  "tempo": "2/1/X/0", "pause_iso": None},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 24 min — FULL BODY (Module 1 S3)",
            "temps_limite": 24,
            "description": (
                "Circuit AMRAP 24 min — remplacement pompes standard par pompes larges :\n"
                "  1. 5 Tractions pronation\n"
                "  2. 8 Dips aux parallettes\n"
                "  3. 6 Pompes prise large\n"
                "  4. 15 Sit ups\n"
                "  5. 20 Squats poids du corps\n"
                "  6. 6 Pistol squat gauche\n"
                "  7. 6 Pistol squat droit\n"
                "Focus : maîtrise des tempos malgré la fatigue accumulée."
            ),
            "exercices": [
                {"slug": "traction-stricte",    "reps": 5,  "tempo": "X/1/2/0", "pause_iso": None},
                {"slug": "dip-parallettes",     "reps": 8,  "tempo": "2/1/X/0", "pause_iso": None},
                {"slug": "pompe-large",         "reps": 6,  "tempo": "2/1/X/0", "pause_iso": None},
                {"slug": "sit-up",              "reps": 15, "tempo": "X/0/2/0", "pause_iso": None},
                {"slug": "squat-bw",            "reps": 20, "tempo": "3/1/X/0", "pause_iso": None},
                {"slug": "pistol-squat-gauche", "reps": 6,  "tempo": "3/1/X/0", "pause_iso": None},
                {"slug": "pistol-squat-droit",  "reps": 6,  "tempo": "3/1/X/0", "pause_iso": None},
            ]
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM PULL — 32 min (Module 1 S3)",
            "temps_limite": 32,
            "description": (
                "Structure EMOM PULL — 4 blocs (progression vs S1) :\n"
                "  • Bloc A — 9 min : Traction stricte X/1/2/0\n"
                "      3 reps → 4 reps → 5 reps\n"
                "  • Bloc B — 9 min : Dips parallettes (libre)\n"
                "      4 reps → 5 reps → 6 reps\n"
                "  • Bloc C — 5 min : Traction australienne\n"
                "      11 reps × 5\n"
                "  • Bloc D — 9 min : Curl biceps en traction + Hollow\n"
                "      8 reps / 25 sec hold (alternés)"
            ),
            "exercices": [
                {"slug": "traction-stricte",    "reps": 4,  "tempo": "X/1/2/0", "pause_iso": 1.0},
                {"slug": "dip-parallettes",     "reps": 5,  "tempo": None,       "pause_iso": None},
                {"slug": "traction-australienne","reps": 11, "tempo": "X/1/2/0",  "pause_iso": None},
                {"slug": "curl-biceps-traction", "reps": 8,  "tempo": "X/1/2/0",  "pause_iso": None},
                {"slug": "hollow-actif",         "reps": None,"tempo": None,      "pause_iso": None},
            ]
        },
    ],

    # ===================================================================
    # SEMAINE 4 — MODULE 1 ADAPTATION (pic de charge)
    # Course : EF 45min | SL 1h30 trail D+300m
    # Muscu  : EMOM PUSH (barres) | AMRAP 30min | EMOM PULL (curl + hollow)
    # ===================================================================
    4: [
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Endurance fondamentale Z2 — 45 min",
            "zone": ZoneCourse.Z2, "duree_min": 45, "dplus_m": 0,
            "description": (
                "Terrain : route plate.\n"
                "45 min Z2 continu — consolidation aérobie avant le pic de charge."
            ),
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z1-Z2 — 1h30",
            "zone": ZoneCourse.Z2, "duree_min": 90, "dplus_m": 300,
            "description": (
                "Terrain : trail (D+ 300 m).\n"
                "Durée : 1h30 en Z1-Z2. Dénivelé significatif — marcher les montées.\n"
                "Pic de SL de la phase Adaptation."
            ),
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH (barres) — 27 min (Module 1 S4)",
            "temps_limite": 27,
            "description": (
                "Structure EMOM PUSH variante barres — 3 blocs :\n"
                "  • Bloc A — 9 min : Dips *barre droite de traction\n"
                "      Tenir la barre droite devant, dips pieds au sol ou surélevés\n"
                "  • Bloc B — 9 min : Traction australienne\n"
                "      5 reps × 9 minutes\n"
                "  • Bloc C — 9 min : Traction stricte + hold\n"
                "      12 reps / 30 sec en position haute (alternés)"
            ),
            "exercices": [
                {"slug": "dip-parallettes",     "reps": 8, "tempo": "2/1/X/0", "pause_iso": None},
                {"slug": "traction-australienne","reps": 5, "tempo": "X/1/2/0", "pause_iso": None},
                {"slug": "traction-stricte",    "reps": 12,"tempo": "X/1/2/0", "pause_iso": 1.0},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 30 min — FULL BODY (Module 1 S4)",
            "temps_limite": 30,
            "description": (
                "Circuit AMRAP 30 min — le plus long de la phase Adaptation :\n"
                "  1. 10 Tractions australiennes\n"
                "  2. 10 Dips aux parallettes\n"
                "  3. 10 Pompes prise large\n"
                "  4. 30 sec Hollow body actif\n"
                "  5. 10 Squats poids du corps\n"
                "  6. 5 Tractions strictes (*bascule tapis = pieds posés sur un step)\n"
                "  7. 6 Pistol squat gauche\n"
                "  8. 6 Pistol squat droit\n"
                "(*) Régression pistol : s'aider d'un anneau ou poser le talon sur un step."
            ),
            "exercices": [
                {"slug": "traction-australienne","reps": 10, "tempo": "X/1/2/0", "pause_iso": None},
                {"slug": "dip-parallettes",     "reps": 10, "tempo": "2/1/X/0", "pause_iso": None},
                {"slug": "pompe-large",         "reps": 10, "tempo": "2/1/X/0", "pause_iso": None},
                {"slug": "hollow-actif",        "reps": None,"tempo": None,     "pause_iso": None},
                {"slug": "squat-bw",            "reps": 10, "tempo": "3/1/X/0", "pause_iso": None},
                {"slug": "traction-stricte",    "reps": 5,  "tempo": "X/1/2/0", "pause_iso": None},
                {"slug": "pistol-squat-gauche", "reps": 6,  "tempo": "3/1/X/0", "pause_iso": None},
                {"slug": "pistol-squat-droit",  "reps": 6,  "tempo": "3/1/X/0", "pause_iso": None},
            ]
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM PULL (curl + hollow) — 9 min (Module 1 S4)",
            "temps_limite": 9,
            "description": (
                "Structure EMOM PULL condensé — 1 bloc :\n"
                "  • Bloc A — 9 min : Curl biceps en traction + Hollow actif\n"
                "      12 reps curl biceps / 25 sec hollow (alternés chaque minute)\n"
                "Séance courte — journée déjà chargée avec l'AMRAP 30 min."
            ),
            "exercices": [
                {"slug": "curl-biceps-traction", "reps": 12, "tempo": "X/1/2/0", "pause_iso": None},
                {"slug": "hollow-actif",         "reps": None,"tempo": None,     "pause_iso": None},
            ]
        },
    ],

    # ===================================================================
    # SEMAINE 5 — MODULE 2 RÉVÉLATION S1 (pic total du programme)
    # Course : Seuil 3×11min | SL 1h30 Z2 D+500m
    # Muscu  : EMOM PUSH | AMRAP 25min | EMOM PULL
    # ===================================================================
    5: [
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Seuil Z3/Z4 — 3×11 min",
            "zone": ZoneCourse.Z3, "duree_min": 50, "dplus_m": 0,
            "description": (
                "Terrain : route plate ou piste.\n"
                "Structure :\n"
                "  • Échauffement : 8 min Z1/Z2\n"
                "  • 3 × 11 min Z3/Z4 (80-95% VMA) / 2 min récup Z1\n"
                "  • Retour au calme : 5 min Z1\n"
                "Total : ~50 min. +1 min / bloc vs S3."
            ),
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z1-Z2 — 1h30",
            "zone": ZoneCourse.Z2, "duree_min": 90, "dplus_m": 500,
            "description": (
                "Terrain : trail (D+ 500 m) — 1ère sortie avec dénivelé significatif.\n"
                "Durée : 1h30 en Z1-Z2. Marcher systématiquement les montées raides.\n"
                "Ravitaillement à 45 min conseillé."
            ),
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH — Module 2 S1",
            "temps_limite": 34,
            "description": (
                "Structure EMOM PUSH Module 2 — 4 blocs :\n"
                "  • Bloc A — 10 min : Dips aux parallettes\n"
                "      3 reps × 10 minutes (technique parfaite)\n"
                "  • Bloc B — 9 min : Traction australienne\n"
                "      2 reps (min 1-3) → 3 reps (min 4-6) → 4 reps (min 7-9)\n"
                "  • Bloc C — 6 min : Dips partiel (amplitude réduite)\n"
                "      5 reps × 6 minutes\n"
                "  • Bloc D — 9 min : Triceps extension / Rotateur long / Repos\n"
                "      10 reps triceps (min 1,4,7) / 10 reps rotateur long (min 2,5,8) / repos (min 3,6,9)"
            ),
            "exercices": [
                {"slug": "dip-parallettes",       "reps": 3,  "tempo": "2/1/X/0", "pause_iso": None},
                {"slug": "traction-australienne",  "reps": 3,  "tempo": "X/1/2/0", "pause_iso": None},
                {"slug": "dip-partiel",            "reps": 5,  "tempo": "2/1/X/0", "pause_iso": None},
                {"slug": "triceps-extension-dips", "reps": 10, "tempo": "2/1/X/0", "pause_iso": None},
                {"slug": "rotateur-long",          "reps": 10, "tempo": "2/1/X/0", "pause_iso": None},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 25 min — FULL BODY (Module 2 S1)",
            "temps_limite": 25,
            "description": (
                "Circuit AMRAP 25 min Module 2 — circuit complet :\n"
                "  1. 5 Tractions pronation\n"
                "  2. 5 Dips aux parallettes\n"
                "  3. 10 Squats poids du corps\n"
                "  4. 10 Mountain climbers (par jambe)\n"
                "  5. 10 Burpees\n"
                "  6. 10 Pistol squat gauche\n"
                "  7. 10 Pistol squat droit\n"
                "  8. Chaise isométrique 30 sec (wall sit)\n"
                "Reps pistol ×10 au lieu de ×6 vs Module 1."
            ),
            "exercices": [
                {"slug": "traction-stricte",    "reps": 5,   "tempo": "X/1/2/0", "pause_iso": None},
                {"slug": "dip-parallettes",     "reps": 5,   "tempo": "2/1/X/0", "pause_iso": None},
                {"slug": "squat-bw",            "reps": 10,  "tempo": "3/1/X/0", "pause_iso": None},
                {"slug": "mountain-climber",    "reps": 10,  "tempo": "X/0/X/0", "pause_iso": None},
                {"slug": "burpee",              "reps": 10,  "tempo": "X/0/X/0", "pause_iso": None},
                {"slug": "pistol-squat-gauche", "reps": 10,  "tempo": "3/1/X/0", "pause_iso": None},
                {"slug": "pistol-squat-droit",  "reps": 10,  "tempo": "3/1/X/0", "pause_iso": None},
                {"slug": "chaise-isometrique",  "reps": None,"tempo": None,      "pause_iso": None},
            ]
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM PULL — Module 2 S1",
            "temps_limite": 38,
            "description": (
                "Structure EMOM PULL Module 2 — 4 blocs :\n"
                "  • Bloc A — 10 min : Traction stricte (tempo X/1/2/0)\n"
                "      2 reps × 10 minutes\n"
                "  • Bloc B — 9 min : Traction partielle / Curl biceps / Repos (triplet)\n"
                "      10 reps traction partielle (min 1,4,7) / repos (min 2,5,8) / repos (min 3,6,9)\n"
                "  • Bloc C — 9 min : Curl biceps en traction / Le Y / Repos\n"
                "      10 reps curl (min 1,4,7) / 10 reps Le Y (min 2,5,8) / repos (min 3,6,9)\n"
                "  • Bloc D — 10 min : Traction australienne\n"
                "      3 reps (min 1-3) → 4 reps (min 4-7) → 5 reps (min 8-10)"
            ),
            "exercices": [
                {"slug": "traction-stricte",    "reps": 2,  "tempo": "X/1/2/0", "pause_iso": 1.0},
                {"slug": "traction-partielle",  "reps": 10, "tempo": "X/1/2/0", "pause_iso": None},
                {"slug": "curl-biceps-traction", "reps": 10, "tempo": "X/1/2/0", "pause_iso": None},
                {"slug": "le-y",                "reps": 10, "tempo": "2/1/X/0", "pause_iso": None},
                {"slug": "traction-australienne","reps": 4,  "tempo": "X/1/2/0", "pause_iso": None},
            ]
        },
    ],

    # ===================================================================
    # SEMAINE 6 — MODULE 2 RÉVÉLATION S6 (Décharge — volume -30%)
    # Course : Récupération Z1 25min | pas de SL
    # Muscu  : EMOM PUSH allégé | AMRAP 15min | Mobilité
    # ===================================================================
    6: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Récupération active Z1 — 25 min",
            "zone": ZoneCourse.Z1, "duree_min": 25, "dplus_m": 0,
            "description": (
                "Terrain : route souple ou herbe.\n"
                "Allure Z1 très légère (~7'/km). Activer la circulation, vider la fatigue.\n"
                "Aucun effort ressenti. Semaine de décharge."
            ),
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH allégé — Module 2 S6",
            "temps_limite": 24,
            "description": (
                "Structure EMOM PUSH décharge — 3 blocs allégés :\n"
                "  • Bloc A — 6 min : Dips aux parallettes\n"
                "      10 reps × 6 minutes\n"
                "  • Bloc B — 9 min : Extension triceps / Rotateur long / Repos\n"
                "      10 reps / 10 reps / repos (triplet × 3)\n"
                "  • Bloc C — 9 min : Traction australienne + Pompes / Repos\n"
                "      10 reps trac austr (min 1,4,7) / 10 reps pompes (min 2,5,8) / repos (min 3,6,9)\n"
                "Aucune pause isométrique. Volume réduit de ~30%."
            ),
            "exercices": [
                {"slug": "dip-parallettes",       "reps": 10, "tempo": "2/1/X/0", "pause_iso": None},
                {"slug": "triceps-extension-dips", "reps": 10, "tempo": "2/1/X/0", "pause_iso": None},
                {"slug": "rotateur-long",          "reps": 10, "tempo": "2/1/X/0", "pause_iso": None},
                {"slug": "traction-australienne",  "reps": 10, "tempo": "X/1/2/0", "pause_iso": None},
                {"slug": "pompe-standard",         "reps": 10, "tempo": "2/0/X/0", "pause_iso": None},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 15 min — Décharge (Module 2 S6)",
            "temps_limite": 15,
            "description": (
                "Circuit AMRAP 15 min — version décharge, reps réduites :\n"
                "  1. 10 Tractions australiennes\n"
                "  2. 10 Squats poids du corps\n"
                "  3. 10 Pompes standard\n"
                "  4. 10 Burpees\n"
                "  5. 10 Mountain climbers\n"
                "Pas de pause isométrique. Qualité de mouvement uniquement."
            ),
            "exercices": [
                {"slug": "traction-australienne","reps": 10, "tempo": "X/1/2/0", "pause_iso": None},
                {"slug": "squat-bw",            "reps": 10, "tempo": "3/1/X/0", "pause_iso": None},
                {"slug": "pompe-standard",      "reps": 10, "tempo": "2/0/X/0", "pause_iso": None},
                {"slug": "burpee",              "reps": 10, "tempo": "X/0/X/0", "pause_iso": None},
                {"slug": "mountain-climber",    "reps": 10, "tempo": "X/0/X/0", "pause_iso": None},
            ]
        },
        {
            "jour": 5, "type": TypeSeance.DECHARGE, "titre": "Mobilité & Foam rolling — 45 min",
            "description": (
                "Programme récupération décharge :\n"
                "  • 15 min foam rolling : mollets → ischio → fessiers → dorsaux → pectoraux\n"
                "  • 20 min étirements statiques (30 sec / position, 2 séries) :\n"
                "      Fléchisseurs hanches, quadriceps, ischio, mollets\n"
                "      Pectoraux, biceps, dorsaux\n"
                "  • 10 min respiration abdominale + relaxation"
            ),
        },
    ],

    # ===================================================================
    # SEMAINE 7 — MODULE 2 RÉVÉLATION S7 (Affûtage — prep évaluation)
    # Course : Activation 20min + Calibrage Cooper 30min
    # Muscu  : Activation légère + Étirements profonds
    # ===================================================================
    7: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Activation légère Z1 — 20 min",
            "zone": ZoneCourse.Z1, "duree_min": 20, "dplus_m": 0,
            "description": (
                "Terrain : route souple.\n"
                "Allure Z1 très légère. Activer sans fatiguer.\n"
                "Si tu transpires, tu vas trop vite."
            ),
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Prépa Demi-Cooper — 30 min Z2",
            "zone": ZoneCourse.Z2, "duree_min": 30, "dplus_m": 0,
            "description": (
                "Terrain : piste d'athlétisme ou route plate mesurée (GPS).\n"
                "30 min Z2 + 3 accélérations de 30 sec à allure Cooper.\n"
                "Objectif : calibrer le ressenti de l'allure du test S8."
            ),
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "Activation neuromusculaire — 15 min",
            "temps_limite": 15,
            "description": (
                "Protocole Module 2 S7 — activation légère :\n"
                "  • 10 Tractions australiennes lentes\n"
                "  • 10 Pompes lentes (tempo 3/1/3/0)\n"
                "  • 10 Squats profonds\n"
                "  • 10 Burpees contrôlés\n"
                "  • 10 Mountain climbers lents\n"
                "Aucune intensité. Schémas moteurs uniquement.\n"
                "Dernière séance muscu avant les tests — reste frais."
            ),
            "exercices": [
                {"slug": "traction-australienne","reps": 10, "tempo": "X/1/3/0", "pause_iso": None},
                {"slug": "pompe-standard",       "reps": 10, "tempo": "3/1/3/0", "pause_iso": None},
                {"slug": "squat-bw",             "reps": 10, "tempo": "3/1/X/0", "pause_iso": None},
                {"slug": "burpee",               "reps": 10, "tempo": "X/0/X/0", "pause_iso": None},
                {"slug": "mountain-climber",     "reps": 10, "tempo": "X/0/X/0", "pause_iso": None},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.DECHARGE, "titre": "Étirements profonds & Visualisation — 60 min",
            "description": (
                "Protocole complet affûtage :\n"
                "  • 20 min yoga / mobilité hanches et épaules\n"
                "  • 20 min étirements profonds chaîne postérieure et colonne\n"
                "  • 10 min gainage doux (planche 3×30 sec, superman 3×10)\n"
                "  • 10 min visualisation mentale des 3 tests de S8\n"
                "Préparation physique et mentale pour les évaluations."
            ),
        },
    ],

    # ===================================================================
    # SEMAINE 8 — ÉVALUATION EPC officielle
    # ===================================================================
    8: [
        {
            "jour": 1, "type": TypeSeance.EVALUATION, "titre": "Test VMA — Demi-Cooper (6 min)",
            "duree_min": 30,
            "description": (
                "Terrain : piste d'athlétisme ou parcours plat mesuré.\n"
                "Protocole :\n"
                "  • Échauffement : 10 min Z1/Z2 progressif + 2×30 sec à allure cible\n"
                "  • Test : 6 minutes à allure maximale soutenable\n"
                "      Stratégie : partir à ~95% ressenti, accélérer à 4 min si possible\n"
                "  • Relever la distance en mètres\n"
                "  • VMA calculée : distance (m) ÷ 100\n"
                "  • Zones Z1-Z5 recalculées automatiquement\n"
                "  • Récupération : 15 min marche avant les tests muscu\n"
                "Objectif J120 : 1700 m (VMA 17 km/h)"
            ),
        },
        {
            "jour": 3, "type": TypeSeance.EVALUATION, "titre": "Max Reps 1 min — 7 mouvements",
            "duree_min": 60,
            "description": (
                "Protocole EPC — 7 mouvements testés, 3-5 min de repos entre chaque :\n"
                "  1. Tractions pronation strictes\n"
                "  2. Dips aux parallettes\n"
                "  3. Pompes standard\n"
                "  4. Sit ups\n"
                "  5. Squats poids du corps\n"
                "  6. Pistol squat gauche\n"
                "  7. Pistol squat droit\n"
                "Score : répétitions complètes en 60 sec strictes.\n"
                "Objectifs J120 : 10 trac / 20 dips / 40 pompes / 30 sit ups / 45 squats / 15 pistol G / 15 pistol D"
            ),
        },
        {
            "jour": 5, "type": TypeSeance.EVALUATION, "titre": "AMRAP Benchmark — 10 min",
            "temps_limite": 10, "duree_min": 25,
            "description": (
                "Circuit fixe EPC — sans repos imposé :\n"
                "  10 Tractions → 10 Pompes → 10 Squats → 10 Dips → 10 Burpees → 10 Mountain Climbers\n"
                "Score : tours totaux (ex. 3.4 = 3 tours complets + 4 reps dans le 4e).\n"
                "Échauffement : 5 min mobilité articulaire + 5 min repos assis.\n"
                "Objectif J120 : 3 tours complets."
            ),
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
        macrocycle = db.query(Macrocycle).filter(Macrocycle.id == 1).first()
        if not macrocycle:
            print("Aucun macrocycle trouvé. Lance d'abord le seed principal.")
            return

        semaines = {s.numero_semaine: s for s in macrocycle.semaines}
        exercices_map = {e.slug: e for e in db.query(VariationExercice).all()}

        total_seances = 0
        total_exercices = 0
        slugs_manquants = set()

        for num_sem, seances in SEANCES_PAR_SEMAINE.items():
            semaine = semaines.get(num_sem)
            if not semaine:
                print(f"Semaine {num_sem} introuvable en base.")
                continue

            for seance_ex in semaine.seances:
                for ex in seance_ex.exercices:
                    db.delete(ex)
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
                    duree_cible_min=s.get("duree_min"),
                    dplus_cible_m=s.get("dplus_m"),
                    temps_limite_min=s.get("temps_limite"),
                )
                db.add(seance)
                db.flush()
                total_seances += 1

                for pos, ex_data in enumerate(s.get("exercices", []), 1):
                    exercice = exercices_map.get(ex_data["slug"])
                    if not exercice:
                        slugs_manquants.add(ex_data["slug"])
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
        print(f"OK — {total_seances} séances et {total_exercices} exercices insérés.")
        if slugs_manquants:
            print(f"Slugs introuvables (lance /api/admin/reseed d'abord) : {slugs_manquants}")

    except Exception as e:
        db.rollback()
        print(f"Erreur : {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_seances()
