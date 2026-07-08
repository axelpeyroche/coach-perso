"""
Règles de périodisation EPC — Blueprint du macrocycle 8 semaines.

Structure :
    Semaines 1-5 : Surcharge progressive (volume et intensité croissants)
    Semaines 6-7 : Décharge / Récupération active (volume -30 à -40%)
    Semaine 8    : Évaluation et tests (Demi-Cooper, Max 1 min, AMRAP Benchmark)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Optional

from models import TypeMacrophase, TypeSeance, ZoneCourse


# ---------------------------------------------------------------------------
# Structures de données
# ---------------------------------------------------------------------------

@dataclass
class RegleSemaine:
    """Prescription normalisée pour une semaine du macrocycle."""
    numero: int
    macrophase: TypeMacrophase
    multiplicateur_volume: float
    objectif_amrap_min: Optional[int]
    objectif_km_course: Optional[float]
    description: str
    types_seances: list[TypeSeance] = field(default_factory=list)


@dataclass
class PrescriptionSeance:
    """Détail d'une séance individuelle dans la semaine."""
    jour: int                          # 1 = lundi, 7 = dimanche
    type_seance: TypeSeance
    titre: str
    zone_cible: Optional[ZoneCourse] = None
    distance_cible_km: Optional[float] = None
    duree_cible_min: Optional[int] = None
    temps_limite_min: Optional[int] = None
    description: str = ""


# ---------------------------------------------------------------------------
# Blueprint du macrocycle — 8 semaines EPC
# ---------------------------------------------------------------------------

BLUEPRINT_MACROCYCLE: list[RegleSemaine] = [
    RegleSemaine(
        numero=1,
        macrophase=TypeMacrophase.SURCHARGE,
        multiplicateur_volume=1.00,
        objectif_amrap_min=20,
        objectif_km_course=15.0,
        description="Semaine d'entrée — mise en route progressive, découverte des mouvements et des zones",
        types_seances=[TypeSeance.COURSE, TypeSeance.AMRAP, TypeSeance.COURSE, TypeSeance.EMOM, TypeSeance.REPOS],
    ),
    RegleSemaine(
        numero=2,
        macrophase=TypeMacrophase.SURCHARGE,
        multiplicateur_volume=1.10,
        objectif_amrap_min=22,
        objectif_km_course=17.0,
        description="Augmentation légère du volume course (+2 km) et du temps AMRAP (+2 min)",
        types_seances=[TypeSeance.COURSE, TypeSeance.AMRAP, TypeSeance.COURSE, TypeSeance.EMOM, TypeSeance.REPOS],
    ),
    RegleSemaine(
        numero=3,
        macrophase=TypeMacrophase.SURCHARGE,
        multiplicateur_volume=1.20,
        objectif_amrap_min=25,
        objectif_km_course=19.0,
        description="Intensification — introduction des tempos stricts et des pauses isométriques",
        types_seances=[TypeSeance.COURSE, TypeSeance.AMRAP, TypeSeance.COURSE, TypeSeance.EMOM, TypeSeance.REPOS],
    ),
    RegleSemaine(
        numero=4,
        macrophase=TypeMacrophase.SURCHARGE,
        multiplicateur_volume=1.30,
        objectif_amrap_min=28,
        objectif_km_course=21.0,
        description="Pic de surcharge — volume maximal de la phase, sollicitation Z3/Z4 en course",
        types_seances=[TypeSeance.COURSE, TypeSeance.AMRAP, TypeSeance.COURSE, TypeSeance.EMOM, TypeSeance.COURSE],
    ),
    RegleSemaine(
        numero=5,
        macrophase=TypeMacrophase.SURCHARGE,
        multiplicateur_volume=1.30,
        objectif_amrap_min=33,
        objectif_km_course=23.0,
        description="Consolidation — maintien du pic, AMRAP porté à 33 min, travail Z4/Z5",
        types_seances=[TypeSeance.COURSE, TypeSeance.AMRAP, TypeSeance.COURSE, TypeSeance.EMOM, TypeSeance.REPOS],
    ),
    RegleSemaine(
        numero=6,
        macrophase=TypeMacrophase.DECHARGE,
        multiplicateur_volume=0.70,
        objectif_amrap_min=20,
        objectif_km_course=14.0,
        description="Décharge — volume réduit de 30%, priorité récupération active et mobilité",
        types_seances=[TypeSeance.COURSE, TypeSeance.AMRAP, TypeSeance.DECHARGE, TypeSeance.REPOS, TypeSeance.REPOS],
    ),
    RegleSemaine(
        numero=7,
        macrophase=TypeMacrophase.DECHARGE,
        multiplicateur_volume=0.60,
        objectif_amrap_min=15,
        objectif_km_course=10.0,
        description="Affûtage final — volume minimal, étirements profonds, focus récupération neuromusculaire",
        types_seances=[TypeSeance.COURSE, TypeSeance.DECHARGE, TypeSeance.REPOS, TypeSeance.REPOS, TypeSeance.REPOS],
    ),
    RegleSemaine(
        numero=8,
        macrophase=TypeMacrophase.EVALUATION,
        multiplicateur_volume=0.50,
        objectif_amrap_min=None,
        objectif_km_course=None,
        description="Semaine d'évaluation — Demi-Cooper, Max 1 min (7 mouvements), AMRAP Benchmark 10 min",
        types_seances=[TypeSeance.EVALUATION, TypeSeance.REPOS, TypeSeance.EVALUATION, TypeSeance.REPOS, TypeSeance.EVALUATION],
    ),
]


# ---------------------------------------------------------------------------
# Séances types par macrophase
# ---------------------------------------------------------------------------

SEANCES_SURCHARGE: dict[int, list[PrescriptionSeance]] = {
    # Modèle de semaine de surcharge (adapté semaine par semaine via multiplicateur_volume)
    1: [  # Lundi
        PrescriptionSeance(
            jour=1, type_seance=TypeSeance.COURSE, titre="Course fondamentale Z2",
            zone_cible=ZoneCourse.Z2, duree_cible_min=35,
            description="Allure confortable, respiration nasale prioritaire"
        ),
    ],
    2: [  # Mardi
        PrescriptionSeance(
            jour=2, type_seance=TypeSeance.AMRAP, titre="AMRAP Force",
            description="Circuit AMRAP au temps prescrit — tempos stricts"
        ),
    ],
    4: [  # Jeudi
        PrescriptionSeance(
            jour=4, type_seance=TypeSeance.COURSE, titre="Intervalles Z4",
            zone_cible=ZoneCourse.Z4,
            description="Répétitions courtes à haute intensité, récupération Z1 entre les blocs"
        ),
    ],
    5: [  # Vendredi
        PrescriptionSeance(
            jour=5, type_seance=TypeSeance.EMOM, titre="EMOM Technique",
            description="EMOM basse intensité, focus technique et tempo"
        ),
    ],
}

SEANCES_DECHARGE: dict[int, list[PrescriptionSeance]] = {
    1: [
        PrescriptionSeance(
            jour=1, type_seance=TypeSeance.COURSE, titre="Sortie récupération Z1",
            zone_cible=ZoneCourse.Z1, duree_cible_min=25,
            description="Allure très légère, aucune pression de performance"
        ),
    ],
    3: [
        PrescriptionSeance(
            jour=3, type_seance=TypeSeance.DECHARGE, titre="Mobilité & Étirements",
            description="Yoga, étirements profonds, foam rolling — 45 min"
        ),
    ],
}

SEANCES_EVALUATION: dict[int, list[PrescriptionSeance]] = {
    1: [
        PrescriptionSeance(
            jour=1, type_seance=TypeSeance.EVALUATION, titre="Demi-Cooper — Test VMA",
            description=(
                "6 minutes à allure maximale soutenable sur piste ou parcours plat. "
                "VMA recalculée : distance (m) / 100. "
                "Tous les seuils Z1-Z5 sont mis à jour automatiquement."
            )
        ),
    ],
    3: [
        PrescriptionSeance(
            jour=3, type_seance=TypeSeance.EVALUATION, titre="Max Répétitions 1 Minute",
            description=(
                "7 mouvements testés séquentiellement avec 3 min de récupération entre chaque : "
                "Tractions, Dips, Pompes, Abdominaux, Squats, Pistol Squat Gauche, Pistol Squat Droit. "
                "Score = répétitions réalisées en 60 secondes."
            )
        ),
    ],
    5: [
        PrescriptionSeance(
            jour=5, type_seance=TypeSeance.EVALUATION, titre="AMRAP Benchmark 10 min",
            description=(
                "Circuit fixe EPC : 10 Tractions → 10 Pompes → 10 Squats → "
                "10 Dips → 10 Burpees → 10 Mountain Climbers. "
                "Score = tours totaux (ex. 2.9 = 2 tours + 9 reps dans le 3e)."
            )
        ),
    ],
}


# ---------------------------------------------------------------------------
# Circuits AMRAP et EMOM de référence
# ---------------------------------------------------------------------------

CIRCUIT_AMRAP_REFERENCE = [
    {"exercice_slug": "traction-stricte",     "repetitions": 10, "ordre": 1},
    {"exercice_slug": "pompe-standard",        "repetitions": 10, "ordre": 2},
    {"exercice_slug": "squat-bw",              "repetitions": 10, "ordre": 3},
    {"exercice_slug": "dip-parallettes",       "repetitions": 10, "ordre": 4},
    {"exercice_slug": "burpee",                "repetitions": 10, "ordre": 5},
    {"exercice_slug": "mountain-climber",      "repetitions": 10, "ordre": 6},
]

CIRCUIT_AMRAP_BENCHMARK = [
    {"exercice_slug": "traction-stricte",     "repetitions": 10, "ordre": 1},
    {"exercice_slug": "pompe-standard",        "repetitions": 10, "ordre": 2},
    {"exercice_slug": "squat-bw",              "repetitions": 10, "ordre": 3},
    {"exercice_slug": "dip-parallettes",       "repetitions": 10, "ordre": 4},
    {"exercice_slug": "burpee",                "repetitions": 10, "ordre": 5},
    {"exercice_slug": "mountain-climber",      "repetitions": 10, "ordre": 6},
]

MOUVEMENTS_EVALUATION_1MIN = [
    {"exercice_slug": "traction-stricte",      "ordre": 1, "nom_affichage": "Tractions"},
    {"exercice_slug": "dip-parallettes",       "ordre": 2, "nom_affichage": "Dips"},
    {"exercice_slug": "pompe-standard",        "ordre": 3, "nom_affichage": "Pompes"},
    {"exercice_slug": "abdominal-crunch",      "ordre": 4, "nom_affichage": "Abdominaux"},
    {"exercice_slug": "squat-bw",              "ordre": 5, "nom_affichage": "Squats"},
    {"exercice_slug": "pistol-squat-gauche",   "ordre": 6, "nom_affichage": "Pistol Squat Gauche"},
    {"exercice_slug": "pistol-squat-droit",    "ordre": 7, "nom_affichage": "Pistol Squat Droit"},
]


# ---------------------------------------------------------------------------
# Bibliothèque d'exercices par défaut (seed)
# ---------------------------------------------------------------------------

EXERCICES_DEFAUT = [
    # --- PULL ---
    {
        "nom": "Traction stricte", "slug": "traction-stricte",
        "categorie_musculaire": "pull", "niveau_progression": "intermediaire",
        "tempo": "X/1/2/0", "pause_isometrique_sec": 1.0,
        "muscles_principaux": "Grand dorsal, Biceps",
        "muscles_secondaires": "Rhomboïdes, Trapèzes inférieurs",
        "est_mouvement_evaluation": True,
    },
    {
        "nom": "Traction australienne", "slug": "traction-australienne",
        "categorie_musculaire": "pull", "niveau_progression": "debutant",
        "tempo": "X/1/2/0", "pause_isometrique_sec": None,
        "muscles_principaux": "Grand dorsal, Biceps",
        "est_mouvement_evaluation": False,
    },
    # --- PUSH ---
    {
        "nom": "Pompe standard", "slug": "pompe-standard",
        "categorie_musculaire": "push", "niveau_progression": "debutant",
        "tempo": "2/1/X/0", "pause_isometrique_sec": None,
        "muscles_principaux": "Pectoraux, Triceps, Deltoïdes antérieurs",
        "est_mouvement_evaluation": True,
    },
    {
        "nom": "Dip aux parallettes", "slug": "dip-parallettes",
        "categorie_musculaire": "push", "niveau_progression": "intermediaire",
        "tempo": "2/1/X/0", "pause_isometrique_sec": 1.0,
        "muscles_principaux": "Triceps, Pectoraux inférieurs",
        "est_mouvement_evaluation": True,
    },
    {
        "nom": "Pompe sur genoux", "slug": "pompe-genoux",
        "categorie_musculaire": "push", "niveau_progression": "debutant",
        "tempo": "2/0/X/0", "pause_isometrique_sec": None,
        "muscles_principaux": "Pectoraux, Triceps",
        "est_mouvement_evaluation": False,
    },
    # --- JAMBES ---
    {
        "nom": "Squat poids du corps", "slug": "squat-bw",
        "categorie_musculaire": "jambes", "niveau_progression": "debutant",
        "tempo": "3/1/X/0", "pause_isometrique_sec": None,
        "muscles_principaux": "Quadriceps, Fessiers, Ischio-jambiers",
        "est_mouvement_evaluation": True,
    },
    {
        "nom": "Pistol Squat Gauche", "slug": "pistol-squat-gauche",
        "categorie_musculaire": "jambes", "niveau_progression": "avance",
        "tempo": "3/1/X/0", "pause_isometrique_sec": None,
        "muscles_principaux": "Quadriceps, Fessiers (jambe gauche)",
        "est_mouvement_evaluation": True,
    },
    {
        "nom": "Pistol Squat Droit", "slug": "pistol-squat-droit",
        "categorie_musculaire": "jambes", "niveau_progression": "avance",
        "tempo": "3/1/X/0", "pause_isometrique_sec": None,
        "muscles_principaux": "Quadriceps, Fessiers (jambe droite)",
        "est_mouvement_evaluation": True,
    },
    # --- GAINAGE / CORPS ENTIER ---
    {
        "nom": "Abdominal crunch", "slug": "abdominal-crunch",
        "categorie_musculaire": "gainage", "niveau_progression": "debutant",
        "tempo": "2/0/2/0", "pause_isometrique_sec": None,
        "muscles_principaux": "Grand droit de l'abdomen",
        "est_mouvement_evaluation": True,
    },
    {
        "nom": "Burpee", "slug": "burpee",
        "categorie_musculaire": "corps_entier", "niveau_progression": "intermediaire",
        "tempo": "X/0/X/0", "pause_isometrique_sec": None,
        "muscles_principaux": "Corps entier, Cardio",
        "est_mouvement_evaluation": False,
    },
    {
        "nom": "Mountain Climber", "slug": "mountain-climber",
        "categorie_musculaire": "gainage", "niveau_progression": "debutant",
        "tempo": "X/0/X/0", "pause_isometrique_sec": None,
        "muscles_principaux": "Gainage antérieur, Fléchisseurs de hanche",
        "est_mouvement_evaluation": False,
    },
]


# ---------------------------------------------------------------------------
# Fonctions utilitaires
# ---------------------------------------------------------------------------

def obtenir_regle_semaine(numero: int) -> RegleSemaine:
    """Retourne la règle EPC pour le numéro de semaine donné (1-8)."""
    for regle in BLUEPRINT_MACROCYCLE:
        if regle.numero == numero:
            return regle
    raise ValueError(f"Numéro de semaine invalide : {numero}. Doit être entre 1 et 8.")


def generer_dates_semaines(date_debut: date) -> list[date]:
    """
    Génère les dates de début des 8 semaines du macrocycle
    à partir de la date de départ fournie.
    """
    return [date_debut + timedelta(weeks=i) for i in range(8)]


def calculer_volume_course(semaine: int, km_base: float = 15.0) -> float:
    """
    Calcule le kilométrage cible pour une semaine donnée
    en appliquant le multiplicateur de volume EPC.
    """
    regle = obtenir_regle_semaine(semaine)
    if regle.objectif_km_course is not None:
        return regle.objectif_km_course
    return round(km_base * regle.multiplicateur_volume, 1)


def calculer_duree_amrap(semaine: int) -> Optional[int]:
    """
    Retourne la durée AMRAP en minutes pour la semaine donnée.
    Retourne None pour la semaine d'évaluation (pas d'AMRAP standard).
    """
    regle = obtenir_regle_semaine(semaine)
    return regle.objectif_amrap_min


def est_semaine_decharge(semaine: int) -> bool:
    return obtenir_regle_semaine(semaine).macrophase == TypeMacrophase.DECHARGE


def est_semaine_evaluation(semaine: int) -> bool:
    return obtenir_regle_semaine(semaine).macrophase == TypeMacrophase.EVALUATION
