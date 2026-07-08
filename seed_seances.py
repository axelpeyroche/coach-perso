"""
Seed des séances EPC — 8 semaines complètes avec détail complet.
MODULE 1 : Adaptation (S1-S4) | MODULE 2 : Révélation (S5-S8)

Champs renseignés par séance :
  Course    : durée (min), D+ (m), terrain, zone, allure cible (min/km), intervalles
  Muscu     : exercices, reps, séries, tempo, pause iso, récupération, durée EMOM/AMRAP
"""

from datetime import date, timedelta
from database import SessionLocal, creer_tables
from models import (
    Macrocycle, SemaineEntrainement, SeanceEntrainement,
    ExerciceSeance, VariationExercice, TypeSeance, ZoneCourse
)

# ---------------------------------------------------------------------------
# Données complètes des séances
# ---------------------------------------------------------------------------

SEANCES_PAR_SEMAINE = {

    # ===================================================================
    # SEMAINE 1 — Adaptation | AMRAP 20 min | Volume course : entrée
    # ===================================================================
    1: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Endurance fondamentale Z2",
            "zone": ZoneCourse.Z2, "duree_min": 35, "dplus_m": 0,
            "description": (
                "Terrain : route / piste plate.\n"
                "Allure cible : Z2 — 65-75% VMA (~5'30\"/km à 6'30\"/km selon ta VMA).\n"
                "Respiration nasale prioritaire. Allure conversationnelle stricte.\n"
                "Si tu montes en Z3, ralentis immédiatement."
            ),
        },
        {
            "jour": 2, "type": TypeSeance.AMRAP, "titre": "AMRAP 20 min — Circuit A",
            "temps_limite": 20,
            "description": (
                "Format : AMRAP (As Many Rounds As Possible) en 20 minutes.\n"
                "Enchaîner les 5 exercices sans repos imposé entre eux.\n"
                "Tempos stricts — qualité > vitesse. Note ton score (ex. 4.3 rounds)."
            ),
            "exercices": [
                {"slug": "traction-stricte",   "reps": 5,  "tempo": "X/1/2/0", "pause_iso": 1.0, "recup_sec": 0},
                {"slug": "pompe-standard",      "reps": 10, "tempo": "2/1/X/0", "pause_iso": None, "recup_sec": 0},
                {"slug": "squat-bw",            "reps": 15, "tempo": "3/1/X/0", "pause_iso": None, "recup_sec": 0},
                {"slug": "dip-parallettes",     "reps": 8,  "tempo": "2/1/X/0", "pause_iso": None, "recup_sec": 0},
                {"slug": "mountain-climber",    "reps": 10, "tempo": "X/0/X/0", "pause_iso": None, "recup_sec": 0},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.COURSE, "titre": "Fractionné court Z4 — 6×1 min",
            "zone": ZoneCourse.Z4, "duree_min": 30, "dplus_m": 0,
            "description": (
                "Terrain : route plate ou piste.\n"
                "Structure :\n"
                "  • Échauffement : 8 min Z1/Z2 (~6'00\"/km)\n"
                "  • 6 × 1 min Z4 (87-95% VMA, ~4'00\"-4'20\"/km) / 1 min récup marche Z1\n"
                "  • Retour au calme : 5 min Z1\n"
                "Total : ~30 min. Volume fractionné : 6 min à haute intensité."
            ),
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM 16 min — Technique (4 mvts)",
            "temps_limite": 16,
            "description": (
                "Format : EMOM (Every Minute On the Minute) sur 16 minutes.\n"
                "4 exercices × 4 rounds = 16 minutes.\n"
                "Chaque minute : réalise les reps prescrites, le reste de la minute est ta récupération.\n"
                "Focus : amplitude maximale et respect des tempos."
            ),
            "exercices": [
                {"slug": "traction-australienne", "reps": 8,  "tempo": "X/1/2/0", "pause_iso": None, "recup_sec": None},
                {"slug": "pompe-standard",        "reps": 12, "tempo": "2/0/X/0", "pause_iso": None, "recup_sec": None},
                {"slug": "squat-bw",              "reps": 15, "tempo": "2/1/X/0", "pause_iso": None, "recup_sec": None},
                {"slug": "abdominal-crunch",      "reps": 15, "tempo": "2/0/2/0", "pause_iso": None, "recup_sec": None},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue Z2 — 50 min",
            "zone": ZoneCourse.Z2, "duree_min": 50, "dplus_m": 0,
            "description": (
                "Terrain : route ou chemin plat. Pas de trail cette semaine.\n"
                "Durée : 50 minutes continues en Z2.\n"
                "Allure cible : Z2 — ~5'45\"/km à 6'30\"/km selon ta VMA.\n"
                "Hydratation : gorgée toutes les 20 min.\n"
                "Objectif : volume aérobie sans fatigue excessive."
            ),
        },
    ],

    # ===================================================================
    # SEMAINE 2 — Adaptation | AMRAP 22 min | Volume +
    # ===================================================================
    2: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Endurance fondamentale Z2",
            "zone": ZoneCourse.Z2, "duree_min": 40, "dplus_m": 0,
            "description": (
                "Terrain : route / chemin plat.\n"
                "Allure cible : Z2 — 65-75% VMA.\n"
                "+5 min vs S1. Même ressenti, volume légèrement augmenté.\n"
                "Si tu ressens le besoin, intègre 2×1 min de marche."
            ),
        },
        {
            "jour": 2, "type": TypeSeance.AMRAP, "titre": "AMRAP 22 min — Circuit A",
            "temps_limite": 22,
            "description": (
                "Format : AMRAP 22 min. Même circuit que S1 + 2 minutes.\n"
                "Objectif : faire au moins autant de rounds qu'en S1 (progression attendue).\n"
                "Introduction : pause isométrique 1 sec sur les tractions en haut du mouvement."
            ),
            "exercices": [
                {"slug": "traction-stricte",   "reps": 5,  "tempo": "X/1/2/0", "pause_iso": 1.0, "recup_sec": 0},
                {"slug": "pompe-standard",      "reps": 10, "tempo": "2/1/X/0", "pause_iso": None, "recup_sec": 0},
                {"slug": "squat-bw",            "reps": 15, "tempo": "3/1/X/0", "pause_iso": None, "recup_sec": 0},
                {"slug": "dip-parallettes",     "reps": 8,  "tempo": "2/1/X/0", "pause_iso": None, "recup_sec": 0},
                {"slug": "mountain-climber",    "reps": 10, "tempo": "X/0/X/0", "pause_iso": None, "recup_sec": 0},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.COURSE, "titre": "Fractionné court Z4 — 8×1 min",
            "zone": ZoneCourse.Z4, "duree_min": 35, "dplus_m": 0,
            "description": (
                "Terrain : route plate ou piste.\n"
                "Structure :\n"
                "  • Échauffement : 8 min Z1/Z2\n"
                "  • 8 × 1 min Z4 (87-95% VMA, ~4'00\"-4'20\"/km) / 1 min récup marche Z1\n"
                "  • Retour au calme : 5 min Z1\n"
                "Total : ~35 min. +2 répétitions vs S1."
            ),
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM 20 min — Force (4 mvts)",
            "temps_limite": 20,
            "description": (
                "Format : EMOM 20 min — 5 rounds de 4 exercices.\n"
                "Introduction de la pause isométrique sur les tractions (1 sec en haut).\n"
                "Si tu termines les reps avant la fin de la minute, repos = bénéfice."
            ),
            "exercices": [
                {"slug": "traction-stricte",  "reps": 6,  "tempo": "X/1/2/0", "pause_iso": 1.0, "recup_sec": None},
                {"slug": "pompe-standard",    "reps": 12, "tempo": "2/1/X/0", "pause_iso": None, "recup_sec": None},
                {"slug": "squat-bw",          "reps": 15, "tempo": "3/1/X/0", "pause_iso": None, "recup_sec": None},
                {"slug": "abdominal-crunch",  "reps": 15, "tempo": "2/0/2/0", "pause_iso": None, "recup_sec": None},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue Z2 — 60 min",
            "zone": ZoneCourse.Z2, "duree_min": 60, "dplus_m": 50,
            "description": (
                "Terrain : route ou chemin légèrement vallonné (D+ ~50 m max).\n"
                "Durée : 60 minutes en Z2 continu.\n"
                "Allure cible : Z2 — ~5'45\"/km à 6'30\"/km.\n"
                "Premier dénivelé léger pour préparer les semaines suivantes."
            ),
        },
    ],

    # ===================================================================
    # SEMAINE 3 — Adaptation | AMRAP 25 min | Introduction seuil + tempos stricts
    # ===================================================================
    3: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Endurance Z2 + accélérations Z3",
            "zone": ZoneCourse.Z2, "duree_min": 40, "dplus_m": 0,
            "description": (
                "Terrain : route plate.\n"
                "Structure :\n"
                "  • 30 min Z2 (~5'45\"/km à 6'30\"/km)\n"
                "  • 3 × 2 min Z3 (80-87% VMA, ~4'45\"-5'15\"/km) / 1 min Z2 entre chaque\n"
                "  • Retour 3 min Z1\n"
                "Première introduction du seuil bas. Reste contrôlé."
            ),
        },
        {
            "jour": 2, "type": TypeSeance.AMRAP, "titre": "AMRAP 25 min — Circuit B (tempos stricts)",
            "temps_limite": 25,
            "description": (
                "Format : AMRAP 25 min. Nouveau circuit B.\n"
                "Tempos renforcés sur tous les mouvements. Pause isométrique sur dips ET tractions.\n"
                "Qualité absolue avant le volume. Réduis les reps si besoin pour maintenir le tempo."
            ),
            "exercices": [
                {"slug": "traction-stricte",  "reps": 6,  "tempo": "X/1/2/0", "pause_iso": 1.0, "recup_sec": 0},
                {"slug": "pompe-standard",    "reps": 10, "tempo": "3/1/X/0", "pause_iso": None, "recup_sec": 0},
                {"slug": "squat-bw",          "reps": 15, "tempo": "3/2/X/0", "pause_iso": None, "recup_sec": 0},
                {"slug": "dip-parallettes",   "reps": 8,  "tempo": "3/1/X/0", "pause_iso": 1.0, "recup_sec": 0},
                {"slug": "burpee",            "reps": 8,  "tempo": "X/0/X/0", "pause_iso": None, "recup_sec": 0},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.COURSE, "titre": "Seuil Z3/Z4 — 3×5 min + 2×2 min",
            "zone": ZoneCourse.Z3, "duree_min": 40, "dplus_m": 0,
            "description": (
                "Terrain : route plate ou légèrement montante.\n"
                "Structure :\n"
                "  • Échauffement : 8 min Z1/Z2\n"
                "  • 3 × 5 min Z3 (80-87% VMA, ~4'45\"-5'15\"/km) / 2 min récup Z1 trot\n"
                "  • 2 × 2 min Z4 (87-95% VMA, ~4'00\"-4'30\"/km) / 2 min récup Z1 marche\n"
                "  • Retour au calme : 5 min Z1\n"
                "Total : ~40 min. Séance seuil qualitative."
            ),
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM 20 min — Force excentrique (4 mvts)",
            "temps_limite": 20,
            "description": (
                "Format : EMOM 20 min — 5 rounds de 4 exercices.\n"
                "Focus : phase excentrique lente (3 sec) sur tous les mouvements.\n"
                "L'excentrique lent recrute davantage de fibres musculaires. Concentre-toi sur la descente."
            ),
            "exercices": [
                {"slug": "traction-stricte",  "reps": 5,  "tempo": "X/2/3/0", "pause_iso": 1.0, "recup_sec": None},
                {"slug": "dip-parallettes",   "reps": 8,  "tempo": "3/1/X/0", "pause_iso": None, "recup_sec": None},
                {"slug": "squat-bw",          "reps": 20, "tempo": "3/1/X/0", "pause_iso": None, "recup_sec": None},
                {"slug": "abdominal-crunch",  "reps": 20, "tempo": "2/1/2/0", "pause_iso": None, "recup_sec": None},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue Z2 — 70 min",
            "zone": ZoneCourse.Z2, "duree_min": 70, "dplus_m": 80,
            "description": (
                "Terrain : chemin mixte route/trail léger (D+ ~80 m).\n"
                "Durée : 70 minutes en Z2 continu.\n"
                "Allure cible : Z2 — ajuster selon le dénivelé (ralentir dans les côtes, rester en Z2).\n"
                "Premier contact avec le trail léger."
            ),
        },
    ],

    # ===================================================================
    # SEMAINE 4 — Surcharge peak | AMRAP 28 min | Pic charge
    # ===================================================================
    4: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Endurance Z2 + bloc tempo Z3",
            "zone": ZoneCourse.Z2, "duree_min": 45, "dplus_m": 0,
            "description": (
                "Terrain : route plate.\n"
                "Structure :\n"
                "  • 35 min Z2 (~5'45\"/km à 6'30\"/km)\n"
                "  • 10 min Z3 continu (80-87% VMA, ~4'45\"-5'15\"/km)\n"
                "Bloc tempo le plus long jusqu'ici. Gestion de l'effort sur la durée."
            ),
        },
        {
            "jour": 2, "type": TypeSeance.AMRAP, "titre": "AMRAP 28 min — Circuit B intensifié",
            "temps_limite": 28,
            "description": (
                "Format : AMRAP 28 min. Circuit B avec exigences maximales.\n"
                "Pause isométrique 1 sec systématique sur tractions ET dips.\n"
                "Tempos 3 sec sur toutes les phases excentriques. Pic de charge musculaire."
            ),
            "exercices": [
                {"slug": "traction-stricte",  "reps": 6,  "tempo": "X/2/3/0", "pause_iso": 1.0, "recup_sec": 0},
                {"slug": "pompe-standard",    "reps": 10, "tempo": "3/1/X/0", "pause_iso": None, "recup_sec": 0},
                {"slug": "squat-bw",          "reps": 20, "tempo": "3/2/X/0", "pause_iso": None, "recup_sec": 0},
                {"slug": "dip-parallettes",   "reps": 8,  "tempo": "3/2/X/0", "pause_iso": 1.0, "recup_sec": 0},
                {"slug": "burpee",            "reps": 10, "tempo": "X/0/X/0", "pause_iso": None, "recup_sec": 0},
                {"slug": "mountain-climber",  "reps": 10, "tempo": "X/0/X/0", "pause_iso": None, "recup_sec": 0},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.COURSE, "titre": "Fractionné long Z4 + sprints Z5",
            "zone": ZoneCourse.Z4, "duree_min": 45, "dplus_m": 0,
            "description": (
                "Terrain : route plate ou piste.\n"
                "Structure :\n"
                "  • Échauffement : 10 min Z1/Z2\n"
                "  • 4 × 3 min Z4 (87-95% VMA, ~4'00\"-4'20\"/km) / 2 min récup Z1 trot\n"
                "  • 4 × 30 sec Z5 (95-110% VMA, ~3'30\"-3'50\"/km) / 90 sec marche Z1\n"
                "  • Retour au calme : 8 min Z1\n"
                "Total : ~45 min. Séance la plus exigeante en course."
            ),
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM 24 min — Force/Endurance (4 mvts)",
            "temps_limite": 24,
            "description": (
                "Format : EMOM 24 min — 6 rounds de 4 exercices.\n"
                "Tempos excentriques lents maintenus même en fatigue en fin de séance.\n"
                "Si tu ne peux plus tenir le tempo, réduis les reps, ne brade pas la qualité."
            ),
            "exercices": [
                {"slug": "traction-stricte",  "reps": 6,  "tempo": "X/2/3/0", "pause_iso": 1.0, "recup_sec": None},
                {"slug": "dip-parallettes",   "reps": 10, "tempo": "3/1/X/0", "pause_iso": 1.0, "recup_sec": None},
                {"slug": "squat-bw",          "reps": 20, "tempo": "3/2/X/0", "pause_iso": None, "recup_sec": None},
                {"slug": "abdominal-crunch",  "reps": 20, "tempo": "2/1/2/0", "pause_iso": None, "recup_sec": None},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue Z2 — 80 min",
            "zone": ZoneCourse.Z2, "duree_min": 80, "dplus_m": 150,
            "description": (
                "Terrain : trail ou chemin vallonné (D+ ~150 m).\n"
                "Durée : 80 minutes en Z2. Marcher dans les côtes si nécessaire pour rester en Z2.\n"
                "Allure cible : Z2 — gérer selon le terrain, FC est le repère principal.\n"
                "Pic de sortie longue de la phase Adaptation."
            ),
        },
    ],

    # ===================================================================
    # SEMAINE 5 — Révélation | AMRAP 33 min | Pic total du programme
    # ===================================================================
    5: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Endurance Z2 — consolidation",
            "zone": ZoneCourse.Z2, "duree_min": 45, "dplus_m": 0,
            "description": (
                "Terrain : route plate.\n"
                "Maintien du volume S4. Récupération active entre les blocs d'intensité.\n"
                "Allure Z2 stricte — tu entres dans la semaine de pic, conserve l'énergie."
            ),
        },
        {
            "jour": 2, "type": TypeSeance.AMRAP, "titre": "AMRAP 33 min — Pic musculaire",
            "temps_limite": 33,
            "description": (
                "Format : AMRAP 33 min — séance la plus longue du programme.\n"
                "Gestion de l'effort sur la durée : ni trop vite au départ, ni trop lent.\n"
                "Tempos maintenus même en fatigue. Pause iso 1 sec sur tractions et dips.\n"
                "Note ton score final — c'est ta référence avant les évaluations."
            ),
            "exercices": [
                {"slug": "traction-stricte",  "reps": 6,  "tempo": "X/2/3/0", "pause_iso": 1.0, "recup_sec": 0},
                {"slug": "pompe-standard",    "reps": 10, "tempo": "3/1/X/0", "pause_iso": None, "recup_sec": 0},
                {"slug": "squat-bw",          "reps": 20, "tempo": "3/2/X/0", "pause_iso": None, "recup_sec": 0},
                {"slug": "dip-parallettes",   "reps": 8,  "tempo": "3/2/X/0", "pause_iso": 1.0, "recup_sec": 0},
                {"slug": "burpee",            "reps": 10, "tempo": "X/0/X/0", "pause_iso": None, "recup_sec": 0},
                {"slug": "mountain-climber",  "reps": 10, "tempo": "X/0/X/0", "pause_iso": None, "recup_sec": 0},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.COURSE, "titre": "Fractionné Z4/Z5 — pic intensité",
            "zone": ZoneCourse.Z4, "duree_min": 50, "dplus_m": 0,
            "description": (
                "Terrain : route plate ou piste.\n"
                "Structure :\n"
                "  • Échauffement : 10 min Z1/Z2\n"
                "  • 5 × 3 min Z4 (87-95% VMA, ~4'00\"-4'20\"/km) / 2 min récup Z1 trot\n"
                "  • 5 × 30 sec Z5 (95-110% VMA, ~3'30\"-3'50\"/km) / 90 sec marche Z1\n"
                "  • Retour au calme : 8 min Z1\n"
                "Total : ~50 min. Pic d'intensité course du programme."
            ),
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM 28 min — Consolidation (4 mvts)",
            "temps_limite": 28,
            "description": (
                "Format : EMOM 28 min — 7 rounds de 4 exercices.\n"
                "Séance la plus longue en EMOM. Observation des sensations en fin de séance.\n"
                "Si tu tiens le tempo et les reps jusqu'au bout : tu as progressé significativement."
            ),
            "exercices": [
                {"slug": "traction-stricte",  "reps": 7,  "tempo": "X/2/3/0", "pause_iso": 1.0, "recup_sec": None},
                {"slug": "dip-parallettes",   "reps": 10, "tempo": "3/1/X/0", "pause_iso": 1.0, "recup_sec": None},
                {"slug": "squat-bw",          "reps": 20, "tempo": "3/2/X/0", "pause_iso": None, "recup_sec": None},
                {"slug": "abdominal-crunch",  "reps": 20, "tempo": "2/1/2/0", "pause_iso": None, "recup_sec": None},
            ]
        },
        {
            "jour": 6, "type": TypeSeance.COURSE, "titre": "Sortie longue Z2 — 90 min",
            "zone": ZoneCourse.Z2, "duree_min": 90, "dplus_m": 200,
            "description": (
                "Terrain : trail (D+ ~200 m). Montées marchées si FC dépasse Z2.\n"
                "Durée : 90 minutes — pic de sortie longue du programme.\n"
                "Allure Z2 stricte. Ravitaillement conseillé à 45 min (gel ou fruit).\n"
                "Récupération post-séance : étirements 15 min + hydratation."
            ),
        },
    ],

    # ===================================================================
    # SEMAINE 6 — Décharge | Volume -30% | Récupération active
    # ===================================================================
    6: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Récupération active Z1 — 25 min",
            "zone": ZoneCourse.Z1, "duree_min": 25, "dplus_m": 0,
            "description": (
                "Terrain : route plate, idéalement herbe ou chemin souple.\n"
                "Allure Z1 — très facile (~6'30\"/km à 7'30\"/km). Aucune pression.\n"
                "Objectif unique : activer la circulation sanguine et vider la fatigue musculaire."
            ),
        },
        {
            "jour": 2, "type": TypeSeance.AMRAP, "titre": "AMRAP 20 min — Décharge (reps réduites)",
            "temps_limite": 20,
            "description": (
                "Format : AMRAP 20 min. Reps réduites de 30-40%.\n"
                "Pas de pause isométrique en décharge. Tempos normaux, aucune fatigue voulue.\n"
                "Objectif : maintien des schémas moteurs, pas de surcharge."
            ),
            "exercices": [
                {"slug": "traction-stricte",  "reps": 4, "tempo": "X/1/2/0", "pause_iso": None, "recup_sec": 0},
                {"slug": "pompe-standard",    "reps": 8, "tempo": "2/1/X/0", "pause_iso": None, "recup_sec": 0},
                {"slug": "squat-bw",          "reps": 12,"tempo": "3/1/X/0", "pause_iso": None, "recup_sec": 0},
                {"slug": "dip-parallettes",   "reps": 6, "tempo": "2/1/X/0", "pause_iso": None, "recup_sec": 0},
            ]
        },
        {
            "jour": 4, "type": TypeSeance.COURSE, "titre": "Sortie courte Z2 — 25 min",
            "zone": ZoneCourse.Z2, "duree_min": 25, "dplus_m": 0,
            "description": (
                "Terrain : route plate.\n"
                "Sortie courte et facile. Allure Z2 confortable.\n"
                "Aucune intensité, aucun dépassement de zone. Pure récupération active."
            ),
        },
        {
            "jour": 5, "type": TypeSeance.DECHARGE, "titre": "Mobilité & Récupération — 45 min",
            "description": (
                "Programme de récupération :\n"
                "  • 15 min foam rolling : mollets → ischio-jambiers → fessiers → dorsaux → pectoraux\n"
                "  • 20 min étirements statiques profonds (30 sec par position, 2 séries) :\n"
                "      - Fléchisseurs de hanches, quadriceps, ischio, mollets\n"
                "      - Pectoraux, biceps, dorsaux\n"
                "  • 10 min respiration abdominale profonde / relaxation\n"
                "Aucun effort cardiovasculaire."
            ),
        },
    ],

    # ===================================================================
    # SEMAINE 7 — Affûtage | Volume -40% | Prep évaluation
    # ===================================================================
    7: [
        {
            "jour": 1, "type": TypeSeance.COURSE, "titre": "Activation légère Z1 — 20 min",
            "zone": ZoneCourse.Z1, "duree_min": 20, "dplus_m": 0,
            "description": (
                "Terrain : route souple ou herbe.\n"
                "Allure Z1 — très légère (~7'00\"/km). Uniquement pour activer la circulation.\n"
                "Aucun effort ressenti. Si tu transpires, tu vas trop vite."
            ),
        },
        {
            "jour": 3, "type": TypeSeance.DECHARGE, "titre": "Yoga & Mobilité — 60 min",
            "description": (
                "Séance complète de mobilité :\n"
                "  • 20 min yoga : postures de mobilité hanches et épaules\n"
                "  • 20 min étirements profonds colonne vertébrale et chaîne postérieure\n"
                "  • 10 min gainage doux (planche 3×30 sec, superman 3×10)\n"
                "  • 10 min respiration abdominale et visualisation de l'évaluation\n"
                "Préparation mentale et physique pour la semaine 8."
            ),
        },
        {
            "jour": 5, "type": TypeSeance.EMOM, "titre": "EMOM 15 min — Activation neuromusculaire",
            "temps_limite": 15,
            "description": (
                "Format : EMOM 15 min — 5 rounds de 3 exercices.\n"
                "Reps très basses. Tempos normaux. Objectif : activer le système nerveux sans fatiguer.\n"
                "Dernière séance muscu avant les tests. Reste frais."
            ),
            "exercices": [
                {"slug": "traction-stricte",  "reps": 3, "tempo": "X/1/2/0", "pause_iso": None, "recup_sec": None},
                {"slug": "pompe-standard",    "reps": 6, "tempo": "2/0/X/0", "pause_iso": None, "recup_sec": None},
                {"slug": "squat-bw",          "reps": 10,"tempo": "2/0/X/0", "pause_iso": None, "recup_sec": None},
            ]
        },
    ],

    # ===================================================================
    # SEMAINE 8 — Évaluation | Tests EPC officiels
    # ===================================================================
    8: [
        {
            "jour": 1, "type": TypeSeance.EVALUATION, "titre": "Demi-Cooper — Test VMA",
            "duree_min": 30,
            "description": (
                "Terrain : piste d'athlétisme ou parcours plat mesuré (GPS).\n"
                "Protocole :\n"
                "  • Échauffement : 10 min Z1/Z2 progressif\n"
                "  • Test : 6 minutes à allure maximale soutenable (départ conservateur, accélérer à 4 min)\n"
                "  • Relever la distance parcourue en mètres\n"
                "  • VMA calculée automatiquement : distance (m) / 100\n"
                "  • Toutes les zones Z1-Z5 sont recalculées instantanément\n"
                "  • Récupération : 15 min marche Z1 avant les tests muscu"
            ),
        },
        {
            "jour": 3, "type": TypeSeance.EVALUATION, "titre": "Max Répétitions — 1 minute par mouvement",
            "duree_min": 60,
            "description": (
                "Protocole 7 mouvements — 3 min de récupération entre chaque :\n"
                "  1. Tractions strictes (prise pronation)\n"
                "  2. Dips aux parallettes\n"
                "  3. Pompes standard\n"
                "  4. Abdominaux crunch\n"
                "  5. Squats poids du corps\n"
                "  6. Pistol Squat Gauche\n"
                "  7. Pistol Squat Droit\n"
                "Score : répétitions complètes en 60 secondes strictes.\n"
                "Chronomètre visible. Pas de reps partielles comptabilisées."
            ),
        },
        {
            "jour": 5, "type": TypeSeance.EVALUATION, "titre": "AMRAP Benchmark — 10 minutes",
            "temps_limite": 10, "duree_min": 20,
            "description": (
                "Circuit fixe EPC — sans repos imposé :\n"
                "  10 Tractions → 10 Pompes → 10 Squats → 10 Dips → 10 Burpees → 10 Mountain Climbers\n"
                "Score : tours totaux (ex. 2.9 = 2 tours complets + 9 reps dans le 3e).\n"
                "Échauffement : 5 min mobilité articulaire.\n"
                "Récupération : 5 min marche avant de démarrer.\n"
                "Compare ton score à celui du macrocycle précédent pour mesurer la progression."
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
                        print(f"  Exercice introuvable : {ex_data['slug']}")
                        continue
                    ex_seance = ExerciceSeance(
                        seance_id=seance.id,
                        exercice_id=exercice.id,
                        ordre=pos,
                        repetitions=ex_data.get("reps"),
                        tempo_override=ex_data.get("tempo"),
                        pause_isometrique_override_sec=ex_data.get("pause_iso"),
                        recuperation_sec=ex_data.get("recup_sec"),
                    )
                    db.add(ex_seance)
                    total_exercices += 1

        db.commit()
        print(f"OK — {total_seances} séances et {total_exercices} exercices insérés.")

    except Exception as e:
        db.rollback()
        print(f"Erreur : {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_seances()
