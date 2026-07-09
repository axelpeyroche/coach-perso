"""
Seed des séances EPC — 2 macrocycles × 8 semaines.

MODULE 1 — ADAPTATION (Macrocycle 1)
    S1-S5 : surcharge progressive
    S6    : décharge
    S7    : affûtage
    S8    : évaluation (tests J60)

MODULE 2 — RÉVÉLATION (Macrocycle 2, démarre 8 semaines après MC1)
    S1-S4 : surcharge progressive (niveau supérieur)
    S5    : décharge amorçée
    S6    : décharge
    S7    : affûtage
    S8    : évaluation (tests J120)

Sources : PDFs « MODULE 1 - ADAPTATION - 8 SEMAINES » et « MODULE 2 - RÉVÉLATION - 8 SEMAINES »

Notation EMOM des PDFs :
  9D2/3/4    = 9 min EMOM, reps : 2 (min 1-3) → 3 (min 4-6) → 4 (min 7-9)
  5D10       = 5 min EMOM, 10 reps chaque minute
  9D10/10/X  = 9 min triplet : 10 reps A (min 1,4,7) / 10 reps B (min 2,5,8) / repos (min 3,6,9)
  9D30sec    = 9 min EMOM, tenir 30 sec chaque minute
"""

from datetime import timedelta
from database import SessionLocal, creer_tables
from models import (
    Macrocycle, SeanceEntrainement, ExerciceSeance,
    VariationExercice, TypeSeance, ZoneCourse
)


# ============================================================================
# MODULE 1 — ADAPTATION : 8 semaines
# ============================================================================

MODULE1 = {

    # -----------------------------------------------------------------------
    # S1 — Entrée progressive | AMRAP 20min | EF 35min | SL 45min trail
    # -----------------------------------------------------------------------
    1: [
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PULL — S1 (32 min)",
            "temps_limite": 32,
            "description": (
                "Structure EMOM PULL — 4 blocs :\n"
                "  • Bloc A — 9 min : Traction stricte (tempo X/1/2/0)\n"
                "      2 reps (min 1-3) → 3 reps (min 4-6) → 4 reps (min 7-9)\n"
                "  • Bloc B — 9 min : Dips aux parallettes (libre)\n"
                "      3 reps → 4 reps → 5 reps\n"
                "  • Bloc C — 5 min : Traction australienne\n"
                "      10 reps × 5\n"
                "  • Bloc D — 9 min : Curl biceps en traction + Hollow actif\n"
                "      8 reps traction / 20 sec hollow (alternés)"
            ),
            "exercices": [
                {"slug": "traction-stricte",     "reps": 3,    "tempo": "X/1/2/0"},
                {"slug": "dip-parallettes",      "reps": 4,    "tempo": None},
                {"slug": "traction-australienne","reps": 10,   "tempo": "X/1/2/0"},
                {"slug": "curl-biceps-traction", "reps": 8,    "tempo": "X/1/2/0"},
                {"slug": "hollow-actif",         "reps": None, "tempo": None},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "EF Z1-Z2 — 35 min trail (D+ 80 m)",
            "zone": ZoneCourse.Z2, "duree_min": 35, "dplus_m": 80,
            "description": (
                "Terrain : trail ou chemin (D+ 80 m).\n"
                "Allure Z1-Z2 — repos actif, notamment en trottinant sur les descentes.\n"
                "Respiration nasale prioritaire."
            ),
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 20 min FULL BODY — S1",
            "temps_limite": 20,
            "description": (
                "Circuit AMRAP 20 min (PDF Module 1 S1) :\n"
                "  1. 5 Tractions pronation\n"
                "  2. 8 Dips aux parallettes\n"
                "  3. 12 Pompes standard (tempo 2/1/X/0)\n"
                "  4. 15 Sit ups\n"
                "  5. 20 Squats poids du corps\n"
                "  6. 6 Pistol squat gauche (*)\n"
                "  7. 6 Pistol squat droit (*)\n"
                "(*) Régression : s'aider d'un anneau ou poser le talon sur un step.\n"
                "EMOM PUSH après (9 min) : Pompes libres + Triceps ext/pos proactive dips 9D10/20sec\n"
                "Terminer par 10 min trot Z2."
            ),
            "exercices": [
                {"slug": "traction-stricte",    "reps": 5,  "tempo": "X/1/2/0"},
                {"slug": "dip-parallettes",     "reps": 8,  "tempo": "2/1/X/0"},
                {"slug": "pompe-standard",      "reps": 12, "tempo": "2/1/X/0"},
                {"slug": "sit-up",              "reps": 15, "tempo": "X/0/2/0"},
                {"slug": "squat-bw",            "reps": 20, "tempo": "3/1/X/0"},
                {"slug": "pistol-squat-gauche", "reps": 6,  "tempo": "3/1/X/0"},
                {"slug": "pistol-squat-droit",  "reps": 6,  "tempo": "3/1/X/0"},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z1-Z2 — 45 min (D+ 120 m)",
            "zone": ZoneCourse.Z2, "duree_min": 45, "dplus_m": 120,
            "description": (
                "Terrain : trail (D+ 120 m).\n"
                "Allure Z1-Z2. Marcher les montées si la FC dépasse Z2.\n"
                "1ère sortie longue — accumuler du temps sur les jambes, pas de chrono."
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S2 — Volume +10% | AMRAP 22min | EF 40min | SL 55min trail Z3
    # -----------------------------------------------------------------------
    2: [
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH — S2 (32 min)",
            "temps_limite": 32,
            "description": (
                "Structure EMOM PUSH — 4 blocs (tempo 3/1*/X/0, *alterner prise) :\n"
                "  • Bloc A — 9 min : Pompes\n"
                "      3 reps → 3 reps → 4 reps (min 1-3 / 4-6 / 7-9)\n"
                "  • Bloc B — 9 min : Pompes (même tempo)\n"
                "      4 reps → 5 reps → 6 reps\n"
                "  • Bloc C — 5 min : Planche dynamique (tapotements alternés)\n"
                "      12 reps × 5 min (*alterner chaque bras)\n"
                "  • Bloc D — 9 min : Sit ups / Hollow actif (alternés)\n"
                "      Sit ups libres / Hollow actif 20 sec"
            ),
            "exercices": [
                {"slug": "pompe-standard",    "reps": 4,    "tempo": "3/1/X/0"},
                {"slug": "planche-dynamique", "reps": 12,   "tempo": "X/0/X/0"},
                {"slug": "sit-up",            "reps": 15,   "tempo": "X/0/2/0"},
                {"slug": "hollow-actif",      "reps": None, "tempo": None},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "EF Z1-Z2 — 40 min (avec D+)",
            "zone": ZoneCourse.Z2, "duree_min": 40, "dplus_m": 50,
            "description": (
                "Terrain : chemin avec un peu de D+ (~50 m).\n"
                "+5 min vs S1. Allure Z1-Z2 conversationnelle."
            ),
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 22 min FULL BODY — S2",
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
                "  8. 6 Pistol squat droit"
            ),
            "exercices": [
                {"slug": "planche-dynamique",   "reps": 10, "tempo": "X/0/X/0"},
                {"slug": "traction-stricte",    "reps": 5,  "tempo": "X/1/2/0"},
                {"slug": "dip-parallettes",     "reps": 8,  "tempo": "2/1/X/0"},
                {"slug": "pompe-standard",      "reps": 12, "tempo": "2/1/X/0"},
                {"slug": "sit-up",              "reps": 15, "tempo": "X/0/2/0"},
                {"slug": "squat-bw",            "reps": 20, "tempo": "3/1/X/0"},
                {"slug": "pistol-squat-gauche", "reps": 6,  "tempo": "3/1/X/0"},
                {"slug": "pistol-squat-droit",  "reps": 6,  "tempo": "3/1/X/0"},
            ]
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM PULL + RENFO — S2 (18 min)",
            "temps_limite": 18,
            "description": (
                "Structure EMOM PULL + Renforcement — 2 blocs :\n"
                "  • Bloc A — 9 min : Superman (extension dorsale)\n"
                "      Tenir 30 sec par minute\n"
                "  • Bloc B — 9 min : Hollow actif (triplet)\n"
                "      20 sec hold / 20 sec repos / repos (cycle × 3)"
            ),
            "exercices": [
                {"slug": "superman",     "reps": None, "tempo": None},
                {"slug": "hollow-actif", "reps": None, "tempo": None},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2/Z3 — 55 min",
            "zone": ZoneCourse.Z2, "duree_min": 55, "dplus_m": 150,
            "description": (
                "Terrain : trail (D+ 150 m).\n"
                "+10 min vs S1. La fin de sortie peut glisser en Z3 — toléré.\n"
                "Allure cible : Z2 dominant, Z3 sur les relances de fin."
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S3 — Intensification | AMRAP 24min | Seuil 3×10min Z4 | SL 60min
    # -----------------------------------------------------------------------
    3: [
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH (pauses) — S3 (32 min)",
            "temps_limite": 32,
            "description": (
                "Structure EMOM PUSH avec pauses isométriques — 4 blocs :\n"
                "  • Bloc A — 5 min : Dips avec pause isométrique (Pause)\n"
                "      11 reps × 5 min (pause 1 sec en position basse)\n"
                "  • Bloc B — 9 min : Tractions strictes + hold\n"
                "      11 reps / 30 sec en position haute (alternés)\n"
                "  • Bloc C — 9 min : Pompes (libre)\n"
                "      Reps libres — maintenir la qualité\n"
                "  • Bloc D — 9 min : Extension triceps + Pause proactive\n"
                "      9 reps / 25 sec position tenue (alternés)"
            ),
            "exercices": [
                {"slug": "dip-parallettes",       "reps": 11, "tempo": "2/1/X/0", "pause_iso": 1.0},
                {"slug": "traction-stricte",      "reps": 11, "tempo": "X/1/2/0", "pause_iso": 1.0},
                {"slug": "pompe-standard",        "reps": 10, "tempo": "2/0/X/0"},
                {"slug": "triceps-extension-dips","reps": 9,  "tempo": "2/1/X/0"},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Seuil Z4 — 45 min (3×10 min R=2 min)",
            "zone": ZoneCourse.Z4, "duree_min": 45, "dplus_m": 0,
            "description": (
                "Terrain : route plate ou piste.\n"
                "Structure :\n"
                "  • Échauffement : 8 min Z1/Z2\n"
                "  • 3 × 10 min Z4 minimum (87-95% VMA) / 2 min récup Z1 trot\n"
                "  • Retour au calme : 5 min Z1\n"
                "Total : 45 min. 1ère séance seuil longue du programme."
            ),
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 24 min FULL BODY — S3",
            "temps_limite": 24,
            "description": (
                "Circuit AMRAP 24 min — pompes larges introduites :\n"
                "  1. 5 Tractions pronation\n"
                "  2. 8 Dips aux parallettes\n"
                "  3. 6 Pompes prise large\n"
                "  4. 15 Sit ups\n"
                "  5. 20 Squats poids du corps\n"
                "  6. 6 Pistol squat gauche\n"
                "  7. 6 Pistol squat droit"
            ),
            "exercices": [
                {"slug": "traction-stricte",    "reps": 5,  "tempo": "X/1/2/0"},
                {"slug": "dip-parallettes",     "reps": 8,  "tempo": "2/1/X/0"},
                {"slug": "pompe-large",         "reps": 6,  "tempo": "2/1/X/0"},
                {"slug": "sit-up",              "reps": 15, "tempo": "X/0/2/0"},
                {"slug": "squat-bw",            "reps": 20, "tempo": "3/1/X/0"},
                {"slug": "pistol-squat-gauche", "reps": 6,  "tempo": "3/1/X/0"},
                {"slug": "pistol-squat-droit",  "reps": 6,  "tempo": "3/1/X/0"},
            ]
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM PULL — S3 (32 min)",
            "temps_limite": 32,
            "description": (
                "Structure EMOM PULL — progression vs S1 :\n"
                "  • Bloc A — 9 min : Traction stricte X/1/2/0\n"
                "      3 reps → 4 reps → 5 reps\n"
                "  • Bloc B — 9 min : Dips (libre)\n"
                "      4 reps → 5 reps → 6 reps\n"
                "  • Bloc C — 5 min : Traction australienne\n"
                "      11 reps × 5\n"
                "  • Bloc D — 9 min : Curl biceps + Hollow\n"
                "      8 reps / 25 sec hold (alternés)"
            ),
            "exercices": [
                {"slug": "traction-stricte",    "reps": 4,    "tempo": "X/1/2/0", "pause_iso": 1.0},
                {"slug": "dip-parallettes",     "reps": 5,    "tempo": None},
                {"slug": "traction-australienne","reps": 11,   "tempo": "X/1/2/0"},
                {"slug": "curl-biceps-traction", "reps": 8,    "tempo": "X/1/2/0"},
                {"slug": "hollow-actif",         "reps": None, "tempo": None},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 60 min",
            "zone": ZoneCourse.Z2, "duree_min": 60, "dplus_m": 200,
            "description": (
                "Terrain : trail (D+ 200 m).\n"
                "+5 min vs S2. Allure Z2 sur tout le parcours.\n"
                "1h de course longue — premier palier significatif."
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S4 — Pic adaptation | AMRAP 30min | SL 65min trail
    # -----------------------------------------------------------------------
    4: [
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH (barres) — S4 (27 min)",
            "temps_limite": 27,
            "description": (
                "Structure EMOM PUSH variante barres — 3 blocs :\n"
                "  • Bloc A — 9 min : Dips *barre droite de traction\n"
                "      Tenir la barre horizontale, dips pieds surélevés si possible\n"
                "  • Bloc B — 9 min : Traction australienne (libre)\n"
                "      5 reps × 9 minutes\n"
                "  • Bloc C — 9 min : Traction stricte + hold\n"
                "      12 reps / 30 sec en position haute (alternés)"
            ),
            "exercices": [
                {"slug": "dip-parallettes",      "reps": 8,  "tempo": "2/1/X/0"},
                {"slug": "traction-australienne", "reps": 5,  "tempo": "X/1/2/0"},
                {"slug": "traction-stricte",     "reps": 12, "tempo": "X/1/2/0", "pause_iso": 1.0},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 30 min FULL BODY — S4",
            "temps_limite": 30,
            "description": (
                "Circuit AMRAP 30 min — circuit le plus complet de la phase Adaptation :\n"
                "  1. 10 Tractions australiennes\n"
                "  2. 10 Dips aux parallettes\n"
                "  3. 10 Pompes prise large\n"
                "  4. 30 sec Hollow body actif\n"
                "  5. 10 Squats poids du corps\n"
                "  6. 5 Tractions strictes (*bascule tapis = pieds sur step)\n"
                "  7. 6 Pistol squat gauche\n"
                "  8. 6 Pistol squat droit"
            ),
            "exercices": [
                {"slug": "traction-australienne","reps": 10,   "tempo": "X/1/2/0"},
                {"slug": "dip-parallettes",     "reps": 10,   "tempo": "2/1/X/0"},
                {"slug": "pompe-large",         "reps": 10,   "tempo": "2/1/X/0"},
                {"slug": "hollow-actif",        "reps": None, "tempo": None},
                {"slug": "squat-bw",            "reps": 10,   "tempo": "3/1/X/0"},
                {"slug": "traction-stricte",    "reps": 5,    "tempo": "X/1/2/0"},
                {"slug": "pistol-squat-gauche", "reps": 6,    "tempo": "3/1/X/0"},
                {"slug": "pistol-squat-droit",  "reps": 6,    "tempo": "3/1/X/0"},
            ]
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM PULL (curl + hollow) — S4 (9 min)",
            "temps_limite": 9,
            "description": (
                "Structure EMOM PULL condensé — 1 bloc :\n"
                "  • Bloc A — 9 min : Curl biceps en traction + Hollow actif\n"
                "      12 reps curl / 25 sec hollow (alternés)"
            ),
            "exercices": [
                {"slug": "curl-biceps-traction", "reps": 12,   "tempo": "X/1/2/0"},
                {"slug": "hollow-actif",          "reps": None, "tempo": None},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 65 min",
            "zone": ZoneCourse.Z2, "duree_min": 65, "dplus_m": 250,
            "description": (
                "Terrain : trail (D+ 250 m).\n"
                "+5 min vs S3. Pic de la sortie longue en phase Adaptation.\n"
                "Gérer l'allure Z2 sur tout le dénivelé."
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S5 — Consolidation | Seuil 3×11min | EF 35min (pas d'AMRAP)
    # -----------------------------------------------------------------------
    5: [
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH (trac austr) — S5 (23 min)",
            "temps_limite": 23,
            "description": (
                "Structure EMOM PUSH — 3 blocs (progression reps, plus d'AMRAP cette semaine) :\n"
                "  • Bloc A — 9 min : Traction australienne* (libre)\n"
                "      5 reps × 9 min\n"
                "  • Bloc B — 5 min : Dips aux parallettes\n"
                "      13 reps × 5 min\n"
                "  • Bloc C — 9 min : Pompes + hold\n"
                "      13 reps / 35 sec position haute (alternés)"
            ),
            "exercices": [
                {"slug": "traction-australienne","reps": 5,  "tempo": None},
                {"slug": "dip-parallettes",      "reps": 13, "tempo": "2/1/X/0"},
                {"slug": "pompe-standard",       "reps": 13, "tempo": "2/1/X/0"},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "EF Z2 — 35 min",
            "zone": ZoneCourse.Z2, "duree_min": 35, "dplus_m": 0,
            "description": (
                "Terrain : route plate.\n"
                "Récupération active. Allure Z2 confortable — semaine sans AMRAP."
            ),
        },
        {
            "jour": 4, "type": TypeSeance.COURSE, "titre": "Seuil Z4 — ~50 min (3×11 min R=2 min)",
            "zone": ZoneCourse.Z4, "duree_min": 50, "dplus_m": 0,
            "description": (
                "Terrain : route plate ou piste.\n"
                "Structure :\n"
                "  • Échauffement : 8 min Z1/Z2\n"
                "  • 3 × 11 min Z4 (87-95% VMA) / 2 min récup Z1 trot\n"
                "  • Retour au calme : 5 min Z1\n"
                "Total : ~50 min. +1 min / bloc vs S3."
            ),
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM PULL — S5 (9 min)",
            "temps_limite": 9,
            "description": (
                "Structure EMOM PULL condensé — 1 bloc :\n"
                "  • Bloc A — 9 min (triplet) : Traction → Dips → Traction australienne\n"
                "      1 rep (min 1,4,7) / 2 reps (min 2,5,8) / 3 reps (min 3,6,9)"
            ),
            "exercices": [
                {"slug": "traction-stricte",     "reps": 2,  "tempo": "X/1/2/0"},
                {"slug": "dip-parallettes",      "reps": 2,  "tempo": "2/1/X/0"},
                {"slug": "traction-australienne","reps": 3,  "tempo": "X/1/2/0"},
            ]
        },
    ],

    # -----------------------------------------------------------------------
    # S6 — Décharge | Volume -30% | EMOM léger, pas d'AMRAP
    # -----------------------------------------------------------------------
    6: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Récupération active Z1 — 30 min",
            "zone": ZoneCourse.Z1, "duree_min": 30, "dplus_m": 0,
            "description": "Terrain : route souple. Allure très légère Z1. Récupération avant semaine 7.",
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH (décharge) — S6 (14 min)",
            "temps_limite": 14,
            "description": (
                "Structure EMOM PUSH décharge — 2 blocs :\n"
                "  • Bloc A — 5 min : Dips + Pompes\n"
                "      14 reps × 5 min\n"
                "  • Bloc B — 9 min : Pompes + hold\n"
                "      14 reps / 35 sec position haute (alternés)"
            ),
            "exercices": [
                {"slug": "dip-parallettes", "reps": 14, "tempo": "2/1/X/0"},
                {"slug": "pompe-standard",  "reps": 14, "tempo": "2/0/X/0"},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.DECHARGE, "titre": "Mobilité & Foam rolling — 45 min",
            "description": (
                "  • 15 min foam rolling : mollets, ischio, fessiers, dorsaux, pectoraux\n"
                "  • 20 min étirements statiques profonds (30 sec / position, 2 séries)\n"
                "  • 10 min respiration abdominale et relaxation"
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S7 — Affûtage | Test VMA + 30min Z2
    # -----------------------------------------------------------------------
    7: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Prépa Test VMA — 30 min Z2",
            "zone": ZoneCourse.Z2, "duree_min": 30, "dplus_m": 0,
            "description": (
                "Terrain : piste ou route plate mesurée.\n"
                "30 min Z2 + 3 accélérations de 30 sec à allure Cooper.\n"
                "Calibrer le ressenti pour le test de S8."
            ),
        },
        {
            "jour": 2, "type": TypeSeance.DECHARGE, "titre": "Étirements & Visualisation — 60 min",
            "description": (
                "  • 20 min mobilité hanches et épaules (yoga)\n"
                "  • 20 min étirements profonds chaîne postérieure\n"
                "  • 10 min gainage doux (planche 3×30 sec)\n"
                "  • 10 min visualisation mentale des 3 tests de S8"
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S8 — ÉVALUATION J60 (Objectif J60 : 3 tours AMRAP)
    # -----------------------------------------------------------------------
    8: [
        {
            "jour": 1, "type": TypeSeance.EVALUATION, "titre": "Test VMA — Demi-Cooper (6 min)",
            "duree_min": 30,
            "description": (
                "Terrain : piste d'athlétisme ou parcours plat mesuré.\n"
                "Protocole :\n"
                "  • Échauffement : 10 min progressif + 2×30 sec à allure cible\n"
                "  • Test : 6 min à allure maximale soutenable\n"
                "  • VMA = distance (m) ÷ 100\n"
                "  • Zones Z1-Z5 recalculées automatiquement"
            ),
        },
        {
            "jour": 3, "type": TypeSeance.EVALUATION, "titre": "Max Reps 1 min — 6 mouvements (J60)",
            "duree_min": 50,
            "description": (
                "Protocole J60 — 6 mouvements, 3-5 min de repos entre chaque :\n"
                "  1. Tractions pronation strictes\n"
                "  2. Dips aux parallettes\n"
                "  3. Sit ups\n"
                "  4. Squats poids du corps\n"
                "  5. Pistol squat gauche\n"
                "  6. Pistol squat droit\n"
                "Score : répétitions complètes en 60 sec strictes."
            ),
        },
        {
            "jour": 5, "type": TypeSeance.EVALUATION, "titre": "AMRAP Benchmark — 10 min (J60)",
            "temps_limite": 10, "duree_min": 20,
            "description": (
                "Circuit fixe EPC :\n"
                "  10 Tractions → 10 Pompes → 10 Squats → 10 Dips → 10 Burpees → 10 Mountain Climbers\n"
                "Score en tours (ex. 3.4).\n"
                "Objectif J60 : 3 tours complets."
            ),
        },
    ],
}


# ============================================================================
# MODULE 2 — RÉVÉLATION : 8 semaines
# ============================================================================

MODULE2 = {

    # -----------------------------------------------------------------------
    # S1 — Entrée Module 2 | AMRAP 25min | SL 1h30 Z2
    # -----------------------------------------------------------------------
    1: [
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH — Module 2 S1 (34 min)",
            "temps_limite": 34,
            "description": (
                "Structure EMOM PUSH Module 2 — 4 blocs :\n"
                "  • Bloc A — 10 min : Dips (tempo 2/1/X/0)\n"
                "      3 reps × 10 min\n"
                "  • Bloc B — 9 min : Traction australienne\n"
                "      2 reps → 3 reps → 4 reps (9D2/3/4)\n"
                "  • Bloc C — 6 min : Dips partiel (amplitude réduite)\n"
                "      5 reps × 6 min\n"
                "  • Bloc D — 9 min : Triceps extension / Rotateur long / Repos (triplet)\n"
                "      10 reps triceps (min 1,4,7) / 10 reps rotateur long (min 2,5,8) / repos"
            ),
            "exercices": [
                {"slug": "dip-parallettes",       "reps": 3,  "tempo": "2/1/X/0"},
                {"slug": "traction-australienne",  "reps": 3,  "tempo": "X/1/2/0"},
                {"slug": "dip-partiel",            "reps": 5,  "tempo": "2/1/X/0"},
                {"slug": "triceps-extension-dips", "reps": 10, "tempo": "2/1/X/0"},
                {"slug": "rotateur-long",          "reps": 10, "tempo": "2/1/X/0"},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Seuil Z3/Z4 — ~45 min",
            "zone": ZoneCourse.Z3, "duree_min": 45, "dplus_m": 0,
            "description": (
                "Terrain : route plate.\n"
                "Structure :\n"
                "  • Échauffement : 8 min Z2\n"
                "  • 3 × 10 min Z3/Z4 (80-95% VMA) / 2 min récup Z1\n"
                "  • Retour : 5 min Z1\n"
                "1ère séance seuil du Module 2."
            ),
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 25 min FULL BODY — Module 2 S1",
            "temps_limite": 25,
            "description": (
                "Circuit AMRAP 25 min Module 2 — nouveaux mouvements introduits :\n"
                "  1. 5 Tractions pronation\n"
                "  2. 5 Dips aux parallettes\n"
                "  3. 10 Squats poids du corps\n"
                "  4. 10 Mountain climbers (par jambe)\n"
                "  5. 10 Burpees\n"
                "  6. 10 Pistol squat gauche\n"
                "  7. 10 Pistol squat droit\n"
                "  8. Chaise isométrique 30 sec (wall sit)\n"
                "Reps pistol × 10 au lieu de × 6 — niveau Module 2."
            ),
            "exercices": [
                {"slug": "traction-stricte",    "reps": 5,    "tempo": "X/1/2/0"},
                {"slug": "dip-parallettes",     "reps": 5,    "tempo": "2/1/X/0"},
                {"slug": "squat-bw",            "reps": 10,   "tempo": "3/1/X/0"},
                {"slug": "mountain-climber",    "reps": 10,   "tempo": "X/0/X/0"},
                {"slug": "burpee",              "reps": 10,   "tempo": "X/0/X/0"},
                {"slug": "pistol-squat-gauche", "reps": 10,   "tempo": "3/1/X/0"},
                {"slug": "pistol-squat-droit",  "reps": 10,   "tempo": "3/1/X/0"},
                {"slug": "chaise-isometrique",  "reps": None, "tempo": None},
            ]
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM PULL — Module 2 S1 (38 min)",
            "temps_limite": 38,
            "description": (
                "Structure EMOM PULL Module 2 — 4 blocs :\n"
                "  • Bloc A — 10 min : Traction stricte X/1/2/0\n"
                "      2 reps × 10 min\n"
                "  • Bloc B — 9 min : Traction partielle / Curl biceps / Le Y (triplet)\n"
                "      10 reps trac partielle (min 1,4,7) / curl biceps (min 2,5,8) / le Y (alternés)\n"
                "  • Bloc C — 9 min : Curl biceps / Le Y / Repos (triplet)\n"
                "      10 reps curl (min 1,4,7) / 10 reps Le Y (min 2,5,8) / repos\n"
                "  • Bloc D — 10 min : Traction australienne\n"
                "      3 reps → 4 reps → 5 reps (10D3/4/5)"
            ),
            "exercices": [
                {"slug": "traction-stricte",     "reps": 2,  "tempo": "X/1/2/0", "pause_iso": 1.0},
                {"slug": "traction-partielle",   "reps": 10, "tempo": "X/1/2/0"},
                {"slug": "curl-biceps-traction", "reps": 10, "tempo": "X/1/2/0"},
                {"slug": "le-y",                 "reps": 10, "tempo": "2/1/X/0"},
                {"slug": "traction-australienne","reps": 4,  "tempo": "X/1/2/0"},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 1h30",
            "zone": ZoneCourse.Z2, "duree_min": 90, "dplus_m": 400,
            "description": (
                "Terrain : trail (D+ 400 m).\n"
                "Durée : 1h30 en Z2 — entrée dans les sorties longues Module 2.\n"
                "Marcher les montées pour rester en Z2. Ravitaillement à 45 min."
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S2 — Volume + | AMRAP 28min | SL 1h50 Z2
    # -----------------------------------------------------------------------
    2: [
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH — Module 2 S2 (27 min)",
            "temps_limite": 27,
            "description": (
                "Structure EMOM PUSH — 3 blocs :\n"
                "  • Bloc A — 9 min : Traction australienne\n"
                "      3 reps → 4 reps → 5 reps (9D3/4/5)\n"
                "  • Bloc B — 9 min : Triceps ext / Rotateur long / Sit ups (triplet)\n"
                "      11 reps / 11 reps / 30 sec (cycle × 3)\n"
                "  • Bloc C — 9 min : Curl biceps / Le Y / Position traction (triplet)\n"
                "      11 reps / 11 reps / 30 sec hold"
            ),
            "exercices": [
                {"slug": "traction-australienne",  "reps": 4,  "tempo": "X/1/2/0"},
                {"slug": "triceps-extension-dips", "reps": 11, "tempo": "2/1/X/0"},
                {"slug": "rotateur-long",          "reps": 11, "tempo": "2/1/X/0"},
                {"slug": "sit-up",                 "reps": 11, "tempo": "X/0/2/0"},
                {"slug": "curl-biceps-traction",   "reps": 11, "tempo": "X/1/2/0"},
                {"slug": "le-y",                   "reps": 11, "tempo": "2/1/X/0"},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "EF Z2 — 40 min",
            "zone": ZoneCourse.Z2, "duree_min": 40, "dplus_m": 0,
            "description": "Terrain : route ou chemin. EF Z2 récupération avant l'AMRAP.",
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 28 min FULL BODY — Module 2 S2",
            "temps_limite": 28,
            "description": (
                "Circuit AMRAP 28 min — +3 min vs S1, sit ups introduits :\n"
                "  1. 5 Tractions pronation\n"
                "  2. 5 Dips aux parallettes\n"
                "  3. 10 Squats poids du corps\n"
                "  4. 10 Mountain climbers\n"
                "  5. 10 Burpees\n"
                "  6. 10 Pistol squat gauche\n"
                "  7. 10 Pistol squat droit\n"
                "  8. 10 Sit ups\n"
                "  9. Chaise isométrique 30 sec"
            ),
            "exercices": [
                {"slug": "traction-stricte",    "reps": 5,    "tempo": "X/1/2/0"},
                {"slug": "dip-parallettes",     "reps": 5,    "tempo": "2/1/X/0"},
                {"slug": "squat-bw",            "reps": 10,   "tempo": "3/1/X/0"},
                {"slug": "mountain-climber",    "reps": 10,   "tempo": "X/0/X/0"},
                {"slug": "burpee",              "reps": 10,   "tempo": "X/0/X/0"},
                {"slug": "pistol-squat-gauche", "reps": 10,   "tempo": "3/1/X/0"},
                {"slug": "pistol-squat-droit",  "reps": 10,   "tempo": "3/1/X/0"},
                {"slug": "sit-up",              "reps": 10,   "tempo": "X/0/2/0"},
                {"slug": "chaise-isometrique",  "reps": None, "tempo": None},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 1h50",
            "zone": ZoneCourse.Z2, "duree_min": 110, "dplus_m": 700,
            "description": (
                "Terrain : trail (D+ 700 m).\n"
                "+20 min vs S1. Dénivelé significatif — gestion stricte de la zone Z2.\n"
                "Ravitaillement à 55 min recommandé."
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S3 — Pic Module 2 | AMRAP 30min | SL 2h10 trail D+1000m
    # -----------------------------------------------------------------------
    3: [
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH (pauses) — Module 2 S3 (34 min)",
            "temps_limite": 34,
            "description": (
                "Structure EMOM PUSH avec pauses X/1/X/0 — 3 blocs :\n"
                "  • Bloc A — 10 min : Dips (pause X/1/X/0)\n"
                "      4 reps × 10 min\n"
                "  • Bloc B — 6 min : Dips partiel\n"
                "      6 reps × 6 min\n"
                "  • Bloc C — 9 min : Triceps ext / Pompes larges / Sit ups (triplet)\n"
                "      12 reps / 12 reps / 12 reps (cycle × 3)"
            ),
            "exercices": [
                {"slug": "dip-parallettes",       "reps": 4,  "tempo": "X/1/X/0", "pause_iso": 1.0},
                {"slug": "dip-partiel",            "reps": 6,  "tempo": "2/1/X/0"},
                {"slug": "triceps-extension-dips", "reps": 12, "tempo": "2/1/X/0"},
                {"slug": "pompe-large",            "reps": 12, "tempo": "2/1/X/0"},
                {"slug": "sit-up",                 "reps": 12, "tempo": "X/0/2/0"},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 30 min FULL BODY — Module 2 S3",
            "temps_limite": 30,
            "description": (
                "Circuit AMRAP 30 min (PDF Module 2 S3) :\n"
                "  1. 10 Tractions australiennes\n"
                "  2. 10 Squats poids du corps\n"
                "  3. 10 Pompes prise large\n"
                "  4. 10 Dips aux parallettes\n"
                "  5. 10 Extensions de hanche (pont fessier)\n"
                "Circuit différent du Module 1 — focus postérieur."
            ),
            "exercices": [
                {"slug": "traction-australienne","reps": 10, "tempo": "X/1/2/0"},
                {"slug": "squat-bw",            "reps": 10, "tempo": "3/1/X/0"},
                {"slug": "pompe-large",         "reps": 10, "tempo": "2/1/X/0"},
                {"slug": "dip-parallettes",     "reps": 10, "tempo": "2/1/X/0"},
                {"slug": "extension-hanche",    "reps": 10, "tempo": "2/1/X/0"},
            ]
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM PULL — Module 2 S3 (9 min)",
            "temps_limite": 9,
            "description": (
                "Structure EMOM PULL — 1 bloc :\n"
                "  • Bloc A — 9 min : Traction / Curl biceps + Le Y / Hold (triplet)\n"
                "      12 reps traction (min 1,4,7) / 12 reps curl+LeY (min 2,5,8) / 30 sec hold"
            ),
            "exercices": [
                {"slug": "traction-stricte",     "reps": 12, "tempo": "X/1/2/0"},
                {"slug": "curl-biceps-traction", "reps": 12, "tempo": "X/1/2/0"},
                {"slug": "le-y",                 "reps": 12, "tempo": "2/1/X/0"},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 2h10",
            "zone": ZoneCourse.Z2, "duree_min": 130, "dplus_m": 1000,
            "description": (
                "Terrain : trail (D+ 1000 m) — séance la plus longue du programme.\n"
                "Durée : 2h10 en Z2 strict. Marcher toutes les montées raides.\n"
                "Ravitaillement obligatoire : eau + glucides à 1h05."
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S4 — 2e pic / amorce décharge | AMRAP 32min | Seuil + SL 1h45 D+600m
    # -----------------------------------------------------------------------
    4: [
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH — Module 2 S4 (24 min)",
            "temps_limite": 24,
            "description": (
                "Structure EMOM PUSH — 3 blocs :\n"
                "  • Bloc A — 9 min : Pompes + Traction australienne (alternés)\n"
                "      Pompes libres (min 1,3,5,7,9) / trac austr libres (min 2,4,6,8)\n"
                "  • Bloc B — 6 min : Dips partiel\n"
                "      7 reps × 6 min\n"
                "  • Bloc C — 9 min : Triceps ext / Rotateur long (triplet + hold)\n"
                "      13 reps / 13 reps / 30 sec hold (cycle × 3)"
            ),
            "exercices": [
                {"slug": "pompe-standard",         "reps": 10, "tempo": "2/1/X/0"},
                {"slug": "traction-australienne",  "reps": 10, "tempo": "X/1/2/0"},
                {"slug": "dip-partiel",            "reps": 7,  "tempo": "2/1/X/0"},
                {"slug": "triceps-extension-dips", "reps": 13, "tempo": "2/1/X/0"},
                {"slug": "rotateur-long",          "reps": 13, "tempo": "2/1/X/0"},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Seuil Z4 — ~45 min (D+ 100 m)",
            "zone": ZoneCourse.Z4, "duree_min": 45, "dplus_m": 100,
            "description": (
                "Terrain : chemin vallonné (D+ 100 m).\n"
                "Structure : 3 × 10 min Z4 / 2 min récup. Seuil sur terrain légèrement accidenté."
            ),
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 32 min FULL BODY — Module 2 S4",
            "temps_limite": 32,
            "description": (
                "Circuit AMRAP 32 min — pic AMRAP du Module 2 :\n"
                "  1. 10 Sit ups\n"
                "  2. 10 Tractions australiennes\n"
                "  3. 10 Squats poids du corps\n"
                "  4. 10 Pompes prise large\n"
                "  5. 10 Dips aux parallettes\n"
                "  6. 10 Extensions de hanche\n"
                "  7. 10 Burpees"
            ),
            "exercices": [
                {"slug": "sit-up",              "reps": 10, "tempo": "X/0/2/0"},
                {"slug": "traction-australienne","reps": 10, "tempo": "X/1/2/0"},
                {"slug": "squat-bw",            "reps": 10, "tempo": "3/1/X/0"},
                {"slug": "pompe-large",         "reps": 10, "tempo": "2/1/X/0"},
                {"slug": "dip-parallettes",     "reps": 10, "tempo": "2/1/X/0"},
                {"slug": "extension-hanche",    "reps": 10, "tempo": "2/1/X/0"},
                {"slug": "burpee",              "reps": 10, "tempo": "X/0/X/0"},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 1h45",
            "zone": ZoneCourse.Z2, "duree_min": 105, "dplus_m": 600,
            "description": (
                "Terrain : trail (D+ 600 m).\n"
                "-25 min vs S3 — décharge du volume mais maintien du D+.\n"
                "Allure Z2 sur tout le parcours."
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S5 — Décharge amorçée | AMRAP 20min | SL 1h30 D+500m
    # -----------------------------------------------------------------------
    5: [
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH (libre) — Module 2 S5 (18 min)",
            "temps_limite": 18,
            "description": (
                "Structure EMOM PUSH amorce décharge — 2 blocs :\n"
                "  • Bloc A — 9 min : Exercice au choix (libre)\n"
                "      5 reps × 9 min — focus technique\n"
                "  • Bloc B — 9 min : Curl biceps / Le Y / Position traction (triplet + hold)\n"
                "      14 reps / 14 reps / 30 sec (cycle × 3)"
            ),
            "exercices": [
                {"slug": "traction-australienne","reps": 5,    "tempo": None},
                {"slug": "curl-biceps-traction", "reps": 14,   "tempo": "X/1/2/0"},
                {"slug": "le-y",                 "reps": 14,   "tempo": "2/1/X/0"},
                {"slug": "traction-partielle",   "reps": None, "tempo": "X/1/2/0"},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 20 min — Module 2 S5 (décharge)",
            "temps_limite": 20,
            "description": (
                "Circuit AMRAP 20 min — circuit réduit, début de décharge :\n"
                "  14 Triceps extension / 14 Rotateur long / 14 Pompes\n"
                "  → Répéter en circuit fermé pendant 20 min\n"
                "Focus : maintien de la technique, pas de la performance."
            ),
            "exercices": [
                {"slug": "triceps-extension-dips","reps": 14, "tempo": "2/1/X/0"},
                {"slug": "rotateur-long",         "reps": 14, "tempo": "2/1/X/0"},
                {"slug": "pompe-standard",        "reps": 14, "tempo": "2/0/X/0"},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 1h30 (D+ 500 m)",
            "zone": ZoneCourse.Z2, "duree_min": 90, "dplus_m": 500,
            "description": (
                "Terrain : trail (D+ 500 m).\n"
                "-15 min vs S4 — poursuite de la décharge avant tests.\n"
                "Allure Z2 sans effort perçu."
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S6 — Décharge complète | AMRAP 15min
    # -----------------------------------------------------------------------
    6: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Récupération active Z1 — 25 min",
            "zone": ZoneCourse.Z1, "duree_min": 25, "dplus_m": 0,
            "description": "Terrain : route souple. Très légère, aucun effort ressenti.",
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH (décharge) — Module 2 S6 (15 min)",
            "temps_limite": 15,
            "description": (
                "Structure EMOM PUSH décharge — 2 blocs :\n"
                "  • Bloc A — 6 min : Dips + Pompes\n"
                "      10 reps × 6 min\n"
                "  • Bloc B — 9 min : Triceps ext / Rotateur long (triplet + hold)\n"
                "      10 reps / 10 reps / 30 sec"
            ),
            "exercices": [
                {"slug": "dip-parallettes",       "reps": 10, "tempo": "2/1/X/0"},
                {"slug": "pompe-standard",        "reps": 10, "tempo": "2/0/X/0"},
                {"slug": "triceps-extension-dips","reps": 10, "tempo": "2/1/X/0"},
                {"slug": "rotateur-long",         "reps": 10, "tempo": "2/1/X/0"},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 15 min FULL BODY — Module 2 S6",
            "temps_limite": 15,
            "description": (
                "Circuit AMRAP 15 min décharge (PDF Module 2 S6) :\n"
                "  10 reps × 5 mouvements en triplet EMOM\n"
                "  → 10 Tractions australiennes / 10 Squats / 10 Pompes / 10 Burpees / 10 Mountain climbers\n"
                "Reps réduites, aucune pause isométrique."
            ),
            "exercices": [
                {"slug": "traction-australienne","reps": 10, "tempo": "X/1/2/0"},
                {"slug": "squat-bw",            "reps": 10, "tempo": "3/1/X/0"},
                {"slug": "pompe-standard",      "reps": 10, "tempo": "2/0/X/0"},
                {"slug": "burpee",              "reps": 10, "tempo": "X/0/X/0"},
                {"slug": "mountain-climber",    "reps": 10, "tempo": "X/0/X/0"},
            ]
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM PULL (décharge) — Module 2 S6 (28 min)",
            "temps_limite": 28,
            "description": (
                "Structure EMOM PULL décharge — 3 blocs :\n"
                "  • Bloc A — 10 min : Traction stricte\n"
                "      5 reps × 10 min\n"
                "  • Bloc B — 9 min : Traction australienne\n"
                "      3 reps × 9 min\n"
                "  • Bloc C — 9 min : Curl biceps / Le Y / Traction partielle (triplet)\n"
                "      10 reps / 10 reps / 10 reps"
            ),
            "exercices": [
                {"slug": "traction-stricte",     "reps": 5,  "tempo": "X/1/2/0"},
                {"slug": "traction-australienne","reps": 3,  "tempo": "X/1/2/0"},
                {"slug": "curl-biceps-traction", "reps": 10, "tempo": "X/1/2/0"},
                {"slug": "le-y",                 "reps": 10, "tempo": "2/1/X/0"},
                {"slug": "traction-partielle",   "reps": 10, "tempo": "X/1/2/0"},
            ]
        },
    ],

    # -----------------------------------------------------------------------
    # S7 — Affûtage | Étirements + Activation + Test VMA prep
    # -----------------------------------------------------------------------
    7: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Activation Z1 — 20 min",
            "zone": ZoneCourse.Z1, "duree_min": 20, "dplus_m": 0,
            "description": "Terrain : route souple. Très légère, activation sans fatigue.",
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "Activation neuromusculaire (Module 2 S7)",
            "temps_limite": 15,
            "description": (
                "Protocole Module 2 S7 :\n"
                "  • 10 Tractions australiennes lentes\n"
                "  • 10 Pompes lentes (tempo 3/1/3/0)\n"
                "  • 10 Squats profonds\n"
                "  • 10 Burpees contrôlés\n"
                "  • 10 Mountain climbers lents\n"
                "Aucune intensité — schémas moteurs uniquement."
            ),
            "exercices": [
                {"slug": "traction-australienne","reps": 10, "tempo": "X/1/3/0"},
                {"slug": "pompe-standard",       "reps": 10, "tempo": "3/1/3/0"},
                {"slug": "squat-bw",             "reps": 10, "tempo": "3/1/X/0"},
                {"slug": "burpee",               "reps": 10, "tempo": "X/0/X/0"},
                {"slug": "mountain-climber",     "reps": 10, "tempo": "X/0/X/0"},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Prépa Demi-Cooper — 30 min Z2",
            "zone": ZoneCourse.Z2, "duree_min": 30, "dplus_m": 0,
            "description": (
                "Terrain : piste d'athlétisme ou route plate mesurée.\n"
                "30 min Z2 + 3 accélérations 30 sec à allure Cooper.\n"
                "Objectif J120 : 1700 m (VMA 17 km/h)."
            ),
        },
        {
            "jour": 4, "type": TypeSeance.DECHARGE, "titre": "Étirements profonds & Visualisation — 60 min",
            "description": (
                "  • 20 min mobilité hanches et épaules (yoga)\n"
                "  • 20 min étirements profonds chaîne postérieure\n"
                "  • 10 min gainage doux (planche 3×30 sec)\n"
                "  • 10 min visualisation mentale des 3 tests J120"
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S8 — ÉVALUATION J120 (Objectifs : 1700m Cooper / 10 trac / 3 tours AMRAP)
    # -----------------------------------------------------------------------
    8: [
        {
            "jour": 1, "type": TypeSeance.EVALUATION, "titre": "Test VMA — Demi-Cooper J120",
            "duree_min": 30,
            "description": (
                "Terrain : piste d'athlétisme ou parcours plat mesuré.\n"
                "  • Échauffement : 10 min progressif + 2×30 sec à allure cible\n"
                "  • Test : 6 min à allure maximale soutenable\n"
                "  • VMA = distance (m) ÷ 100\n"
                "Objectif J120 : 1700 m (VMA 17 km/h)"
            ),
        },
        {
            "jour": 3, "type": TypeSeance.EVALUATION, "titre": "Max Reps 1 min — 7 mouvements (J120)",
            "duree_min": 60,
            "description": (
                "Protocole J120 — 7 mouvements, 3-5 min de repos entre chaque :\n"
                "  1. Tractions pronation strictes\n"
                "  2. Dips aux parallettes\n"
                "  3. Pompes standard\n"
                "  4. Sit ups\n"
                "  5. Squats poids du corps\n"
                "  6. Pistol squat gauche\n"
                "  7. Pistol squat droit\n"
                "Objectifs J120 : 10 trac / 20 dips / 40 pompes / 30 sit ups / 45 squats / 15 pistol G / 15 pistol D"
            ),
        },
        {
            "jour": 5, "type": TypeSeance.EVALUATION, "titre": "AMRAP Benchmark — 10 min (J120)",
            "temps_limite": 10, "duree_min": 25,
            "description": (
                "Circuit fixe EPC :\n"
                "  10 Tractions → 10 Pompes → 10 Squats → 10 Dips → 10 Burpees → 10 Mountain Climbers\n"
                "Objectif J120 : 3 tours complets."
            ),
        },
    ],
}


# ============================================================================
# MODULE 3 — CONFIRMATION : 8 semaines
# Structure fixe : 1 EF + 1 Seuil/Fraco + 1 SL + 1 EMOM + 1 AMRAP
# Reprise depuis le pic Module 2 (SL 2h10 D+1000m, AMRAP 32min)
# Jours : L(1)=EF | M(2)=EMOM | Me(3)=Seuil | J(4)=AMRAP | V(5)=repos | S(6)=SL | D(7)=repos
# ============================================================================

MODULE3 = {

    # -----------------------------------------------------------------------
    # S1 — Reprise progressive | SL 1h45 D+600m | AMRAP 28min | Seuil 3×10min
    # -----------------------------------------------------------------------
    1: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "EF Z2 — 40 min",
            "zone": ZoneCourse.Z2, "duree_min": 40, "dplus_m": 50,
            "description": "Terrain : route ou chemin souple (D+ 50 m).\nAllure Z2 conversationnelle. Reprise après évaluation M2.",
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM — Module 3 S1 (28 min)",
            "temps_limite": 28,
            "description": (
                "Structure EMOM — 3 blocs (reprise du niveau M2 S1) :\n"
                "  • Bloc A — 10 min : Dips aux parallettes (pause basse)\n"
                "      3 reps × 10 min (tempo 2/1/X/0)\n"
                "  • Bloc B — 9 min : Traction australienne / Curl biceps / Le Y (triplet)\n"
                "      10 reps / 10 reps / repos (cycle × 3)\n"
                "  • Bloc C — 9 min : Triceps ext / Rotateur long / Sit ups (triplet)\n"
                "      10 reps / 10 reps / 30 sec hold (cycle × 3)"
            ),
            "exercices": [
                {"slug": "dip-parallettes",       "reps": 3,  "tempo": "2/1/X/0"},
                {"slug": "traction-australienne",  "reps": 10, "tempo": "X/1/2/0"},
                {"slug": "curl-biceps-traction",   "reps": 10, "tempo": "X/1/2/0"},
                {"slug": "le-y",                   "reps": 10, "tempo": "2/1/X/0"},
                {"slug": "triceps-extension-dips", "reps": 10, "tempo": "2/1/X/0"},
                {"slug": "rotateur-long",          "reps": 10, "tempo": "2/1/X/0"},
                {"slug": "sit-up",                 "reps": 10, "tempo": "X/0/2/0"},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Seuil Z4 — 45 min (3×10 min R=2 min)",
            "zone": ZoneCourse.Z4, "duree_min": 45, "dplus_m": 0,
            "description": (
                "Terrain : route plate.\n"
                "• Échauffement : 8 min Z2\n"
                "• 3 × 10 min Z4 (87-95% VMA) / 2 min récup trot Z1\n"
                "• Retour : 5 min Z1\n"
                "Allure seuil = allure semi-marathon environ."
            ),
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 28 min — Module 3 S1",
            "temps_limite": 28,
            "description": (
                "Circuit AMRAP 28 min (reprise niveau M2) :\n"
                "  1. 5 Tractions pronation\n"
                "  2. 5 Dips aux parallettes\n"
                "  3. 10 Squats poids du corps\n"
                "  4. 10 Mountain climbers\n"
                "  5. 10 Burpees\n"
                "  6. 10 Pistol squat gauche\n"
                "  7. 10 Pistol squat droit\n"
                "  8. Chaise isométrique 30 sec"
            ),
            "exercices": [
                {"slug": "traction-stricte",    "reps": 5,    "tempo": "X/1/2/0"},
                {"slug": "dip-parallettes",     "reps": 5,    "tempo": "2/1/X/0"},
                {"slug": "squat-bw",            "reps": 10,   "tempo": "3/1/X/0"},
                {"slug": "mountain-climber",    "reps": 10,   "tempo": "X/0/X/0"},
                {"slug": "burpee",              "reps": 10,   "tempo": "X/0/X/0"},
                {"slug": "pistol-squat-gauche", "reps": 10,   "tempo": "3/1/X/0"},
                {"slug": "pistol-squat-droit",  "reps": 10,   "tempo": "3/1/X/0"},
                {"slug": "chaise-isometrique",  "reps": None, "tempo": None},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 1h45 (D+ 600 m)",
            "zone": ZoneCourse.Z2, "duree_min": 105, "dplus_m": 600,
            "description": (
                "Terrain : trail (D+ 600 m).\n"
                "Reprise de la sortie longue depuis le niveau M2 S4.\n"
                "Allure Z2 stricte — marcher les montées raides."
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S2 — Montée en charge | SL 2h D+750m | AMRAP 30min | Seuil 3×11min
    # -----------------------------------------------------------------------
    2: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "EF Z2 — 45 min (D+ 80 m)",
            "zone": ZoneCourse.Z2, "duree_min": 45, "dplus_m": 80,
            "description": "Terrain : chemin avec D+ léger (80 m). +5 min vs S1.",
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM — Module 3 S2 (31 min)",
            "temps_limite": 31,
            "description": (
                "Structure EMOM — 3 blocs :\n"
                "  • Bloc A — 10 min : Dips aux parallettes (pause basse)\n"
                "      4 reps × 10 min\n"
                "  • Bloc B — 9 min : Traction australienne / Curl biceps / Le Y (triplet)\n"
                "      11 reps / 11 reps / repos (cycle × 3)\n"
                "  • Bloc C — 12 min : Pompes larges / Triceps ext / Sit ups (triplet)\n"
                "      11 reps / 11 reps / 30 sec (cycle × 4)"
            ),
            "exercices": [
                {"slug": "dip-parallettes",       "reps": 4,  "tempo": "2/1/X/0"},
                {"slug": "traction-australienne",  "reps": 11, "tempo": "X/1/2/0"},
                {"slug": "curl-biceps-traction",   "reps": 11, "tempo": "X/1/2/0"},
                {"slug": "le-y",                   "reps": 11, "tempo": "2/1/X/0"},
                {"slug": "pompe-large",            "reps": 11, "tempo": "2/1/X/0"},
                {"slug": "triceps-extension-dips", "reps": 11, "tempo": "2/1/X/0"},
                {"slug": "sit-up",                 "reps": 11, "tempo": "X/0/2/0"},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Seuil Z4 — 50 min (3×11 min R=2 min)",
            "zone": ZoneCourse.Z4, "duree_min": 50, "dplus_m": 0,
            "description": (
                "Terrain : route plate.\n"
                "• 3 × 11 min Z4 / 2 min récup — +1 min/bloc vs S1\n"
                "Total : ~50 min avec échauffement et retour au calme."
            ),
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 30 min — Module 3 S2",
            "temps_limite": 30,
            "description": (
                "Circuit AMRAP 30 min — +2 min + pompes larges :\n"
                "  1. 5 Tractions pronation\n"
                "  2. 5 Dips aux parallettes\n"
                "  3. 10 Squats poids du corps\n"
                "  4. 10 Pompes prise large\n"
                "  5. 10 Mountain climbers\n"
                "  6. 10 Burpees\n"
                "  7. 10 Pistol squat gauche\n"
                "  8. 10 Pistol squat droit\n"
                "  9. Chaise isométrique 30 sec"
            ),
            "exercices": [
                {"slug": "traction-stricte",    "reps": 5,    "tempo": "X/1/2/0"},
                {"slug": "dip-parallettes",     "reps": 5,    "tempo": "2/1/X/0"},
                {"slug": "squat-bw",            "reps": 10,   "tempo": "3/1/X/0"},
                {"slug": "pompe-large",         "reps": 10,   "tempo": "2/1/X/0"},
                {"slug": "mountain-climber",    "reps": 10,   "tempo": "X/0/X/0"},
                {"slug": "burpee",              "reps": 10,   "tempo": "X/0/X/0"},
                {"slug": "pistol-squat-gauche", "reps": 10,   "tempo": "3/1/X/0"},
                {"slug": "pistol-squat-droit",  "reps": 10,   "tempo": "3/1/X/0"},
                {"slug": "chaise-isometrique",  "reps": None, "tempo": None},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 2h (D+ 750 m)",
            "zone": ZoneCourse.Z2, "duree_min": 120, "dplus_m": 750,
            "description": "Terrain : trail (D+ 750 m). +15 min vs S1. Ravitaillement eau à 1h.",
        },
    ],

    # -----------------------------------------------------------------------
    # S3 — Intensification | SL 2h15 D+900m | AMRAP 32min | Fraco 6×3min Z5
    # -----------------------------------------------------------------------
    3: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "EF Z2 — 45 min (D+ 100 m)",
            "zone": ZoneCourse.Z2, "duree_min": 45, "dplus_m": 100,
            "description": "Terrain : trail court (D+ 100 m). Allure Z2 — récupération active avant fractionné.",
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM — Module 3 S3 (34 min)",
            "temps_limite": 34,
            "description": (
                "Structure EMOM — 3 blocs (pause isométrique généralisée) :\n"
                "  • Bloc A — 10 min : Dips aux parallettes (pause 2 sec basse)\n"
                "      5 reps × 10 min (tempo 2/2/X/0)\n"
                "  • Bloc B — 12 min : Traction australienne / Curl biceps / Le Y (triplet × 4)\n"
                "      12 reps / 12 reps / repos\n"
                "  • Bloc C — 12 min : Pompes larges / Triceps ext / Extension hanche (triplet × 4)\n"
                "      12 reps / 12 reps / 12 reps"
            ),
            "exercices": [
                {"slug": "dip-parallettes",       "reps": 5,  "tempo": "2/2/X/0", "pause_iso": 2.0},
                {"slug": "traction-australienne",  "reps": 12, "tempo": "X/1/2/0"},
                {"slug": "curl-biceps-traction",   "reps": 12, "tempo": "X/1/2/0"},
                {"slug": "le-y",                   "reps": 12, "tempo": "2/1/X/0"},
                {"slug": "pompe-large",            "reps": 12, "tempo": "2/1/X/0"},
                {"slug": "triceps-extension-dips", "reps": 12, "tempo": "2/1/X/0"},
                {"slug": "extension-hanche",       "reps": 12, "tempo": "2/1/X/0"},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Fractionné Z5 — 45 min (6×3 min R=3 min)",
            "zone": ZoneCourse.Z5, "duree_min": 45, "dplus_m": 0,
            "description": (
                "Terrain : piste ou route plate mesurée.\n"
                "• Échauffement : 10 min Z1/Z2\n"
                "• 6 × 3 min Z5 (100-105% VMA) / 3 min récup Z1 trot\n"
                "• Retour : 5 min Z1\n"
                "Première séance fractionnée courte du Module 3."
            ),
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 32 min — Module 3 S3",
            "temps_limite": 32,
            "description": (
                "Circuit AMRAP 32 min — égal au pic M2 :\n"
                "  1. 6 Tractions pronation\n"
                "  2. 8 Dips aux parallettes\n"
                "  3. 10 Squats poids du corps\n"
                "  4. 10 Pompes prise large\n"
                "  5. 10 Mountain climbers\n"
                "  6. 10 Burpees\n"
                "  7. 10 Pistol squat gauche\n"
                "  8. 10 Pistol squat droit\n"
                "  9. 10 Extensions de hanche\n"
                "  10. Chaise isométrique 30 sec"
            ),
            "exercices": [
                {"slug": "traction-stricte",    "reps": 6,    "tempo": "X/1/2/0"},
                {"slug": "dip-parallettes",     "reps": 8,    "tempo": "2/1/X/0"},
                {"slug": "squat-bw",            "reps": 10,   "tempo": "3/1/X/0"},
                {"slug": "pompe-large",         "reps": 10,   "tempo": "2/1/X/0"},
                {"slug": "mountain-climber",    "reps": 10,   "tempo": "X/0/X/0"},
                {"slug": "burpee",              "reps": 10,   "tempo": "X/0/X/0"},
                {"slug": "pistol-squat-gauche", "reps": 10,   "tempo": "3/1/X/0"},
                {"slug": "pistol-squat-droit",  "reps": 10,   "tempo": "3/1/X/0"},
                {"slug": "extension-hanche",    "reps": 10,   "tempo": "2/1/X/0"},
                {"slug": "chaise-isometrique",  "reps": None, "tempo": None},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 2h15 (D+ 900 m)",
            "zone": ZoneCourse.Z2, "duree_min": 135, "dplus_m": 900,
            "description": "Terrain : trail (D+ 900 m). +15 min vs S2. Ravitaillement eau + glucides à 1h07.",
        },
    ],

    # -----------------------------------------------------------------------
    # S4 — Pic | SL 2h30 D+1100m | AMRAP 35min | Seuil 4×10min
    # -----------------------------------------------------------------------
    4: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "EF Z2 — 50 min (D+ 150 m)",
            "zone": ZoneCourse.Z2, "duree_min": 50, "dplus_m": 150,
            "description": "Terrain : trail court (D+ 150 m). +5 min vs S3. Récupération active avant seuil.",
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM — Module 3 S4 — PIC (37 min)",
            "temps_limite": 37,
            "description": (
                "Structure EMOM PIC — 3 blocs :\n"
                "  • Bloc A — 12 min : Dips aux parallettes (pause 2 sec)\n"
                "      6 reps × 12 min\n"
                "  • Bloc B — 12 min : Traction australienne / Curl / Le Y (triplet × 4)\n"
                "      13 reps / 13 reps / repos\n"
                "  • Bloc C — 13 min : Pompes larges / Triceps ext / Extension hanche (triplet × 4 + 1)\n"
                "      13 reps / 13 reps / 13 reps"
            ),
            "exercices": [
                {"slug": "dip-parallettes",       "reps": 6,  "tempo": "2/2/X/0", "pause_iso": 2.0},
                {"slug": "traction-australienne",  "reps": 13, "tempo": "X/1/2/0"},
                {"slug": "curl-biceps-traction",   "reps": 13, "tempo": "X/1/2/0"},
                {"slug": "le-y",                   "reps": 13, "tempo": "2/1/X/0"},
                {"slug": "pompe-large",            "reps": 13, "tempo": "2/1/X/0"},
                {"slug": "triceps-extension-dips", "reps": 13, "tempo": "2/1/X/0"},
                {"slug": "extension-hanche",       "reps": 13, "tempo": "2/1/X/0"},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Seuil Z4 — 55 min (4×10 min R=2 min)",
            "zone": ZoneCourse.Z4, "duree_min": 55, "dplus_m": 0,
            "description": (
                "Terrain : route plate.\n"
                "• 4 × 10 min Z4 / 2 min récup — 4 blocs pour la première fois\n"
                "Total : ~55 min avec échauffement 8 min et retour 5 min."
            ),
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 35 min — Module 3 S4 — PIC",
            "temps_limite": 35,
            "description": (
                "Circuit AMRAP 35 min — pic absolu du programme :\n"
                "  1. 6 Tractions pronation\n"
                "  2. 8 Dips aux parallettes\n"
                "  3. 12 Squats poids du corps\n"
                "  4. 12 Pompes prise large\n"
                "  5. 10 Mountain climbers\n"
                "  6. 10 Burpees\n"
                "  7. 10 Pistol squat gauche\n"
                "  8. 10 Pistol squat droit\n"
                "  9. 10 Extensions de hanche\n"
                "  10. 10 Sit ups\n"
                "  11. Chaise isométrique 30 sec"
            ),
            "exercices": [
                {"slug": "traction-stricte",    "reps": 6,    "tempo": "X/1/2/0"},
                {"slug": "dip-parallettes",     "reps": 8,    "tempo": "2/1/X/0"},
                {"slug": "squat-bw",            "reps": 12,   "tempo": "3/1/X/0"},
                {"slug": "pompe-large",         "reps": 12,   "tempo": "2/1/X/0"},
                {"slug": "mountain-climber",    "reps": 10,   "tempo": "X/0/X/0"},
                {"slug": "burpee",              "reps": 10,   "tempo": "X/0/X/0"},
                {"slug": "pistol-squat-gauche", "reps": 10,   "tempo": "3/1/X/0"},
                {"slug": "pistol-squat-droit",  "reps": 10,   "tempo": "3/1/X/0"},
                {"slug": "extension-hanche",    "reps": 10,   "tempo": "2/1/X/0"},
                {"slug": "sit-up",              "reps": 10,   "tempo": "X/0/2/0"},
                {"slug": "chaise-isometrique",  "reps": None, "tempo": None},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 2h30 (D+ 1100 m)",
            "zone": ZoneCourse.Z2, "duree_min": 150, "dplus_m": 1100,
            "description": (
                "Terrain : trail (D+ 1100 m) — sortie longue la plus ambitieuse du programme.\n"
                "Ravitaillement obligatoire : eau + glucides toutes les 45 min.\n"
                "Marcher systématiquement les montées raides pour rester Z2."
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S5 — Décharge amorçée | SL 2h D+700m | AMRAP 28min | Seuil 3×10min
    # -----------------------------------------------------------------------
    5: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "EF Z2 — 40 min",
            "zone": ZoneCourse.Z2, "duree_min": 40, "dplus_m": 0,
            "description": "Terrain : route. -10 min vs S4. Début de décharge — allure légère.",
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM — Module 3 S5 (26 min)",
            "temps_limite": 26,
            "description": (
                "Structure EMOM décharge amorçée — 2 blocs :\n"
                "  • Bloc A — 9 min : Dips aux parallettes (libre)\n"
                "      5 reps × 9 min (focus technique)\n"
                "  • Bloc B — 9 min : Traction australienne / Curl / Le Y (triplet × 3)\n"
                "      12 reps / 12 reps / repos\n"
                "  • Bloc C — 8 min : Pompes larges / Extension hanche (alternés)\n"
                "      12 reps / 12 reps × 4"
            ),
            "exercices": [
                {"slug": "dip-parallettes",      "reps": 5,  "tempo": "2/1/X/0"},
                {"slug": "traction-australienne", "reps": 12, "tempo": "X/1/2/0"},
                {"slug": "curl-biceps-traction",  "reps": 12, "tempo": "X/1/2/0"},
                {"slug": "le-y",                  "reps": 12, "tempo": "2/1/X/0"},
                {"slug": "pompe-large",           "reps": 12, "tempo": "2/1/X/0"},
                {"slug": "extension-hanche",      "reps": 12, "tempo": "2/1/X/0"},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Seuil Z4 — 45 min (3×10 min R=2 min)",
            "zone": ZoneCourse.Z4, "duree_min": 45, "dplus_m": 0,
            "description": "Terrain : route plate. Retour au volume S1 — seuil de maintenance.",
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 28 min — Module 3 S5 (décharge)",
            "temps_limite": 28,
            "description": (
                "Circuit AMRAP 28 min — retour au volume S2 :\n"
                "  1. 5 Tractions pronation\n"
                "  2. 5 Dips aux parallettes\n"
                "  3. 10 Squats poids du corps\n"
                "  4. 10 Pompes prise large\n"
                "  5. 10 Mountain climbers\n"
                "  6. 10 Burpees\n"
                "  7. 10 Pistol squat gauche\n"
                "  8. 10 Pistol squat droit"
            ),
            "exercices": [
                {"slug": "traction-stricte",    "reps": 5,  "tempo": "X/1/2/0"},
                {"slug": "dip-parallettes",     "reps": 5,  "tempo": "2/1/X/0"},
                {"slug": "squat-bw",            "reps": 10, "tempo": "3/1/X/0"},
                {"slug": "pompe-large",         "reps": 10, "tempo": "2/1/X/0"},
                {"slug": "mountain-climber",    "reps": 10, "tempo": "X/0/X/0"},
                {"slug": "burpee",              "reps": 10, "tempo": "X/0/X/0"},
                {"slug": "pistol-squat-gauche", "reps": 10, "tempo": "3/1/X/0"},
                {"slug": "pistol-squat-droit",  "reps": 10, "tempo": "3/1/X/0"},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 2h (D+ 700 m)",
            "zone": ZoneCourse.Z2, "duree_min": 120, "dplus_m": 700,
            "description": "Terrain : trail (D+ 700 m). -30 min vs S4. Allure Z2 relâchée.",
        },
    ],

    # -----------------------------------------------------------------------
    # S6 — Décharge complète | SL 1h30 D+400m | AMRAP 20min
    # -----------------------------------------------------------------------
    6: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Récupération active Z1 — 30 min",
            "zone": ZoneCourse.Z1, "duree_min": 30, "dplus_m": 0,
            "description": "Terrain : route souple. Très légère — aucun effort ressenti. Régénération.",
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM (décharge) — Module 3 S6 (18 min)",
            "temps_limite": 18,
            "description": (
                "Structure EMOM décharge légère — 2 blocs :\n"
                "  • Bloc A — 9 min : Dips + Pompes alternés\n"
                "      10 reps × 9 min\n"
                "  • Bloc B — 9 min : Curl / Le Y / Repos (triplet × 3)\n"
                "      10 reps / 10 reps / repos"
            ),
            "exercices": [
                {"slug": "dip-parallettes",     "reps": 10, "tempo": "2/1/X/0"},
                {"slug": "pompe-standard",      "reps": 10, "tempo": "2/0/X/0"},
                {"slug": "curl-biceps-traction","reps": 10, "tempo": "X/1/2/0"},
                {"slug": "le-y",                "reps": 10, "tempo": "2/1/X/0"},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "EF Z1 très léger — 25 min",
            "zone": ZoneCourse.Z1, "duree_min": 25, "dplus_m": 0,
            "description": "Route plate. Très léger, respiration nasale uniquement. Préservation avant tests.",
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 20 min (décharge) — Module 3 S6",
            "temps_limite": 20,
            "description": (
                "Circuit décharge AMRAP 20 min :\n"
                "  1. 5 Tractions australiennes\n"
                "  2. 10 Squats poids du corps\n"
                "  3. 10 Pompes standard\n"
                "  4. 10 Burpees\n"
                "Focus technique — aucune intensité, schémas moteurs seulement."
            ),
            "exercices": [
                {"slug": "traction-australienne","reps": 5,  "tempo": "X/1/2/0"},
                {"slug": "squat-bw",            "reps": 10, "tempo": "3/1/X/0"},
                {"slug": "pompe-standard",      "reps": 10, "tempo": "2/0/X/0"},
                {"slug": "burpee",              "reps": 10, "tempo": "X/0/X/0"},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 1h30 (D+ 400 m)",
            "zone": ZoneCourse.Z2, "duree_min": 90, "dplus_m": 400,
            "description": "Terrain : trail court (D+ 400 m). -30 min vs S5. Allure très relâchée.",
        },
    ],

    # -----------------------------------------------------------------------
    # S7 — Affûtage | Activation neuromusculaire + prépa tests
    # -----------------------------------------------------------------------
    7: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Activation Z1/Z2 — 25 min",
            "zone": ZoneCourse.Z2, "duree_min": 25, "dplus_m": 0,
            "description": "Route plate. 20 min Z1 + 5 min accélérations progressives. Légèreté avant tout.",
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "Activation neuromusculaire — S7 (15 min)",
            "temps_limite": 15,
            "description": (
                "Activation neuromusculaire — schémas moteurs uniquement :\n"
                "  • 5 Tractions australiennes lentes (tempo 3/1/3/0)\n"
                "  • 5 Dips lents (tempo 3/1/3/0)\n"
                "  • 10 Pompes standard lentes\n"
                "  • 10 Squats profonds\n"
                "  • 5 Burpees contrôlés\n"
                "Aucune intensité — cerveau et muscles en éveil seulement."
            ),
            "exercices": [
                {"slug": "traction-australienne","reps": 5,  "tempo": "3/1/3/0"},
                {"slug": "dip-parallettes",      "reps": 5,  "tempo": "3/1/3/0"},
                {"slug": "pompe-standard",       "reps": 10, "tempo": "3/1/3/0"},
                {"slug": "squat-bw",             "reps": 10, "tempo": "3/1/X/0"},
                {"slug": "burpee",               "reps": 5,  "tempo": "X/0/X/0"},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Prépa Demi-Cooper — 30 min Z2",
            "zone": ZoneCourse.Z2, "duree_min": 30, "dplus_m": 0,
            "description": (
                "Piste ou route plate mesurée.\n"
                "30 min Z2 + 3 accélérations 30 sec à allure Cooper.\n"
                "Objectif J180 : dépasser 1700 m (VMA ≥ 17 km/h)."
            ),
        },
        {
            "jour": 4, "type": TypeSeance.DECHARGE, "titre": "Mobilité & Visualisation — 45 min",
            "description": (
                "  • 15 min foam rolling : mollets, ischio, fessiers, dorsaux\n"
                "  • 20 min étirements statiques profonds (30 sec × 2)\n"
                "  • 10 min visualisation des 3 tests J180"
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S8 — ÉVALUATION J180 (Objectifs : SL 2h30 en course / 12 tractions / 4 tours AMRAP)
    # -----------------------------------------------------------------------
    8: [
        {
            "jour": 1, "type": TypeSeance.EVALUATION, "titre": "Test VMA — Demi-Cooper J180",
            "duree_min": 30,
            "description": (
                "Piste ou route plate mesurée.\n"
                "• Échauffement : 10 min + 2×30 sec à allure cible\n"
                "• Test : 6 min à allure maximale\n"
                "• VMA = distance (m) ÷ 100\n"
                "Objectif J180 : dépasser 1700 m"
            ),
        },
        {
            "jour": 3, "type": TypeSeance.EVALUATION, "titre": "Max Reps 1 min — 7 mouvements (J180)",
            "duree_min": 60,
            "description": (
                "7 mouvements, 4 min de repos entre chaque :\n"
                "  1. Tractions pronation strictes\n"
                "  2. Dips aux parallettes\n"
                "  3. Pompes prise large\n"
                "  4. Sit ups\n"
                "  5. Squats poids du corps\n"
                "  6. Pistol squat gauche\n"
                "  7. Pistol squat droit\n"
                "Objectifs J180 : 12 trac / 25 dips / 50 pompes / 40 sit ups / 50 squats / 20 pistol G+D"
            ),
        },
        {
            "jour": 5, "type": TypeSeance.EVALUATION, "titre": "AMRAP Benchmark — 10 min (J180)",
            "temps_limite": 10, "duree_min": 25,
            "description": (
                "Circuit fixe EPC :\n"
                "  10 Tractions → 10 Pompes → 10 Squats → 10 Dips → 10 Burpees → 10 Mountain Climbers\n"
                "Objectif J180 : 4 tours complets."
            ),
        },
    ],
}


# ============================================================================
# Fonctions de seed
# ============================================================================

def _inserer_semaines(macrocycle_id: int, module_data: dict):
    creer_tables()
    db = SessionLocal()
    try:
        mc = db.query(Macrocycle).filter(Macrocycle.id == macrocycle_id).first()
        if not mc:
            print(f"Macrocycle {macrocycle_id} introuvable.")
            return

        semaines = {s.numero_semaine: s for s in mc.semaines}
        exercices_map = {e.slug: e for e in db.query(VariationExercice).all()}
        total_seances = 0
        total_exercices = 0
        slugs_manquants = set()

        for num_sem, seances in module_data.items():
            semaine = semaines.get(num_sem)
            if not semaine:
                print(f"  Semaine {num_sem} introuvable (MC {macrocycle_id}).")
                continue

            for s_ex in semaine.seances:
                for ex in s_ex.exercices:
                    db.delete(ex)
                db.delete(s_ex)
            db.flush()

            for ordre, s in enumerate(seances, 1):
                seance = SeanceEntrainement(
                    semaine_id=semaine.id,
                    date_seance=semaine.date_debut + timedelta(days=s["jour"] - 1),
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
                    db.add(ExerciceSeance(
                        seance_id=seance.id,
                        exercice_id=exercice.id,
                        ordre=pos,
                        repetitions=ex_data.get("reps"),
                        tempo_override=ex_data.get("tempo"),
                        pause_isometrique_override_sec=ex_data.get("pause_iso"),
                    ))
                    total_exercices += 1

        db.commit()
        noms = {1: "Module 1 - Adaptation", 2: "Module 2 - Révélation", 3: "Module 3 - Confirmation"}
        nom = noms.get(macrocycle_id, f"Macrocycle {macrocycle_id}")
        print(f"MC{macrocycle_id} ({nom}) : {total_seances} séances, {total_exercices} exercices.")
        if slugs_manquants:
            print(f"  Slugs manquants (lance /api/admin/reseed) : {slugs_manquants}")
    except Exception as e:
        db.rollback()
        print(f"Erreur MC{macrocycle_id} : {e}")
        raise
    finally:
        db.close()


def seed_module1():
    """Seed le macrocycle 1 (Module 1 — ADAPTATION)."""
    _inserer_semaines(1, MODULE1)


def seed_module2():
    """Seed le macrocycle 2 (Module 2 — RÉVÉLATION)."""
    _inserer_semaines(2, MODULE2)


def seed_module3():
    """Seed le macrocycle 3 (Module 3 — CONFIRMATION)."""
    _inserer_semaines(3, MODULE3)


if __name__ == "__main__":
    seed_module1()
    seed_module2()
    seed_module3()
