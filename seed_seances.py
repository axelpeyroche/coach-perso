"""
Seed des séances EPC — 3 macrocycles × 8 semaines.

Structure hebdomadaire S1-S5 (invariante) :
  j1 (Lundi)    : EF Z2 (Endurance Fondamentale)
  j2 (Mardi)    : EMOM (musculation)
  j3 (Mercredi) : Seuil Z4 (semaines impaires S1/S3/S5)
                  Fractionné Z5 (semaines paires S2/S4)
  j4 (Jeudi)    : AMRAP
  j5 (Vendredi) : repos
  j6 (Samedi)   : Sortie Longue trail
  j7 (Dimanche) : repos

S6 : décharge | S7 : affûtage | S8 : évaluation (structure allégée)
"""

from datetime import timedelta
from database import SessionLocal, creer_tables
from models import (
    Macrocycle, SeanceEntrainement, ExerciceSeance,
    VariationExercice, TypeSeance, ZoneCourse
)


# ============================================================================
# MODULE 1 — ADAPTATION : 8 semaines
# S1/S3/S5 = Seuil · S2/S4 = Fractionné
# ============================================================================

MODULE1 = {

    # -----------------------------------------------------------------------
    # S1 — Entrée progressive | Seuil 3×8min | AMRAP 20min | SL 45min
    # -----------------------------------------------------------------------
    1: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "EF Z2 — 35 min (D+ 50 m)",
            "zone": ZoneCourse.Z2, "duree_min": 35, "dplus_m": 50,
            "description": (
                "Terrain : chemin souple (D+ 50 m).\n"
                "Allure Z1-Z2 conversationnelle — respiration nasale prioritaire.\n"
                "1ère semaine : accumuler du temps sur les jambes, pas de chrono."
            ),
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PULL — S1 (32 min)",
            "temps_limite": 32,
            "description": (
                "Structure EMOM PULL — 4 blocs :\n"
                "  • Bloc A — 9 min : Traction stricte (tempo X/1/2/0)\n"
                "      2 reps (min 1-3) → 3 reps (min 4-6) → 4 reps (min 7-9)\n"
                "  • Bloc B — 9 min : Traction australienne (libres)\n"
                "      10 reps × 9 min\n"
                "  • Bloc C — 9 min : Curl biceps traction\n"
                "      8 reps × 9 min\n"
                "  • Bloc D — 5 min : Extension de hanche (pont fessier)\n"
                "      12 reps × 5 min — chaîne postérieure"
            ),
            "exercices": [
                {"slug": "traction-stricte",     "reps": 3,  "tempo": "X/1/2/0", "duree_min": 9},
                {"slug": "traction-australienne","reps": 10, "tempo": "X/1/2/0", "duree_min": 9},
                {"slug": "curl-biceps-traction", "reps": 8,  "tempo": "X/1/2/0", "duree_min": 9},
                {"slug": "extension-hanche",     "reps": 12, "tempo": "2/1/X/0", "duree_min": 5},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Seuil Z4 — 40 min (3×8 min R=2 min)",
            "zone": ZoneCourse.Z4, "duree_min": 40, "dplus_m": 0,
            "description": (
                "Terrain : route plate ou piste.\n"
                "• Échauffement : 8 min Z1/Z2\n"
                "• 3 × 8 min Z4 (87-95% VMA) / 2 min récup trot Z1\n"
                "• Retour : 4 min Z1\n"
                "1ère séance seuil du programme — rester sur la zone, ne pas partir trop vite."
            ),
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 20 min FULL BODY — S1",
            "temps_limite": 20,
            "description": (
                "Circuit AMRAP 20 min :\n"
                "  1. 5 Tractions pronation\n"
                "  2. 8 Dips aux parallettes\n"
                "  3. 12 Pompes standard (tempo 2/1/X/0)\n"
                "  4. 15 Sit ups\n"
                "  5. 20 Squats poids du corps\n"
                "  6. 6 Pistol squat gauche (*)\n"
                "  7. 6 Pistol squat droit (*)\n"
                "(*) Régression : s'aider d'un anneau ou poser le talon sur un step."
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
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 45 min (D+ 120 m)",
            "zone": ZoneCourse.Z2, "duree_min": 45, "dplus_m": 120,
            "description": (
                "Terrain : trail (D+ 120 m).\n"
                "Allure Z1-Z2. Marcher les montées si la FC dépasse Z2.\n"
                "1ère sortie longue — accumuler du temps sur les jambes, pas de chrono."
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S2 — Volume +10% | Fractionné 6×2 min Z5 | AMRAP 22min | SL 55min
    # -----------------------------------------------------------------------
    2: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "EF Z2 — 42 min (D+ 90 m)",
            "zone": ZoneCourse.Z2, "duree_min": 42, "dplus_m": 90,
            "description": (
                "Terrain : chemin vallonné (D+ 90 m). +7 min vs S1.\n"
                "Allure Z1-Z2 conversationnelle — récupération avant fractionné."
            ),
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH — S2 (32 min)",
            "temps_limite": 32,
            "description": (
                "Structure EMOM PUSH — 4 blocs (tempo 3/1*/X/0, *alterner prise) :\n"
                "  • Bloc A — 9 min : Pompes\n"
                "      3 reps → 3 reps → 4 reps\n"
                "  • Bloc B — 9 min : Pompes (même tempo)\n"
                "      4 reps → 5 reps → 6 reps\n"
                "  • Bloc C — 5 min : Planche dynamique (tapotements alternés)\n"
                "      12 reps × 5 min\n"
                "  • Bloc D — 9 min : Sit ups / Hollow actif (alternés)\n"
                "      Sit ups libres / Hollow actif 20 sec"
            ),
            "exercices": [
                {"slug": "pompe-standard",    "reps": 4,    "tempo": "3/1/X/0", "duree_min": 18},
                {"slug": "planche-dynamique", "reps": 12,   "tempo": "X/0/X/0", "duree_min": 5},
                {"slug": "sit-up",            "reps": 15,   "tempo": "X/0/2/0", "duree_min": 9},
                {"slug": "hollow-actif",      "reps": None, "tempo": None,       "duree_min": 9},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Fractionné Z5 — 40 min (6×2 min R=2 min)",
            "zone": ZoneCourse.Z5, "duree_min": 40, "dplus_m": 0,
            "description": (
                "Terrain : piste ou route plate mesurée.\n"
                "• Échauffement : 10 min Z1/Z2\n"
                "• 6 × 2 min Z5 (100-105% VMA) / 2 min récup Z1 trot\n"
                "• Retour : 6 min Z1\n"
                "1ère séance fractionnée — court mais intense. Finir chaque répétition à fond."
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
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 55 min (D+ 150 m)",
            "zone": ZoneCourse.Z2, "duree_min": 55, "dplus_m": 150,
            "description": (
                "Terrain : trail (D+ 150 m). +10 min vs S1.\n"
                "La fin de sortie peut glisser en Z3 — toléré.\n"
                "Allure cible : Z2 dominant, Z3 sur les relances de fin."
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S3 — Intensification | Seuil 3×10min Z4 | AMRAP 24min | SL 60min
    # -----------------------------------------------------------------------
    3: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "EF Z2 — 48 min (D+ 130 m)",
            "zone": ZoneCourse.Z2, "duree_min": 48, "dplus_m": 130,
            "description": (
                "Terrain : trail court (D+ 130 m). +6 min vs S2.\n"
                "Allure Z2 — récupération active avant séance seuil."
            ),
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH (pauses iso) — S3 (32 min)",
            "temps_limite": 32,
            "description": (
                "Structure EMOM PUSH avec pauses isométriques — 4 blocs :\n"
                "  • Bloc A — 5 min : Dips avec pause isométrique (1 sec position basse)\n"
                "      11 reps × 5 min\n"
                "  • Bloc B — 9 min : Pompes prise large + pause basse 1 sec\n"
                "      8 reps × 9 min\n"
                "  • Bloc C — 9 min : Pompes standard libres — maintenir la qualité\n"
                "      10 reps × 9 min\n"
                "  • Bloc D — 9 min : Extension triceps (dips) / Chaise isométrique (alternés)\n"
                "      9 reps / 25 sec position tenue"
            ),
            "exercices": [
                {"slug": "dip-parallettes",       "reps": 11, "tempo": "2/1/X/0", "pause_iso": 1.0, "duree_min": 5},
                {"slug": "pompe-large",           "reps": 8,  "tempo": "2/1/X/0", "pause_iso": 1.0, "duree_min": 9},
                {"slug": "pompe-standard",        "reps": 10, "tempo": "2/0/X/0",                   "duree_min": 9},
                {"slug": "triceps-extension-dips","reps": 9,  "tempo": "2/1/X/0",                   "duree_min": 9},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Seuil Z4 — 45 min (3×10 min R=2 min)",
            "zone": ZoneCourse.Z4, "duree_min": 45, "dplus_m": 0,
            "description": (
                "Terrain : route plate ou piste.\n"
                "• Échauffement : 8 min Z1/Z2\n"
                "• 3 × 10 min Z4 (87-95% VMA) / 2 min récup Z1 trot\n"
                "• Retour : 5 min Z1\n"
                "+2 min par bloc vs S1. Concentration sur la régularité de l'allure."
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
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 60 min (D+ 200 m)",
            "zone": ZoneCourse.Z2, "duree_min": 60, "dplus_m": 200,
            "description": (
                "Terrain : trail (D+ 200 m). +5 min vs S2.\n"
                "Allure Z2 sur tout le parcours. 1h de course — premier palier significatif."
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S4 — Pic adaptation | Fractionné 8×2min Z5 | AMRAP 30min | SL 65min
    # -----------------------------------------------------------------------
    4: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "EF Z2 — 55 min (D+ 170 m)",
            "zone": ZoneCourse.Z2, "duree_min": 55, "dplus_m": 170,
            "description": (
                "Terrain : trail court (D+ 170 m). Semaine pic M1.\n"
                "Allure Z2 — récupération active avant fractionné de pointe."
            ),
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PULL (barres) — S4 (27 min)",
            "temps_limite": 27,
            "description": (
                "Structure EMOM PULL variante barres — 3 blocs :\n"
                "  • Bloc A — 9 min : Traction australienne (libre)\n"
                "      5 reps × 9 min — tirage horizontal\n"
                "  • Bloc B — 9 min : Traction stricte + hold position haute\n"
                "      4 reps / 30 sec hold (alternés)\n"
                "  • Bloc C — 9 min : Curl biceps traction / Extension de hanche (alternés)\n"
                "      8 reps curl / 12 reps pont fessier (cycle × 4)"
            ),
            "exercices": [
                {"slug": "traction-australienne", "reps": 5,  "tempo": "X/1/2/0",                   "duree_min": 9},
                {"slug": "traction-stricte",      "reps": 4,  "tempo": "X/1/2/0", "pause_iso": 1.0, "duree_min": 9},
                {"slug": "curl-biceps-traction",  "reps": 8,  "tempo": "X/1/2/0",                   "duree_min": 9},
                {"slug": "extension-hanche",      "reps": 12, "tempo": "2/1/X/0",                   "duree_min": 9},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Fractionné Z5 — 45 min (8×2 min R=1:30 min)",
            "zone": ZoneCourse.Z5, "duree_min": 45, "dplus_m": 0,
            "description": (
                "Terrain : piste ou route plate mesurée.\n"
                "• Échauffement : 10 min Z1/Z2\n"
                "• 8 × 2 min Z5 (100-105% VMA) / 1 min 30 récup Z1 trot\n"
                "• Retour : 5 min Z1\n"
                "+2 répétitions vs S2. Récupération plus courte — entraîne la tolérance à la dette O₂."
            ),
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 30 min FULL BODY — S4",
            "temps_limite": 30,
            "description": (
                "Circuit AMRAP 30 min — plus complet de la phase Adaptation :\n"
                "  1. 10 Tractions australiennes\n"
                "  2. 10 Dips aux parallettes\n"
                "  3. 10 Pompes prise large\n"
                "  4. 30 sec Hollow body actif\n"
                "  5. 10 Squats poids du corps\n"
                "  6. 5 Tractions strictes\n"
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
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 65 min (D+ 250 m)",
            "zone": ZoneCourse.Z2, "duree_min": 65, "dplus_m": 250,
            "description": (
                "Terrain : trail (D+ 250 m). +5 min vs S3.\n"
                "Pic de la sortie longue en phase Adaptation. Gérer l'allure Z2 sur tout le dénivelé."
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S5 — Consolidation | Seuil 3×11min | AMRAP 22min | SL 55min
    # -----------------------------------------------------------------------
    5: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "EF Z2 — 35 min (D+ 50 m)",
            "zone": ZoneCourse.Z2, "duree_min": 35, "dplus_m": 50,
            "description": (
                "Terrain : chemin souple. Semaine de décharge.\n"
                "Récupération active — allure Z2 relâchée, respiration nasale."
            ),
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PULL — S5 (23 min)",
            "temps_limite": 23,
            "description": (
                "Structure EMOM PULL — 3 blocs :\n"
                "  • Bloc A — 9 min : Traction australienne (libre)\n"
                "      5 reps × 9 min — tirage horizontal\n"
                "  • Bloc B — 5 min : Traction stricte (tempo X/1/2/0)\n"
                "      4 reps × 5 min\n"
                "  • Bloc C — 9 min : Curl biceps traction / Extension de hanche (alternés)\n"
                "      10 reps curl / 15 reps pont fessier (cycle × 4)"
            ),
            "exercices": [
                {"slug": "traction-australienne","reps": 5,  "tempo": "X/1/2/0", "duree_min": 9},
                {"slug": "traction-stricte",     "reps": 4,  "tempo": "X/1/2/0", "duree_min": 5},
                {"slug": "curl-biceps-traction", "reps": 10, "tempo": "X/1/2/0", "duree_min": 9},
                {"slug": "extension-hanche",     "reps": 15, "tempo": "2/1/X/0", "duree_min": 9},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Seuil Z4 — 50 min (3×11 min R=2 min)",
            "zone": ZoneCourse.Z4, "duree_min": 50, "dplus_m": 0,
            "description": (
                "Terrain : route plate.\n"
                "• Échauffement : 8 min Z1/Z2\n"
                "• 3 × 11 min Z4 (87-95% VMA) / 2 min récup Z1 trot\n"
                "• Retour : 5 min Z1\n"
                "+1 min par bloc vs S3. Fin de montée en charge — tenir la zone."
            ),
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 22 min FULL BODY — S5",
            "temps_limite": 22,
            "description": (
                "Circuit AMRAP 22 min — volume légèrement réduit, amorce décharge :\n"
                "  1. 5 Tractions pronation\n"
                "  2. 8 Dips aux parallettes\n"
                "  3. 10 Pompes standard\n"
                "  4. 15 Sit ups\n"
                "  5. 20 Squats poids du corps\n"
                "  6. 6 Pistol squat gauche\n"
                "  7. 6 Pistol squat droit"
            ),
            "exercices": [
                {"slug": "traction-stricte",    "reps": 5,  "tempo": "X/1/2/0"},
                {"slug": "dip-parallettes",     "reps": 8,  "tempo": "2/1/X/0"},
                {"slug": "pompe-standard",      "reps": 10, "tempo": "2/1/X/0"},
                {"slug": "sit-up",              "reps": 15, "tempo": "X/0/2/0"},
                {"slug": "squat-bw",            "reps": 20, "tempo": "3/1/X/0"},
                {"slug": "pistol-squat-gauche", "reps": 6,  "tempo": "3/1/X/0"},
                {"slug": "pistol-squat-droit",  "reps": 6,  "tempo": "3/1/X/0"},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 55 min (D+ 150 m)",
            "zone": ZoneCourse.Z2, "duree_min": 55, "dplus_m": 150,
            "description": (
                "Terrain : trail (D+ 150 m). Amorce décharge — -10 min vs S4.\n"
                "Allure Z2 confortable, sans pression de performance."
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S6 — Décharge | Volume -40% | EMOM léger + mobilité
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
                {"slug": "dip-parallettes", "reps": 14, "tempo": "2/1/X/0", "duree_min": 5},
                {"slug": "pompe-standard",  "reps": 14, "tempo": "2/0/X/0", "duree_min": 9},
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
    # S7 — Affûtage | Activation + prépa test VMA
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
    # S8 — ÉVALUATION J60
    # -----------------------------------------------------------------------
    8: [
        {
            "jour": 1, "type": TypeSeance.EVALUATION, "titre": "Test VMA — Demi-Cooper (6 min)",
            "duree_min": 30,
            "description": (
                "Terrain : piste d'athlétisme ou parcours plat mesuré.\n"
                "• Échauffement : 10 min progressif + 2×30 sec à allure cible\n"
                "• Test : 6 min à allure maximale soutenable\n"
                "• VMA = distance (m) ÷ 100\n"
                "• Zones Z1-Z5 recalculées automatiquement"
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
                "Score en tours (ex. 3.4). Objectif J60 : 3 tours complets."
            ),
        },
    ],
}


# ============================================================================
# MODULE 2 — RÉVÉLATION : 8 semaines
# S1/S3/S5 = Seuil · S2/S4 = Fractionné
# ============================================================================

MODULE2 = {

    # -----------------------------------------------------------------------
    # S1 — Entrée Module 2 | Seuil 3×10min | AMRAP 25min | SL 1h30
    # -----------------------------------------------------------------------
    1: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "EF Z2 — 55 min (D+ 200 m)",
            "zone": ZoneCourse.Z2, "duree_min": 55, "dplus_m": 200,
            "description": (
                "Terrain : trail (D+ 200 m). Reprise après évaluation M1.\n"
                "Allure Z2 conversationnelle — premier palier du Module 2."
            ),
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH — Module 2 S1 (34 min)",
            "temps_limite": 34,
            "description": (
                "Structure EMOM PUSH Module 2 — 4 blocs :\n"
                "  • Bloc A — 10 min : Dips (tempo 2/1/X/0) — 3 reps × 10 min\n"
                "  • Bloc B — 9 min : Pompes prise large — 8 reps × 9 min\n"
                "  • Bloc C — 6 min : Dips partiel (amplitude réduite) — 5 reps × 6 min\n"
                "  • Bloc D — 9 min : Triceps ext / Squat poids du corps (alternés)\n"
                "      10 reps triceps (min 1,4,7) / 15 reps squat (min 2,5,8)"
            ),
            "exercices": [
                {"slug": "dip-parallettes",       "reps": 3,  "tempo": "2/1/X/0", "duree_min": 10},
                {"slug": "pompe-large",           "reps": 8,  "tempo": "2/1/X/0", "duree_min": 9},
                {"slug": "dip-partiel",           "reps": 5,  "tempo": "2/1/X/0", "duree_min": 6},
                {"slug": "triceps-extension-dips","reps": 10, "tempo": "2/1/X/0", "duree_min": 9},
                {"slug": "squat-bw",             "reps": 15, "tempo": "3/1/X/0", "duree_min": 9},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Seuil Z3/Z4 — 45 min (3×10 min R=2 min)",
            "zone": ZoneCourse.Z3, "duree_min": 45, "dplus_m": 0,
            "description": (
                "Terrain : route plate.\n"
                "• Échauffement : 8 min Z2\n"
                "• 3 × 10 min Z3/Z4 (80-95% VMA) / 2 min récup Z1\n"
                "• Retour : 5 min Z1\n"
                "1ère séance seuil Module 2 — progression depuis le niveau M1."
            ),
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 25 min FULL BODY — Module 2 S1",
            "temps_limite": 25,
            "description": (
                "Circuit AMRAP 25 min Module 2 — nouveaux mouvements :\n"
                "  1. 5 Tractions pronation\n"
                "  2. 5 Dips aux parallettes\n"
                "  3. 10 Squats poids du corps\n"
                "  4. 10 Mountain climbers (par jambe)\n"
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
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 1h30 (D+ 400 m)",
            "zone": ZoneCourse.Z2, "duree_min": 90, "dplus_m": 400,
            "description": (
                "Terrain : trail (D+ 400 m).\n"
                "Durée : 1h30 en Z2 — entrée dans les sorties longues Module 2.\n"
                "Marcher les montées pour rester en Z2. Ravitaillement eau à 45 min."
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S2 — Volume + | Fractionné 6×2:30min Z5 | AMRAP 28min | SL 1h50
    # -----------------------------------------------------------------------
    2: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "EF Z2 — 60 min (D+ 250 m)",
            "zone": ZoneCourse.Z2, "duree_min": 60, "dplus_m": 250,
            "description": "Terrain : trail (D+ 250 m). +5 min vs S1. Allure Z2 — récupération active avant fractionné.",
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PULL — Module 2 S2 (38 min)",
            "temps_limite": 38,
            "description": (
                "Structure EMOM PULL Module 2 — 4 blocs :\n"
                "  • Bloc A — 10 min : Traction stricte X/1/2/0 — 2 reps × 10 min\n"
                "  • Bloc B — 9 min : Traction partielle / Curl biceps / Le Y (triplet)\n"
                "  • Bloc C — 9 min : Curl / Le Y / Repos (triplet)\n"
                "  • Bloc D — 10 min : Traction australienne — 10D3/4/5"
            ),
            "exercices": [
                {"slug": "traction-stricte",     "reps": 2,  "tempo": "X/1/2/0", "pause_iso": 1.0, "duree_min": 10},
                {"slug": "traction-partielle",   "reps": 10, "tempo": "X/1/2/0",                   "duree_min": 9},
                {"slug": "curl-biceps-traction", "reps": 10, "tempo": "X/1/2/0",                   "duree_min": 9},
                {"slug": "le-y",                 "reps": 10, "tempo": "2/1/X/0",                   "duree_min": 9},
                {"slug": "traction-australienne","reps": 4,  "tempo": "X/1/2/0",                   "duree_min": 10},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Fractionné Z5 — 45 min (6×2:30 min R=2 min)",
            "zone": ZoneCourse.Z5, "duree_min": 45, "dplus_m": 0,
            "description": (
                "Terrain : piste ou route plate mesurée.\n"
                "• Échauffement : 10 min Z1/Z2\n"
                "• 6 × 2 min 30 Z5 (100-105% VMA) / 2 min récup Z1 trot\n"
                "• Retour : 5 min Z1\n"
                "Répétitions plus longues qu'en M1 — développer la puissance aérobie maximale."
            ),
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 28 min FULL BODY — Module 2 S2",
            "temps_limite": 28,
            "description": (
                "Circuit AMRAP 28 min — sit ups introduits :\n"
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
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 1h50 (D+ 700 m)",
            "zone": ZoneCourse.Z2, "duree_min": 110, "dplus_m": 700,
            "description": (
                "Terrain : trail (D+ 700 m). +20 min vs S1.\n"
                "Dénivelé significatif — gestion stricte de la zone Z2.\n"
                "Ravitaillement eau à 55 min recommandé."
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S3 — Pic Module 2 | Seuil 3×12min Z4 | AMRAP 30min | SL 2h10
    # -----------------------------------------------------------------------
    3: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "EF Z2 — 65 min (D+ 310 m)",
            "zone": ZoneCourse.Z2, "duree_min": 65, "dplus_m": 310,
            "description": "Terrain : trail (D+ 310 m). +5 min vs S2. Allure Z2 — récupération active avant séance seuil.",
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH (pauses) — Module 2 S3 (34 min)",
            "temps_limite": 34,
            "description": (
                "Structure EMOM PUSH avec pauses X/1/X/0 — 3 blocs :\n"
                "  • Bloc A — 10 min : Dips (pause X/1/X/0) — 4 reps × 10 min\n"
                "  • Bloc B — 6 min : Dips partiel — 6 reps × 6 min\n"
                "  • Bloc C — 9 min : Triceps ext / Pompes larges / Sit ups (triplet)\n"
                "      12 reps / 12 reps / 12 reps (cycle × 3)"
            ),
            "exercices": [
                {"slug": "dip-parallettes",       "reps": 4,  "tempo": "X/1/X/0", "pause_iso": 1.0, "duree_min": 10},
                {"slug": "dip-partiel",            "reps": 6,  "tempo": "2/1/X/0",                   "duree_min": 6},
                {"slug": "triceps-extension-dips", "reps": 12, "tempo": "2/1/X/0",                   "duree_min": 9},
                {"slug": "pompe-large",            "reps": 12, "tempo": "2/1/X/0",                   "duree_min": 9},
                {"slug": "sit-up",                 "reps": 12, "tempo": "X/0/2/0",                   "duree_min": 9},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Seuil Z4 — 50 min (3×12 min R=2 min)",
            "zone": ZoneCourse.Z4, "duree_min": 50, "dplus_m": 0,
            "description": (
                "Terrain : route plate.\n"
                "• Échauffement : 8 min Z2\n"
                "• 3 × 12 min Z4 (87-95% VMA) / 2 min récup Z1 trot\n"
                "• Retour : 4 min Z1\n"
                "+2 min par bloc vs S1 — séance seuil la plus longue du Module 2."
            ),
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 30 min FULL BODY — Module 2 S3",
            "temps_limite": 30,
            "description": (
                "Circuit AMRAP 30 min (focus postérieur) :\n"
                "  1. 10 Tractions australiennes\n"
                "  2. 10 Squats poids du corps\n"
                "  3. 10 Pompes prise large\n"
                "  4. 10 Dips aux parallettes\n"
                "  5. 10 Extensions de hanche (pont fessier)\n"
                "  6. 10 Burpees\n"
                "  7. 10 Mountain climbers"
            ),
            "exercices": [
                {"slug": "traction-australienne","reps": 10, "tempo": "X/1/2/0"},
                {"slug": "squat-bw",            "reps": 10, "tempo": "3/1/X/0"},
                {"slug": "pompe-large",         "reps": 10, "tempo": "2/1/X/0"},
                {"slug": "dip-parallettes",     "reps": 10, "tempo": "2/1/X/0"},
                {"slug": "extension-hanche",    "reps": 10, "tempo": "2/1/X/0"},
                {"slug": "burpee",              "reps": 10, "tempo": "X/0/X/0"},
                {"slug": "mountain-climber",    "reps": 10, "tempo": "X/0/X/0"},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 2h10 (D+ 1000 m)",
            "zone": ZoneCourse.Z2, "duree_min": 130, "dplus_m": 1000,
            "description": (
                "Terrain : trail (D+ 1000 m) — séance la plus longue du programme.\n"
                "Durée : 2h10 en Z2 strict. Marcher toutes les montées raides.\n"
                "Ravitaillement obligatoire : eau + glucides à 1h05."
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S4 — 2e pic / amorce décharge | Fractionné 8×2:30min Z5 | AMRAP 32min | SL 1h45
    # -----------------------------------------------------------------------
    4: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "EF Z2 — 70 min (D+ 380 m)",
            "zone": ZoneCourse.Z2, "duree_min": 70, "dplus_m": 380,
            "description": "Terrain : trail (D+ 380 m). Semaine pic M2. Allure Z2 — récupération avant fractionné.",
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PULL — Module 2 S4 (24 min)",
            "temps_limite": 24,
            "description": (
                "Structure EMOM PULL — 3 blocs :\n"
                "  • Bloc A — 9 min : Traction australienne + Traction stricte (alternés)\n"
                "      Trac australienne libre (min impairs) / trac stricte 4 reps (min pairs)\n"
                "  • Bloc B — 6 min : Curl biceps traction — 10 reps × 6 min\n"
                "  • Bloc C — 9 min : Rotateur long / Extension de hanche (alternés + hold)\n"
                "      13 reps / 13 reps / 30 sec hold (cycle × 3)"
            ),
            "exercices": [
                {"slug": "traction-australienne",  "reps": 10, "tempo": "X/1/2/0", "duree_min": 9},
                {"slug": "traction-stricte",       "reps": 4,  "tempo": "X/1/2/0", "duree_min": 9},
                {"slug": "curl-biceps-traction",   "reps": 10, "tempo": "X/1/2/0", "duree_min": 6},
                {"slug": "rotateur-long",          "reps": 13, "tempo": "2/1/X/0", "duree_min": 9},
                {"slug": "extension-hanche",       "reps": 13, "tempo": "2/1/X/0", "duree_min": 9},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Fractionné Z5 — 50 min (8×2:30 min R=1:30 min)",
            "zone": ZoneCourse.Z5, "duree_min": 50, "dplus_m": 0,
            "description": (
                "Terrain : piste ou route plate mesurée.\n"
                "• Échauffement : 10 min Z1/Z2\n"
                "• 8 × 2 min 30 Z5 (100-105% VMA) / 1 min 30 récup Z1 trot\n"
                "• Retour : 7 min Z1\n"
                "Pic du travail fractionné — volume et densité maximaux."
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
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue trail Z2 — 1h45 (D+ 600 m)",
            "zone": ZoneCourse.Z2, "duree_min": 105, "dplus_m": 600,
            "description": (
                "Terrain : trail (D+ 600 m). -25 min vs S3 — décharge du volume mais maintien D+.\n"
                "Allure Z2 sur tout le parcours."
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S5 — Décharge amorçée | Seuil 3×10min Z4 | AMRAP 20min | SL 1h30
    # -----------------------------------------------------------------------
    5: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "EF Z2 — 40 min (D+ 100 m)",
            "zone": ZoneCourse.Z2, "duree_min": 40, "dplus_m": 100,
            "description": "Terrain : chemin. Semaine de décharge — allure Z2 légère, sans effort ressenti.",
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH (décharge amorce) — Module 2 S5 (18 min)",
            "temps_limite": 18,
            "description": (
                "Structure EMOM PUSH décharge amorce — 2 blocs :\n"
                "  • Bloc A — 9 min : Dips (focus technique) — 5 reps × 9 min\n"
                "  • Bloc B — 9 min : Pompes standard / Triceps ext / Squat (triplet + hold)\n"
                "      14 reps pompes / 14 reps triceps / 15 reps squat (cycle × 3)"
            ),
            "exercices": [
                {"slug": "dip-parallettes",       "reps": 5,  "tempo": "2/1/X/0", "duree_min": 9},
                {"slug": "pompe-standard",        "reps": 14, "tempo": "2/0/X/0", "duree_min": 9},
                {"slug": "triceps-extension-dips","reps": 14, "tempo": "2/1/X/0", "duree_min": 9},
                {"slug": "squat-bw",             "reps": 15, "tempo": "3/1/X/0", "duree_min": 9},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Seuil Z4 — 45 min (3×10 min R=2 min) — maintenance",
            "zone": ZoneCourse.Z4, "duree_min": 45, "dplus_m": 0,
            "description": (
                "Terrain : route plate.\n"
                "• 3 × 10 min Z4 / 2 min récup — retour au volume S1 (maintenance)\n"
                "Pas de progression — maintenir l'acquis avant les tests."
            ),
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 20 min — Module 2 S5 (décharge)",
            "temps_limite": 20,
            "description": (
                "Circuit décharge AMRAP 20 min :\n"
                "  14 Triceps extension / 14 Rotateur long / 14 Pompes\n"
                "  → Répéter en circuit fermé pendant 20 min\n"
                "Focus technique — aucune intensité, maintien de la qualité gestuelle."
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
                "Terrain : trail (D+ 500 m). -15 min vs S4.\n"
                "Allure Z2 sans effort perçu — préserver l'énergie pour les tests S8."
            ),
        },
    ],

    # -----------------------------------------------------------------------
    # S6 — Décharge complète
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
                "  • Bloc A — 6 min : Dips + Pompes — 10 reps × 6 min\n"
                "  • Bloc B — 9 min : Triceps ext / Squat poids du corps — 10 reps / 15 reps / 30 sec"
            ),
            "exercices": [
                {"slug": "dip-parallettes",       "reps": 10, "tempo": "2/1/X/0", "duree_min": 6},
                {"slug": "pompe-standard",        "reps": 10, "tempo": "2/0/X/0", "duree_min": 6},
                {"slug": "triceps-extension-dips","reps": 10, "tempo": "2/1/X/0", "duree_min": 9},
                {"slug": "squat-bw",             "reps": 15, "tempo": "3/1/X/0", "duree_min": 9},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 15 min FULL BODY — Module 2 S6",
            "temps_limite": 15,
            "description": (
                "Circuit AMRAP 15 min décharge :\n"
                "  10 Tractions australiennes / 10 Squats / 10 Pompes / 10 Burpees / 10 Mountain climbers\n"
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
    ],

    # -----------------------------------------------------------------------
    # S7 — Affûtage
    # -----------------------------------------------------------------------
    7: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Activation Z1 — 20 min",
            "zone": ZoneCourse.Z1, "duree_min": 20, "dplus_m": 0,
            "description": "Terrain : route souple. Très légère, activation sans fatigue.",
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "Activation neuromusculaire — Module 2 S7 (15 min)",
            "temps_limite": 15,
            "description": (
                "Activation — schémas moteurs uniquement, aucune intensité :\n"
                "  10 Tractions australiennes lentes / 10 Pompes (3/1/3/0) / 10 Squats profonds\n"
                "  10 Burpees contrôlés / 10 Mountain climbers lents"
            ),
            "exercices": [
                {"slug": "traction-australienne","reps": 10, "tempo": "X/1/3/0", "duree_min": 3},
                {"slug": "pompe-standard",       "reps": 10, "tempo": "3/1/3/0", "duree_min": 3},
                {"slug": "squat-bw",             "reps": 10, "tempo": "3/1/X/0", "duree_min": 3},
                {"slug": "burpee",               "reps": 10, "tempo": "X/0/X/0", "duree_min": 3},
                {"slug": "mountain-climber",     "reps": 10, "tempo": "X/0/X/0", "duree_min": 3},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Prépa Demi-Cooper — 30 min Z2",
            "zone": ZoneCourse.Z2, "duree_min": 30, "dplus_m": 0,
            "description": (
                "Terrain : piste ou route plate mesurée.\n"
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
    # S8 — ÉVALUATION J120
    # -----------------------------------------------------------------------
    8: [
        {
            "jour": 1, "type": TypeSeance.EVALUATION, "titre": "Test VMA — Demi-Cooper J120",
            "duree_min": 30,
            "description": (
                "Terrain : piste ou parcours plat mesuré.\n"
                "• Échauffement : 10 min + 2×30 sec à allure cible\n"
                "• Test : 6 min à allure maximale\n"
                "• VMA = distance (m) ÷ 100\n"
                "Objectif J120 : 1700 m (VMA 17 km/h)"
            ),
        },
        {
            "jour": 3, "type": TypeSeance.EVALUATION, "titre": "Max Reps 1 min — 7 mouvements (J120)",
            "duree_min": 60,
            "description": (
                "Protocole J120 — 7 mouvements, 3-5 min de repos :\n"
                "  1. Tractions pronation strictes\n"
                "  2. Dips aux parallettes\n"
                "  3. Pompes standard\n"
                "  4. Sit ups\n"
                "  5. Squats poids du corps\n"
                "  6. Pistol squat gauche\n"
                "  7. Pistol squat droit\n"
                "Objectifs J120 : 10 trac / 20 dips / 40 pompes / 30 sit ups / 45 squats / 15 pistol G+D"
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
# S1/S3/S5 = Seuil · S2/S4 = Fractionné
# ============================================================================

MODULE3 = {

    # -----------------------------------------------------------------------
    # S1 — Reprise progressive | Seuil 3×10min | AMRAP 28min | SL 1h45
    # -----------------------------------------------------------------------
    1: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "EF Z2 — 65 min (D+ 400 m)",
            "zone": ZoneCourse.Z2, "duree_min": 65, "dplus_m": 400,
            "description": "Terrain : trail (D+ 400 m). Reprise après évaluation M2 — premier palier spécifique.\nAllure Z2 conversationnelle.",
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PULL — Module 3 S1 (28 min)",
            "temps_limite": 28,
            "description": (
                "Structure EMOM PULL — 3 blocs :\n"
                "  • Bloc A — 10 min : Traction australienne (libre) — 10 reps × 10 min\n"
                "  • Bloc B — 9 min : Curl biceps traction / Le Y (alternés)\n"
                "      10 reps / 10 reps (cycle × 4)\n"
                "  • Bloc C — 9 min : Rotateur long / Extension de hanche (alternés)\n"
                "      10 reps / 15 reps (cycle × 4)"
            ),
            "exercices": [
                {"slug": "traction-australienne",  "reps": 10, "tempo": "X/1/2/0", "duree_min": 10},
                {"slug": "curl-biceps-traction",   "reps": 10, "tempo": "X/1/2/0", "duree_min": 9},
                {"slug": "le-y",                   "reps": 10, "tempo": "2/1/X/0", "duree_min": 9},
                {"slug": "rotateur-long",          "reps": 10, "tempo": "2/1/X/0", "duree_min": 9},
                {"slug": "extension-hanche",       "reps": 15, "tempo": "2/1/X/0", "duree_min": 9},
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
    # S2 — Montée en charge | Fractionné 6×3min Z5 | AMRAP 30min | SL 2h
    # -----------------------------------------------------------------------
    2: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "EF Z2 — 72 min (D+ 480 m)",
            "zone": ZoneCourse.Z2, "duree_min": 72, "dplus_m": 480,
            "description": "Terrain : trail (D+ 480 m). +7 min vs S1 M3. Récupération avant fractionné.",
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH — Module 3 S2 (31 min)",
            "temps_limite": 31,
            "description": (
                "Structure EMOM PUSH — 3 blocs :\n"
                "  • Bloc A — 10 min : Dips aux parallettes (pause basse) — 4 reps × 10 min\n"
                "  • Bloc B — 9 min : Pompes larges / Squat poids du corps (alternés × 4)\n"
                "      11 reps pompes / 15 reps squat\n"
                "  • Bloc C — 12 min : Pompes larges / Triceps ext / Sit ups (triplet × 4)\n"
                "      11 reps / 11 reps / 11 reps"
            ),
            "exercices": [
                {"slug": "dip-parallettes",       "reps": 4,  "tempo": "2/1/X/0", "duree_min": 10},
                {"slug": "pompe-large",           "reps": 11, "tempo": "2/1/X/0", "duree_min": 9},
                {"slug": "squat-bw",             "reps": 15, "tempo": "3/1/X/0", "duree_min": 9},
                {"slug": "triceps-extension-dips","reps": 11, "tempo": "2/1/X/0", "duree_min": 12},
                {"slug": "sit-up",               "reps": 11, "tempo": "X/0/2/0", "duree_min": 12},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Fractionné Z5 — 50 min (6×3 min R=3 min)",
            "zone": ZoneCourse.Z5, "duree_min": 50, "dplus_m": 0,
            "description": (
                "Terrain : piste ou route plate mesurée.\n"
                "• Échauffement : 10 min Z1/Z2\n"
                "• 6 × 3 min Z5 (100-105% VMA) / 3 min récup Z1 trot\n"
                "• Retour : 4 min Z1\n"
                "1ère séance fractionnée longue du Module 3 — tenir l'allure sur 3 min."
            ),
        },
        {
            "jour": 4, "type": TypeSeance.AMRAP, "titre": "AMRAP 30 min — Module 3 S2",
            "temps_limite": 30,
            "description": (
                "Circuit AMRAP 30 min — +2 min + pompes larges vs S1 :\n"
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
    # S3 — Intensification | Seuil 3×12min Z4 | AMRAP 32min | SL 2h15
    # -----------------------------------------------------------------------
    3: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "EF Z2 — 78 min (D+ 560 m)",
            "zone": ZoneCourse.Z2, "duree_min": 78, "dplus_m": 560,
            "description": "Terrain : trail (D+ 560 m). +6 min vs S2 M3. Allure Z2 — récupération active avant séance seuil.",
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PULL — Module 3 S3 (34 min)",
            "temps_limite": 34,
            "description": (
                "Structure EMOM PULL (pauses isométriques) — 3 blocs :\n"
                "  • Bloc A — 10 min : Traction australienne (pause 2 sec position haute)\n"
                "      5 reps × 10 min (tempo X/2/2/0)\n"
                "  • Bloc B — 12 min : Traction stricte / Curl biceps / Le Y (triplet × 4)\n"
                "      4 reps / 12 reps / 12 reps\n"
                "  • Bloc C — 12 min : Rotateur long / Extension de hanche (alternés × 4)\n"
                "      12 reps / 12 reps"
            ),
            "exercices": [
                {"slug": "traction-australienne", "reps": 5,  "tempo": "X/2/2/0", "pause_iso": 2.0, "duree_min": 10},
                {"slug": "traction-stricte",      "reps": 4,  "tempo": "X/1/2/0",                   "duree_min": 12},
                {"slug": "curl-biceps-traction",  "reps": 12, "tempo": "X/1/2/0",                   "duree_min": 12},
                {"slug": "le-y",                  "reps": 12, "tempo": "2/1/X/0",                   "duree_min": 12},
                {"slug": "rotateur-long",         "reps": 12, "tempo": "2/1/X/0",                   "duree_min": 12},
                {"slug": "extension-hanche",      "reps": 12, "tempo": "2/1/X/0",                   "duree_min": 12},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Seuil Z4 — 55 min (3×12 min R=2 min)",
            "zone": ZoneCourse.Z4, "duree_min": 55, "dplus_m": 0,
            "description": (
                "Terrain : route plate.\n"
                "• Échauffement : 8 min Z2\n"
                "• 3 × 12 min Z4 (87-95% VMA) / 2 min récup trot Z1\n"
                "• Retour : 5 min Z1\n"
                "+2 min par bloc vs S1 — séance seuil la plus longue du Module 3."
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
    # S4 — Pic | Fractionné 8×3min Z5 | AMRAP 35min | SL 2h30
    # -----------------------------------------------------------------------
    4: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "EF Z2 — 85 min (D+ 650 m)",
            "zone": ZoneCourse.Z2, "duree_min": 85, "dplus_m": 650,
            "description": "Terrain : trail (D+ 650 m). Semaine pic M3. Allure Z2 — récupération active avant fractionné.",
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PUSH — Module 3 S4 — PIC (37 min)",
            "temps_limite": 37,
            "description": (
                "Structure EMOM PUSH PIC — 3 blocs :\n"
                "  • Bloc A — 12 min : Dips aux parallettes (pause 2 sec basse) — 6 reps × 12 min\n"
                "  • Bloc B — 12 min : Pompes larges / Squat poids du corps (alternés × 4)\n"
                "      13 reps pompes / 15 reps squat\n"
                "  • Bloc C — 13 min : Pompes standard / Triceps ext / Chaise iso (triplet × 4)\n"
                "      13 reps / 13 reps / 30 sec"
            ),
            "exercices": [
                {"slug": "dip-parallettes",       "reps": 6,  "tempo": "2/2/X/0", "pause_iso": 2.0, "duree_min": 12},
                {"slug": "pompe-large",           "reps": 13, "tempo": "2/1/X/0",                   "duree_min": 12},
                {"slug": "squat-bw",             "reps": 15, "tempo": "3/1/X/0",                   "duree_min": 12},
                {"slug": "pompe-standard",       "reps": 13, "tempo": "2/0/X/0",                   "duree_min": 13},
                {"slug": "triceps-extension-dips","reps": 13, "tempo": "2/1/X/0",                   "duree_min": 13},
                {"slug": "chaise-isometrique",   "reps": None, "tempo": None,                       "duree_min": 13},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Fractionné Z5 — 55 min (8×3 min R=2 min)",
            "zone": ZoneCourse.Z5, "duree_min": 55, "dplus_m": 0,
            "description": (
                "Terrain : piste ou route plate mesurée.\n"
                "• Échauffement : 10 min Z1/Z2\n"
                "• 8 × 3 min Z5 (100-105% VMA) / 2 min récup Z1 trot\n"
                "• Retour : 5 min Z1\n"
                "Séance fractionnée la plus ambitieuse du programme — tenir Z5 sur 3 min × 8."
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
    # S5 — Décharge amorçée | Seuil 3×10min Z4 | AMRAP 28min | SL 2h
    # -----------------------------------------------------------------------
    5: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "EF Z2 — 50 min (D+ 150 m)",
            "zone": ZoneCourse.Z2, "duree_min": 50, "dplus_m": 150,
            "description": "Terrain : chemin (D+ 150 m). Semaine de décharge — allure Z2 légère.",
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "EMOM PULL — Module 3 S5 (26 min)",
            "temps_limite": 26,
            "description": (
                "Structure EMOM PULL décharge amorçée — 3 blocs :\n"
                "  • Bloc A — 9 min : Traction australienne (libre) — 5 reps × 9 min\n"
                "  • Bloc B — 9 min : Curl biceps traction / Le Y (alternés × 4)\n"
                "      12 reps / 12 reps\n"
                "  • Bloc C — 8 min : Rotateur long / Extension de hanche (alternés × 4)\n"
                "      12 reps / 12 reps"
            ),
            "exercices": [
                {"slug": "traction-australienne", "reps": 5,  "tempo": "X/1/2/0", "duree_min": 9},
                {"slug": "curl-biceps-traction",  "reps": 12, "tempo": "X/1/2/0", "duree_min": 9},
                {"slug": "le-y",                  "reps": 12, "tempo": "2/1/X/0", "duree_min": 9},
                {"slug": "rotateur-long",         "reps": 12, "tempo": "2/1/X/0", "duree_min": 8},
                {"slug": "extension-hanche",      "reps": 12, "tempo": "2/1/X/0", "duree_min": 8},
            ]
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Seuil Z4 — 45 min (3×10 min R=2 min) — maintenance",
            "zone": ZoneCourse.Z4, "duree_min": 45, "dplus_m": 0,
            "description": "Terrain : route plate. Retour au volume S1 — seuil de maintenance avant tests.",
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
    # S6 — Décharge complète
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
                "  • Bloc A — 9 min : Dips + Pompes alternés — 10 reps × 9 min\n"
                "  • Bloc B — 9 min : Curl / Le Y / Repos (triplet × 3) — 10 reps / 10 reps / repos"
            ),
            "exercices": [
                {"slug": "dip-parallettes",     "reps": 10, "tempo": "2/1/X/0", "duree_min": 9},
                {"slug": "pompe-standard",      "reps": 10, "tempo": "2/0/X/0", "duree_min": 9},
                {"slug": "curl-biceps-traction","reps": 10, "tempo": "X/1/2/0", "duree_min": 9},
                {"slug": "le-y",                "reps": 10, "tempo": "2/1/X/0", "duree_min": 9},
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
    # S7 — Affûtage
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
                "Activation — schémas moteurs uniquement, aucune intensité :\n"
                "  5 Tractions australiennes (3/1/3/0) / 5 Dips (3/1/3/0) / 10 Pompes\n"
                "  10 Squats profonds / 5 Burpees contrôlés"
            ),
            "exercices": [
                {"slug": "traction-australienne","reps": 5,  "tempo": "3/1/3/0", "duree_min": 3},
                {"slug": "dip-parallettes",      "reps": 5,  "tempo": "3/1/3/0", "duree_min": 3},
                {"slug": "pompe-standard",       "reps": 10, "tempo": "3/1/3/0", "duree_min": 3},
                {"slug": "squat-bw",             "reps": 10, "tempo": "3/1/X/0", "duree_min": 3},
                {"slug": "burpee",               "reps": 5,  "tempo": "X/0/X/0", "duree_min": 3},
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
    # S8 — ÉVALUATION J180
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

def _inserer_seances_en_session(db, mc, module_data: dict):
    """Insère les séances d'un module dans une session SQLAlchemy existante (sans commit)."""
    semaines = {s.numero_semaine: s for s in mc.semaines}
    exercices_map = {e.slug: e for e in db.query(VariationExercice).all()}
    total_seances = 0
    slugs_manquants = set()

    for num_sem, seances in module_data.items():
        semaine = semaines.get(num_sem)
        if not semaine:
            continue

        for s_ex in list(semaine.seances):
            for ex in list(s_ex.exercices):
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
                    duree_bloc_min=ex_data.get("duree_min"),
                ))

    if slugs_manquants:
        print(f"  Slugs manquants : {slugs_manquants}")
    return total_seances


def _inserer_semaines(numero_cycle: int, module_data: dict):
    """Ouvre sa propre session (utilisé pour les seeds autonomes)."""
    creer_tables()
    db = SessionLocal()
    try:
        mc = db.query(Macrocycle).filter(
            Macrocycle.numero_cycle == numero_cycle,
            Macrocycle.utilisateur_id == 1,
        ).order_by(Macrocycle.id.desc()).first()
        if not mc:
            print(f"Macrocycle numero_cycle={numero_cycle} introuvable.")
            return
        _inserer_seances_en_session(db, mc, module_data)
        db.commit()
        noms = {1: "Module 1 - Adaptation", 2: "Module 2 - Révélation", 3: "Module 3 - Confirmation"}
        print(f"MC{numero_cycle} ({noms.get(numero_cycle, str(numero_cycle))}) : seed OK.")
    except Exception as e:
        db.rollback()
        print(f"Erreur MC{numero_cycle} : {e}")
        raise
    finally:
        db.close()


def seed_module1():
    _inserer_semaines(1, MODULE1)


def seed_module2():
    _inserer_semaines(2, MODULE2)


def seed_module3():
    _inserer_semaines(3, MODULE3)


# ============================================================================
# PROGRAMME ORIENTÉ COURSE — seed adaptatif N semaines
# ============================================================================

# Pool de semaines de surcharge : 15 semaines max (M1 S1-5, M2 S1-5, M3 S1-5)
_POOL_SURCHARGE = {
    **{i: MODULE1[i] for i in range(1, 6)},
    **{i + 5: MODULE2[i] for i in range(1, 6)},
    **{i + 10: MODULE3[i] for i in range(1, 6)},
}


def _semaine_course(date_course, course_nom: str) -> list:
    """Contenu de la semaine de course : activation légère + jour J."""
    from datetime import date as date_type
    if isinstance(date_course, date_type):
        jour_course = date_course.weekday() + 1  # 1=lundi … 7=dimanche
    else:
        jour_course = 6  # samedi par défaut

    seances = [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Activation Z1 — 15 min",
            "zone": ZoneCourse.Z1, "duree_min": 15, "dplus_m": 0,
            "description": (
                "Sortie très légère d'activation — pas d'effort.\n"
                "Respiration nasale uniquement, aucune sensation de fatigue.\n"
                "Objectif : activer la circulation, garder les jambes légères avant la course."
            ),
        },
        {
            "jour": 2, "type": TypeSeance.EMOM, "titre": "Activation neuromusculaire — 10 min",
            "temps_limite": 10,
            "description": (
                "5 mouvements × 2 min — schémas moteurs uniquement, zéro intensité :\n"
                "  Traction australienne / Pompes / Squats / Burpees / Mountain climbers\n"
                "Focus : fluidité du mouvement, aucune fatigue résiduelle."
            ),
            "exercices": [
                {"slug": "traction-australienne", "reps": 5, "tempo": "X/1/3/0", "duree_min": 2},
                {"slug": "pompe-standard",        "reps": 5, "tempo": "3/1/3/0", "duree_min": 2},
                {"slug": "squat-bw",              "reps": 5, "tempo": "3/1/X/0", "duree_min": 2},
                {"slug": "burpee",                "reps": 5, "tempo": "X/0/X/0", "duree_min": 2},
                {"slug": "mountain-climber",      "reps": 5, "tempo": "X/0/X/0", "duree_min": 2},
            ],
        },
        {
            "jour": min(jour_course, 7),
            "type": TypeSeance.COURSE,
            "titre": f"COURSE — {course_nom}",
            "zone": ZoneCourse.Z4,
            "duree_min": None,
            "dplus_m": 0,
            "description": (
                f"Jour de course : {course_nom}\n"
                "Pas d'échauffement intensif — 10 min de trot léger suffisent.\n"
                "Allure cible : voir Dashboard → Prochain objectif.\n"
                "Bonne course !"
            ),
        },
    ]

    # Dédoublonner si le jour_course tombe sur un jour déjà utilisé (lundi ou mardi)
    jours_utilises = {s["jour"] for s in seances[:-1]}
    if seances[-1]["jour"] in jours_utilises:
        seances[-1]["jour"] = max(jours_utilises) + 1

    return seances


# ─── EMOM complémentaires pour la 3e séance muscu (j5 = vendredi) ──────────

_COMPLEMENT_EMOM_PUSH = {
    "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM PUSH — 3e séance",
    "temps_limite": 20,
    "description": (
        "EMOM PUSH complémentaire — 2 blocs :\n"
        "  • Bloc A — 10 min : Dips + Pompes standard (alternés)\n"
        "      6 dips / 10 pompes (cycle × 5)\n"
        "  • Bloc B — 10 min : Pompes prise large / Extension triceps / Squat (triplet × 3)\n"
        "      8 reps / 10 reps / 15 reps"
    ),
    "exercices": [
        {"slug": "dip-parallettes",       "reps": 6,  "tempo": "2/1/X/0", "duree_min": 10},
        {"slug": "pompe-standard",        "reps": 10, "tempo": "2/0/X/0", "duree_min": 10},
        {"slug": "pompe-large",           "reps": 8,  "tempo": "2/1/X/0", "duree_min": 10},
        {"slug": "triceps-extension-dips","reps": 10, "tempo": "2/1/X/0", "duree_min": 10},
        {"slug": "squat-bw",             "reps": 15, "tempo": "3/1/X/0", "duree_min": 10},
    ],
}

_COMPLEMENT_EMOM_PULL = {
    "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM PULL — 3e séance",
    "temps_limite": 20,
    "description": (
        "EMOM PULL complémentaire — 2 blocs :\n"
        "  • Bloc A — 10 min : Traction australienne + Curl biceps (alternés)\n"
        "      8 tractions / 10 curl (cycle × 5)\n"
        "  • Bloc B — 10 min : Le Y / Extension de hanche (alternés × 5)\n"
        "      10 reps / 15 reps"
    ),
    "exercices": [
        {"slug": "traction-australienne","reps": 8,  "tempo": "X/1/2/0", "duree_min": 10},
        {"slug": "curl-biceps-traction", "reps": 10, "tempo": "X/1/2/0", "duree_min": 10},
        {"slug": "le-y",                "reps": 10, "tempo": "2/1/X/0", "duree_min": 10},
        {"slug": "extension-hanche",    "reps": 15, "tempo": "2/1/X/0", "duree_min": 10},
    ],
}


def adapter_contenu_muscu(content: dict, seances_muscu: int) -> dict:
    """Adapte le contenu d'un programme selon le nombre de séances muscu/semaine.

    - 1 séance  → supprime tous les EMOM, garde uniquement l'AMRAP
    - 2 séances → comportement par défaut (1 EMOM + 1 AMRAP)
    - 3+ séances → ajoute un EMOM complémentaire (PUSH si la semaine est PULL, et vice versa)
                   sur le jour 5 (vendredi), sauf semaines de décharge/affûtage/évaluation
    """
    result = {}
    for sem, seances in content.items():
        if seances_muscu == 1:
            result[sem] = [s for s in seances if s.get("type") != TypeSeance.EMOM]
        elif seances_muscu >= 3:
            emoms = [s for s in seances if s.get("type") == TypeSeance.EMOM]
            jours_pris = {s["jour"] for s in seances}
            if (
                len(emoms) == 1
                and 5 not in jours_pris
                and (emoms[0].get("temps_limite") or 0) >= 18  # pas une séance décharge (<18 min)
            ):
                is_pull = "PULL" in emoms[0].get("titre", "")
                complement = dict(_COMPLEMENT_EMOM_PULL if is_pull else _COMPLEMENT_EMOM_PUSH)
                result[sem] = seances + [complement]
            else:
                result[sem] = seances
        else:
            result[sem] = seances
    return result


# ============================================================================
# SÉANCES SALLE — MACHINES
# ============================================================================

_GYM_UPPER_BASE = {
    "jour": 2, "type": TypeSeance.GYM_UPPER, "titre": "Upper Body — Machines (60 min)",
    "temps_limite": 60,
    "description": (
        "Upper Body Machines | 3 séries × 10-12 reps | Repos 60-90 sec\n\n"
        "PECTORAUX & ÉPAULES\n"
        "  • Développé pectoraux machine      3×10   tempo 2/0/X/1\n"
        "  • Écarté pectoraux — Pec Deck      3×12   tempo 2/1/X/0\n"
        "  • Développé épaules machine        3×10   tempo 2/0/X/1\n"
        "  • Élévations latérales câble       3×15   tempo 2/1/X/0\n\n"
        "DOS & BICEPS\n"
        "  • Tirage vertical — Lat Pulldown   3×10   tempo 2/1/X/0\n"
        "  • Rowing assis câble               3×12   tempo 2/1/X/0\n"
        "  • Face Pull câble                  3×15   tempo 2/0/X/1\n"
        "  • Curl biceps câble                3×12   tempo 2/1/X/0\n\n"
        "TRICEPS\n"
        "  • Extension triceps poulie         3×12   tempo 2/1/X/0\n\n"
        "Charge : 60-70 % 1RM. Dernier set à l'échec si possible."
    ),
}

_GYM_LOWER_BASE = {
    "jour": 4, "type": TypeSeance.GYM_LOWER, "titre": "Lower Body — Machines (60 min)",
    "temps_limite": 60,
    "description": (
        "Lower Body Machines | 3-4 séries × 10-15 reps | Repos 90 sec-2 min\n\n"
        "QUADRICEPS & FESSIERS\n"
        "  • Presse à cuisses                 4×10   tempo 3/1/X/0\n"
        "  • Hack squat machine               3×10   tempo 3/1/X/0\n"
        "  • Extension jambes                 3×15   tempo 2/1/X/0\n\n"
        "ISCHIO-JAMBIERS & FESSIERS\n"
        "  • Hip Thrust machine               3×12   tempo 2/1/X/1\n"
        "  • Curl jambes couché               3×12   tempo 2/1/X/0\n"
        "  • Curl jambes assis                3×12   tempo 2/1/X/0\n\n"
        "ADDUCTEURS & MOLLETS\n"
        "  • Abduction / Adduction hanche     3×15 chaque\n"
        "  • Élévation mollets debout         4×15   tempo 3/1/X/0\n\n"
        "Charge : 60-70 % 1RM. Contrôle excentrique prioritaire."
    ),
}

_GYM_FULL_BASE = {
    "jour": 5, "type": TypeSeance.GYM_FULL, "titre": "Full Body — Machines (75 min)",
    "temps_limite": 75,
    "description": (
        "Full Body Machines | 3 séries × 10-12 reps | Repos 90 sec\n\n"
        "BAS DU CORPS\n"
        "  • Presse à cuisses                 3×12   tempo 3/1/X/0\n"
        "  • Hip Thrust machine               3×12   tempo 2/1/X/1\n"
        "  • Extension jambes                 3×15   tempo 2/0/X/0\n\n"
        "HAUT DU CORPS — PUSH\n"
        "  • Développé pectoraux machine      3×10   tempo 2/0/X/1\n"
        "  • Développé épaules machine        3×10   tempo 2/0/X/1\n"
        "  • Extension triceps câble          3×12   tempo 2/1/X/0\n\n"
        "HAUT DU CORPS — PULL\n"
        "  • Tirage vertical — Lat Pulldown   3×10   tempo 2/1/X/0\n"
        "  • Rowing assis câble               3×12   tempo 2/1/X/0\n"
        "  • Curl biceps câble                3×12   tempo 2/1/X/0\n\n"
        "FINITION\n"
        "  • Élévation mollets debout         3×15   tempo 3/1/X/0\n\n"
        "Charge : 60-70 % 1RM. Circuit push/pull/jambes enchaîné."
    ),
}

# Variantes allégées pour semaines de décharge/affûtage
_GYM_UPPER_DECHARGE = {
    "jour": 2, "type": TypeSeance.GYM_UPPER, "titre": "Upper Body Léger — Machines (40 min)",
    "temps_limite": 40,
    "description": (
        "Upper Body Décharge | 2 séries × 12-15 reps | Charge -30 % | Repos 60 sec\n\n"
        "  • Développé pectoraux machine      2×12   tempo 2/0/X/1\n"
        "  • Tirage vertical — Lat Pulldown   2×12   tempo 2/1/X/0\n"
        "  • Développé épaules machine        2×12   tempo 2/0/X/1\n"
        "  • Rowing assis câble               2×15   tempo 2/1/X/0\n"
        "  • Face Pull câble                  2×15   tempo 2/0/X/1\n"
        "  • Curl biceps câble                2×15   tempo 2/1/X/0\n"
        "  • Extension triceps poulie         2×15   tempo 2/1/X/0\n\n"
        "Objectif : maintien — pas de travail à l'échec."
    ),
}

_GYM_LOWER_DECHARGE = {
    "jour": 4, "type": TypeSeance.GYM_LOWER, "titre": "Lower Body Léger — Machines (40 min)",
    "temps_limite": 40,
    "description": (
        "Lower Body Décharge | 2 séries × 12-15 reps | Charge -30 % | Repos 60 sec\n\n"
        "  • Presse à cuisses                 2×12   tempo 3/1/X/0\n"
        "  • Extension jambes                 2×15   tempo 2/1/X/0\n"
        "  • Hip Thrust machine               2×15   tempo 2/1/X/1\n"
        "  • Curl jambes couché               2×15   tempo 2/1/X/0\n"
        "  • Abduction hanche                 2×15\n"
        "  • Élévation mollets debout         2×20   tempo 3/1/X/0\n\n"
        "Objectif : maintien — mobilité et activation prioritaires."
    ),
}

_GYM_FULL_DECHARGE = {
    "jour": 2, "type": TypeSeance.GYM_FULL, "titre": "Full Body Léger — Machines (45 min)",
    "temps_limite": 45,
    "description": (
        "Full Body Décharge | 2 séries × 12-15 reps | Charge -30 % | Repos 60 sec\n\n"
        "  • Presse à cuisses                 2×12   tempo 3/1/X/0\n"
        "  • Développé pectoraux machine      2×12   tempo 2/0/X/1\n"
        "  • Tirage vertical — Lat Pulldown   2×12   tempo 2/1/X/0\n"
        "  • Hip Thrust machine               2×15   tempo 2/1/X/1\n"
        "  • Rowing assis câble               2×15   tempo 2/1/X/0\n"
        "  • Extension triceps câble          2×15   tempo 2/1/X/0\n"
        "  • Curl biceps câble                2×15   tempo 2/1/X/0\n\n"
        "Objectif : maintien — pas de travail à l'échec."
    ),
}


def adapter_contenu_gym(content: dict, n_muscu: int) -> dict:
    """Remplace les séances EMOM/AMRAP par des séances machines Upper/Lower/Full Body.

    - 1 séance → Full Body (J2)
    - 2 séances → Upper (J2) + Lower (J4)
    - 3+ séances → Upper (J2) + Lower (J4) + Full Body (J5)
    Semaines de décharge/évaluation : variantes allégées, 1 séance max.
    """
    result = {}
    for sem, seances in content.items():
        amraps = [s for s in seances if s.get("type") == TypeSeance.AMRAP]
        is_decharge = not amraps or (amraps[0].get("temps_limite") or 0) < 20

        autres = [s for s in seances if s.get("type") not in (TypeSeance.EMOM, TypeSeance.AMRAP)]

        if is_decharge:
            if n_muscu >= 2:
                gym = [dict(_GYM_UPPER_DECHARGE), dict(_GYM_LOWER_DECHARGE)]
            else:
                gym = [dict(_GYM_FULL_DECHARGE)]
        else:
            if n_muscu == 1:
                full = dict(_GYM_FULL_BASE); full["jour"] = 2
                gym = [full]
            elif n_muscu == 2:
                gym = [dict(_GYM_UPPER_BASE), dict(_GYM_LOWER_BASE)]
            else:
                gym = [dict(_GYM_UPPER_BASE), dict(_GYM_LOWER_BASE), dict(_GYM_FULL_BASE)]

        result[sem] = autres + gym
    return result


def adapter_contenu_course(content: dict, seances_course: int) -> dict:
    """Réduit le nombre de séances course/semaine si inférieur au contenu par défaut.

    Priorité de conservation (ordre décroissant d'importance) :
    1. Sortie longue (jour le plus tardif)
    2. Fractionné / Seuil (intensité — jour intermédiaire)
    3. EF Z2 (récupération active — la moins critique, jour le plus tôt)
    """
    if seances_course <= 0:
        return content
    result = {}
    for sem, seances in content.items():
        courses = [s for s in seances if s.get("type") == TypeSeance.COURSE]
        autres = [s for s in seances if s.get("type") != TypeSeance.COURSE]
        if len(courses) > seances_course:
            # Trier par jour décroissant : sortie longue (J6) en premier, EF (J1) en dernier
            courses = sorted(courses, key=lambda s: s.get("jour", 0), reverse=True)[:seances_course]
        result[sem] = autres + sorted(courses, key=lambda s: s.get("jour", 0))
    return result


def _min_to_heure(minutes: int) -> str:
    """Convertit des minutes en format 'Xh' ou 'XhYY' (ex: 90→'1h30', 120→'2h')."""
    h, m = divmod(minutes, 60)
    return f"{h}h{m:02d}" if m else f"{h}h"


def _heure_to_min(s: str) -> int | None:
    """Parse '1h30'→90, '2h'→120. Retourne None si format non reconnu."""
    import re
    mo = re.match(r'^(\d+)h(\d*)$', s.strip())
    if mo:
        return int(mo.group(1)) * 60 + (int(mo.group(2)) if mo.group(2) else 0)
    return None


def _remplacer_duree_titre(titre: str, orig_min: int, new_min: int) -> str:
    """Remplace la durée dans un titre, en gérant les formats 'X min' et 'XhYY'."""
    if orig_min == new_min:
        return titre
    # Format "X min"
    if f"{orig_min} min" in titre:
        return titre.replace(f"{orig_min} min", f"{new_min} min", 1)
    # Format heures "XhYY" ou "Xh"
    orig_h = _min_to_heure(orig_min)
    if orig_h in titre:
        return titre.replace(orig_h, _min_to_heure(new_min), 1)
    return titre


def calibrer_module(module_data: dict, km_factor: float = 1.0, amrap_factor: float = 1.0, reps_factor: float = 1.0) -> dict:
    """Retourne une copie calibrée du module avec durées et répétitions ajustées au niveau de l'utilisateur."""
    result = {}
    for sem, seances in module_data.items():
        sem_cal = []
        for s in seances:
            ns = dict(s)
            t = ns.get("type")
            titre = ns.get("titre", "")
            if t == TypeSeance.COURSE:
                orig_dur = ns.get("duree_min")
                orig_dplus = ns.get("dplus_m")
                if orig_dur:
                    new_dur = max(20, round(orig_dur * km_factor / 5) * 5)
                    ns["duree_min"] = new_dur
                    titre = _remplacer_duree_titre(titre, orig_dur, new_dur)
                if orig_dplus:
                    new_dplus = max(0, round(orig_dplus * km_factor / 10) * 10)
                    ns["dplus_m"] = new_dplus
                    if titre and new_dplus != orig_dplus:
                        titre = titre.replace(f"D+ {orig_dplus} m", f"D+ {new_dplus} m", 1)
                        titre = titre.replace(f"D+ {orig_dplus}m", f"D+ {new_dplus}m", 1)
                ns["titre"] = titre
            elif t == TypeSeance.AMRAP and ns.get("temps_limite"):
                orig_tl = ns["temps_limite"]
                new_tl = max(10, round(orig_tl * amrap_factor / 2) * 2)
                ns["temps_limite"] = new_tl
                if titre and new_tl != orig_tl:
                    ns["titre"] = titre.replace(f"{orig_tl} min", f"{new_tl} min", 1)
            elif t == TypeSeance.EMOM and ns.get("temps_limite"):
                orig_tl = ns["temps_limite"]
                emom_factor = amrap_factor * 0.5 + 0.5
                new_tl = max(8, round(orig_tl * emom_factor / 2) * 2)
                ns["temps_limite"] = new_tl
                if titre and new_tl != orig_tl:
                    ns["titre"] = titre.replace(f"{orig_tl} min", f"{new_tl} min", 1)
                    # aussi la parenthèse ex: "(32 min)"
                    ns["titre"] = ns["titre"].replace(f"({orig_tl} min)", f"({new_tl} min)", 1)
            if "exercices" in ns:
                exs = []
                for ex in ns["exercices"]:
                    nex = dict(ex)
                    if nex.get("reps") is not None:
                        nex["reps"] = max(1, round(nex["reps"] * reps_factor))
                    exs.append(nex)
                ns["exercices"] = exs
            sem_cal.append(ns)
        result[sem] = sem_cal
    return result


def calculer_paces_vma(vma_kmh: float) -> dict:
    """Retourne les allures (format MM:SS/km) pour chaque zone depuis la VMA en km/h."""
    def to_pace(kmh: float) -> str:
        if not kmh or kmh <= 0:
            return "—"
        s = 3600 / kmh
        return f"{int(s // 60)}:{int(s % 60):02d}/km"

    return {
        "Z1":   to_pace(vma_kmh * 0.62),   # 60-65% → 62%
        "Z2":   to_pace(vma_kmh * 0.70),   # 65-75% → 70%
        "Z3":   to_pace(vma_kmh * 0.80),   # 75-85% → 80%
        "Z4":   to_pace(vma_kmh * 0.90),   # 85-95% → 90%
        "Z5":   to_pace(vma_kmh * 1.025),  # 100-105% → 102.5%
        "recup": to_pace(vma_kmh * 0.62),
        "vma":  vma_kmh,
    }


def enrichir_paces_vma(content: dict, vma_kmh: float) -> dict:
    """Injecte les allures cibles réelles (calculées depuis VMA) dans chaque séance de course."""
    if not vma_kmh or vma_kmh <= 0:
        return content

    paces = calculer_paces_vma(vma_kmh)

    zone_info = {
        ZoneCourse.Z1: (paces["Z1"],   "Z1 — récupération",       "60-65%"),
        ZoneCourse.Z2: (paces["Z2"],   "Z2 — endurance fond.",     "65-75%"),
        ZoneCourse.Z3: (paces["Z3"],   "Z3 — tempo",               "75-85%"),
        ZoneCourse.Z4: (paces["Z4"],   "Z4 — seuil lactique",      "85-95%"),
        ZoneCourse.Z5: (paces["Z5"],   "Z5 — VO₂max",             "100-105%"),
    }

    result = {}
    for sem, seances in content.items():
        enriched = []
        for s in seances:
            ns = dict(s)
            if ns.get("type") == TypeSeance.COURSE:
                zone = ns.get("zone")
                if zone and zone in zone_info:
                    pace, label, pct = zone_info[zone]
                    if zone == ZoneCourse.Z5:
                        coach_line = (
                            f"── Coach ({vma_kmh:.1f} km/h VMA) ────────────────\n"
                            f"Allure effort : {pace} ({pct} VMA)\n"
                            f"Allure récup  : {paces['recup']} (Z1)\n"
                            f"──────────────────────────────────────\n"
                        )
                    else:
                        coach_line = (
                            f"── Coach ({vma_kmh:.1f} km/h VMA) ────────────────\n"
                            f"Allure cible : {pace} ({label} — {pct} VMA)\n"
                            f"──────────────────────────────────────\n"
                        )
                    ns["description"] = coach_line + (ns.get("description") or "")
            enriched.append(ns)
        result[sem] = enriched
    return result


def _semaine_taper_course() -> list:
    """Semaine d'affûtage avant course : légèreté, rappel d'allure, zéro fatigue."""
    return [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Activation Z1/Z2 — 25 min",
            "zone": ZoneCourse.Z2, "duree_min": 25, "dplus_m": 0,
            "description": (
                "Terrain : route plate.\n"
                "Footing très léger Z1/Z2 — jambes légères, respiration nasale.\n"
                "Objectif : garder du tonus sans accumuler de fatigue avant la course.\n"
                "Pas de montre, pas de chrono — ressenti uniquement."
            ),
        },
        {
            "jour": 3, "type": TypeSeance.COURSE, "titre": "Rappel d'allure — 20 min",
            "zone": ZoneCourse.Z4, "duree_min": 20, "dplus_m": 0,
            "description": (
                "• 8 min Z1 échauffement\n"
                "• 3 × 1 min à allure course cible / 2 min récup trot\n"
                "• 3 min Z1 retour au calme\n"
                "Rappel neuromusculaire de l'allure — aucune fatigue résiduelle tolérable."
            ),
        },
        {
            "jour": 5, "type": TypeSeance.DECHARGE, "titre": "Mobilité & repos actif — 30 min",
            "description": (
                "  • 10 min mobilité hanches et chevilles\n"
                "  • 10 min étirements doux chaîne postérieure\n"
                "  • 10 min visualisation du parcours et de la stratégie de course\n"
                "Prépare mentalement et physiquement la performance du jour J."
            ),
        },
    ]


def seed_programme_course(n_semaines: int, date_course=None, course_nom: str = "Course"):
    """
    Seed adaptatif pour un programme orienté course de n_semaines semaines.

    Structure :
      Semaines 1 … n-3 : surcharge progressive (contenu M1/M2/M3 dans l'ordre)
      Semaine n-2       : décharge (M1 S6)
      Semaine n-1       : affûtage (M1 S7)
      Semaine n         : semaine de course (activation + jour J)
    """
    n_surcharge = n_semaines - 3

    content: dict[int, list] = {}

    for i in range(1, n_surcharge + 1):
        pool_idx = min(i, 15)
        content[i] = _POOL_SURCHARGE[pool_idx]

    content[n_surcharge + 1] = MODULE1[6]   # décharge
    content[n_surcharge + 2] = MODULE1[7]   # affûtage
    content[n_semaines]      = _semaine_course(date_course, course_nom)

    _inserer_semaines(1, content)


if __name__ == "__main__":
    seed_module1()
    seed_module2()
    seed_module3()
