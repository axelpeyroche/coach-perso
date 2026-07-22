"""
Modèles SQLAlchemy ORM pour le Coach d'Entraînement Hybride EPC.

Schéma couvrant :
- Profils utilisateurs et biométrie (VMA, FCmax, historique)
- Bibliothèque d'exercices avec tempo et métadonnées de mouvement
- Structure Macrocycle / Semaine / Séance
- Journaux d'évaluation (Demi-Cooper, max 1 min, AMRAP 10 min)
- Journalisation des séances (performance, RPE, volume)
"""

from __future__ import annotations

import enum
from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


# ---------------------------------------------------------------------------
# Base
# ---------------------------------------------------------------------------

class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# Énumérations
# ---------------------------------------------------------------------------

class CategorieMusculaire(str, enum.Enum):
    PUSH = "push"
    PULL = "pull"
    JAMBES = "jambes"
    GAINAGE = "gainage"
    CORPS_ENTIER = "corps_entier"
    CARDIO = "cardio"


class ZoneCourse(str, enum.Enum):
    Z1 = "Z1"   # Récupération / Endurance fondamentale — 60-70% VMA
    Z2 = "Z2"   # Base aérobie                         — 70-80% VMA
    Z3 = "Z3"   # Tempo / Allure seuil bas             — 80-87% VMA
    Z4 = "Z4"   # Seuil anaérobie                      — 87-95% VMA
    Z5 = "Z5"   # VO2max / Sprint                      — 95-110% VMA


class TypeSeance(str, enum.Enum):
    EMOM = "EMOM"
    AMRAP = "AMRAP"
    COURSE = "COURSE"
    VELO = "VELO"
    EVALUATION = "EVALUATION"
    DECHARGE = "DECHARGE"
    REPOS = "REPOS"
    GYM_UPPER = "GYM_UPPER"
    GYM_LOWER = "GYM_LOWER"
    GYM_FULL  = "GYM_FULL"
    BLESSURE  = "BLESSURE"


class TypeMacrophase(str, enum.Enum):
    SURCHARGE = "surcharge"       # Semaines 1-5 : surcharge progressive
    DECHARGE = "decharge"         # Semaines 6-7 : décharge / récupération
    EVALUATION = "evaluation"     # Semaine 8   : tests et bilans


class NiveauProgression(str, enum.Enum):
    DEBUTANT = "debutant"
    INTERMEDIAIRE = "intermediaire"
    AVANCE = "avance"


# ---------------------------------------------------------------------------
# Utilisateurs
# ---------------------------------------------------------------------------

class Utilisateur(Base):
    __tablename__ = "utilisateurs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255))
    prenom: Mapped[Optional[str]] = mapped_column(String(120))
    nom: Mapped[str] = mapped_column(String(120), nullable=False)
    sexe: Mapped[Optional[str]] = mapped_column(String(10))  # "homme" | "femme" | "autre"
    date_naissance: Mapped[Optional[date]] = mapped_column(Date)
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    onboarding_complet: Mapped[bool] = mapped_column(Boolean, default=False)

    # Préférences programme
    type_programme: Mapped[Optional[str]] = mapped_column(String(20))    # "course" | "muscu" | "hybride"
    seances_semaine: Mapped[Optional[int]] = mapped_column(Integer)
    seances_course_semaine: Mapped[Optional[int]] = mapped_column(Integer)
    seances_muscu_semaine: Mapped[Optional[int]] = mapped_column(Integer)
    seances_velo_semaine: Mapped[Optional[int]] = mapped_column(Integer)
    frequence_tests_semaines: Mapped[Optional[int]] = mapped_column(Integer, default=8)
    type_course: Mapped[Optional[str]] = mapped_column(String(20))       # "route" | "trail" | "route_trail"
    type_muscu: Mapped[Optional[str]] = mapped_column(String(20))        # "poids_corps" | "salle"

    # Objectifs
    objectif_type: Mapped[Optional[str]] = mapped_column(String(20))     # "course" | "muscu" | "aucun"
    historique_perf: Mapped[Optional[str]] = mapped_column(Text)          # JSON serialisé

    # Mode de génération du programme : True = programme auto-généré,
    # False = l'utilisateur crée lui-même ses séances (mode manuel)
    programme_auto: Mapped[bool] = mapped_column(Boolean, default=True)

    # Token d'import (iOS Shortcuts)
    import_token: Mapped[Optional[str]] = mapped_column(String(64))

    # Physiologie
    fc_max: Mapped[Optional[int]] = mapped_column(Integer, comment="FC max mesurée (bpm)")
    fc_repos: Mapped[Optional[int]] = mapped_column(Integer, comment="FC de repos (bpm)")
    poids_kg: Mapped[Optional[float]] = mapped_column(Float, comment="Poids corporel (kg)")

    # Relations
    biometries: Mapped[list["BiometrieUtilisateur"]] = relationship(
        back_populates="utilisateur",
        cascade="all, delete-orphan",
        order_by="BiometrieUtilisateur.enregistre_le",
    )
    macrocycles: Mapped[list["Macrocycle"]] = relationship(
        back_populates="utilisateur", cascade="all, delete-orphan"
    )
    journaux_seances: Mapped[list["JournalSeance"]] = relationship(
        back_populates="utilisateur", cascade="all, delete-orphan"
    )
    journaux_evaluation: Mapped[list["JournalEvaluationSeance"]] = relationship(
        back_populates="utilisateur", cascade="all, delete-orphan"
    )

    @property
    def derniere_biometrie(self) -> Optional["BiometrieUtilisateur"]:
        return self.biometries[-1] if self.biometries else None


# ---------------------------------------------------------------------------
# Historique de poids
# ---------------------------------------------------------------------------

class PoidsUtilisateur(Base):
    """Un relevé de poids horodaté — un point sur la courbe d'évolution."""
    __tablename__ = "poids_utilisateurs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    poids_kg: Mapped[float] = mapped_column(Float, nullable=False)
    enregistre_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ---------------------------------------------------------------------------
# Biométrie — historique VMA et zones FC
# ---------------------------------------------------------------------------

class BiometrieUtilisateur(Base):
    """
    Instantané des marqueurs physiologiques d'un utilisateur à un instant donné.
    Chaque test Demi-Cooper produit une nouvelle ligne ; les lignes historiques
    sont conservées pour l'endpoint analytique des tendances physiologiques.

    VMA (Vitesse Maximale Aérobie) exprimée en km/h.
    Les zones Z1-Z5 sont calculées à l'écriture via la méthode de classe
    `depuis_demi_cooper` afin de simplifier les requêtes analytiques.
    """
    __tablename__ = "biometries_utilisateurs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    enregistre_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    # Marqueurs physiologiques principaux
    vma_kmh: Mapped[float] = mapped_column(
        Float, nullable=False,
        comment="VMA en km/h. Formule : distance_metres / 100 (test Demi-Cooper 6 min)"
    )
    fc_max: Mapped[Optional[int]] = mapped_column(
        Integer,
        comment="Fréquence cardiaque maximale en bpm (mesurée ou estimée 220-âge)"
    )
    poids_kg: Mapped[Optional[float]] = mapped_column(Float)
    taux_masse_grasse_pct: Mapped[Optional[float]] = mapped_column(Float)

    # Seuils de vitesse Z1-Z5 pré-calculés (km/h) — stockés pour requêtes rapides
    z1_min_kmh: Mapped[float] = mapped_column(Float, nullable=False)
    z1_max_kmh: Mapped[float] = mapped_column(Float, nullable=False)
    z2_min_kmh: Mapped[float] = mapped_column(Float, nullable=False)
    z2_max_kmh: Mapped[float] = mapped_column(Float, nullable=False)
    z3_min_kmh: Mapped[float] = mapped_column(Float, nullable=False)
    z3_max_kmh: Mapped[float] = mapped_column(Float, nullable=False)
    z4_min_kmh: Mapped[float] = mapped_column(Float, nullable=False)
    z4_max_kmh: Mapped[float] = mapped_column(Float, nullable=False)
    z5_min_kmh: Mapped[float] = mapped_column(Float, nullable=False)
    z5_max_kmh: Mapped[float] = mapped_column(Float, nullable=False)

    # Cibles FC par zone (bpm) — optionnel si FCmax connue
    z1_fc_min: Mapped[Optional[int]] = mapped_column(Integer)
    z1_fc_max: Mapped[Optional[int]] = mapped_column(Integer)
    z2_fc_min: Mapped[Optional[int]] = mapped_column(Integer)
    z2_fc_max: Mapped[Optional[int]] = mapped_column(Integer)
    z3_fc_min: Mapped[Optional[int]] = mapped_column(Integer)
    z3_fc_max: Mapped[Optional[int]] = mapped_column(Integer)
    z4_fc_min: Mapped[Optional[int]] = mapped_column(Integer)
    z4_fc_max: Mapped[Optional[int]] = mapped_column(Integer)
    z5_fc_min: Mapped[Optional[int]] = mapped_column(Integer)
    z5_fc_max: Mapped[Optional[int]] = mapped_column(Integer)

    utilisateur: Mapped["Utilisateur"] = relationship(back_populates="biometries")

    # Bornes de zones en % VMA selon la méthodologie EPC
    BORNES_ZONES_VMA: dict[ZoneCourse, tuple[float, float]] = {
        ZoneCourse.Z1: (0.60, 0.70),
        ZoneCourse.Z2: (0.70, 0.80),
        ZoneCourse.Z3: (0.80, 0.87),
        ZoneCourse.Z4: (0.87, 0.95),
        ZoneCourse.Z5: (0.95, 1.10),
    }
    # Bornes FC en % FCmax
    BORNES_ZONES_FC: dict[ZoneCourse, tuple[float, float]] = {
        ZoneCourse.Z1: (0.55, 0.65),
        ZoneCourse.Z2: (0.65, 0.75),
        ZoneCourse.Z3: (0.75, 0.82),
        ZoneCourse.Z4: (0.82, 0.89),
        ZoneCourse.Z5: (0.89, 1.00),
    }

    @classmethod
    def depuis_demi_cooper(
        cls,
        utilisateur_id: int,
        distance_metres: float,
        fc_max: Optional[int] = None,
        **kwargs,
    ) -> "BiometrieUtilisateur":
        """
        Méthode fabrique principale — applique la formule EPC :
            VMA (km/h) = distance_metres / 100
        Puis dérive immédiatement tous les seuils de zones.
        """
        vma = distance_metres / 100.0

        def zone_vitesse(z: ZoneCourse) -> tuple[float, float]:
            bas, haut = cls.BORNES_ZONES_VMA[z]
            return round(vma * bas, 2), round(vma * haut, 2)

        def zone_fc(z: ZoneCourse) -> tuple[Optional[int], Optional[int]]:
            if fc_max is None:
                return None, None
            bas, haut = cls.BORNES_ZONES_FC[z]
            return round(fc_max * bas), round(fc_max * haut)

        vitesses = {z: zone_vitesse(z) for z in ZoneCourse}
        fcs = {z: zone_fc(z) for z in ZoneCourse}

        return cls(
            utilisateur_id=utilisateur_id,
            vma_kmh=vma,
            fc_max=fc_max,
            z1_min_kmh=vitesses[ZoneCourse.Z1][0],
            z1_max_kmh=vitesses[ZoneCourse.Z1][1],
            z2_min_kmh=vitesses[ZoneCourse.Z2][0],
            z2_max_kmh=vitesses[ZoneCourse.Z2][1],
            z3_min_kmh=vitesses[ZoneCourse.Z3][0],
            z3_max_kmh=vitesses[ZoneCourse.Z3][1],
            z4_min_kmh=vitesses[ZoneCourse.Z4][0],
            z4_max_kmh=vitesses[ZoneCourse.Z4][1],
            z5_min_kmh=vitesses[ZoneCourse.Z5][0],
            z5_max_kmh=vitesses[ZoneCourse.Z5][1],
            z1_fc_min=fcs[ZoneCourse.Z1][0],
            z1_fc_max=fcs[ZoneCourse.Z1][1],
            z2_fc_min=fcs[ZoneCourse.Z2][0],
            z2_fc_max=fcs[ZoneCourse.Z2][1],
            z3_fc_min=fcs[ZoneCourse.Z3][0],
            z3_fc_max=fcs[ZoneCourse.Z3][1],
            z4_fc_min=fcs[ZoneCourse.Z4][0],
            z4_fc_max=fcs[ZoneCourse.Z4][1],
            z5_fc_min=fcs[ZoneCourse.Z5][0],
            z5_fc_max=fcs[ZoneCourse.Z5][1],
            **kwargs,
        )


# ---------------------------------------------------------------------------
# Bibliothèque d'exercices
# ---------------------------------------------------------------------------

class VariationExercice(Base):
    """
    Bibliothèque maîtresse des exercices avec métadonnées d'exécution EPC.

    Notation tempo (convention EPC) :
        4 chiffres — Excentrique / Pause-basse / Concentrique / Pause-haute
        'X'        — Explosif (aussi vite que possible)
        Exemple :  PUSH → '2/1/X/0'  (2s descente, 1s pause, explosif, pas de pause)
                   PULL → 'X/1/2/0'  (tirage explosif, 1s pause, 2s retour, pas de pause)

    La pause isométrique est stockée séparément pour la lisibilité et l'efficacité des requêtes.
    """
    __tablename__ = "variations_exercices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    nom: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(
        String(120), unique=True, nullable=False,
        comment="Identifiant URL-safe, ex. 'traction-stricte'"
    )
    categorie_musculaire: Mapped[CategorieMusculaire] = mapped_column(
        Enum(CategorieMusculaire), nullable=False
    )
    niveau_progression: Mapped[NiveauProgression] = mapped_column(
        Enum(NiveauProgression), nullable=False, default=NiveauProgression.DEBUTANT
    )

    # Prescription de tempo
    tempo: Mapped[Optional[str]] = mapped_column(
        String(20),
        comment="Notation tempo EPC, ex. '2/1/X/0' ou 'X/1/2/0'"
    )
    pause_isometrique_sec: Mapped[Optional[float]] = mapped_column(
        Float,
        comment="Maintien isométrique supplémentaire en secondes au pic de contraction (ex. 1.0)"
    )

    # Taxonomie et substitution
    muscles_principaux: Mapped[Optional[str]] = mapped_column(
        String(255), comment="Groupes musculaires principaux (séparés par virgule)"
    )
    muscles_secondaires: Mapped[Optional[str]] = mapped_column(String(255))
    materiel: Mapped[Optional[str]] = mapped_column(String(120))
    id_regression: Mapped[Optional[int]] = mapped_column(
        ForeignKey("variations_exercices.id"),
        comment="Alternative plus facile pour la mise à l'échelle automatique"
    )
    id_progression: Mapped[Optional[int]] = mapped_column(
        ForeignKey("variations_exercices.id"),
        comment="Alternative plus difficile pour la mise à l'échelle automatique"
    )
    description: Mapped[Optional[str]] = mapped_column(Text)
    est_mouvement_evaluation: Mapped[bool] = mapped_column(
        Boolean, default=False,
        comment="Vrai pour les 7 mouvements testés dans le protocole max 1 minute"
    )

    regression: Mapped[Optional["VariationExercice"]] = relationship(
        foreign_keys=[id_regression], remote_side="VariationExercice.id"
    )
    progression: Mapped[Optional["VariationExercice"]] = relationship(
        foreign_keys=[id_progression], remote_side="VariationExercice.id"
    )
    exercices_seance: Mapped[list["ExerciceSeance"]] = relationship(
        back_populates="exercice"
    )
    resultats_max_1min: Mapped[list["ResultatMax1Min"]] = relationship(
        back_populates="exercice"
    )

    __table_args__ = (UniqueConstraint("slug"),)


# ---------------------------------------------------------------------------
# Structure de périodisation — Macrocycle → Semaine → Séance
# ---------------------------------------------------------------------------

class Macrocycle(Base):
    """
    Un bloc EPC de 8 semaines par utilisateur.
    Plusieurs macrocycles successifs permettent de suivre la progression long terme.
    """
    __tablename__ = "macrocycles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    numero_cycle: Mapped[int] = mapped_column(
        Integer, nullable=False, comment="Index séquentiel, commence à 1"
    )
    date_debut: Mapped[date] = mapped_column(Date, nullable=False)
    date_fin: Mapped[date] = mapped_column(Date, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text)

    utilisateur: Mapped["Utilisateur"] = relationship(back_populates="macrocycles")
    semaines: Mapped[list["SemaineEntrainement"]] = relationship(
        back_populates="macrocycle",
        cascade="all, delete-orphan",
        order_by="SemaineEntrainement.numero_semaine",
    )

    __table_args__ = (UniqueConstraint("utilisateur_id", "numero_cycle"),)


class SemaineEntrainement(Base):
    """
    L'une des 8 semaines d'un macrocycle.
    Porte le type de macrophase et le multiplicateur de volume prescrit afin que
    les règles de périodisation s'appliquent sans coder les numéros de semaine en dur.
    """
    __tablename__ = "semaines_entrainement"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    macrocycle_id: Mapped[int] = mapped_column(ForeignKey("macrocycles.id"), nullable=False)
    numero_semaine: Mapped[int] = mapped_column(
        Integer, nullable=False, comment="Semaine dans le macrocycle, indexée à 1"
    )
    macrophase: Mapped[TypeMacrophase] = mapped_column(Enum(TypeMacrophase), nullable=False)
    date_debut: Mapped[date] = mapped_column(Date, nullable=False)

    # Métadonnées de prescription de volume
    multiplicateur_volume: Mapped[float] = mapped_column(
        Float, default=1.0,
        comment="Volume relatif par rapport à la base. Décharge : 0.60-0.70, surcharge : 1.0-1.3"
    )
    objectif_km_course: Mapped[Optional[float]] = mapped_column(Float)
    objectif_amrap_min: Mapped[Optional[int]] = mapped_column(
        Integer,
        comment="Durée AMRAP en minutes (progresse de 20 à 33 min sur les semaines de surcharge)"
    )

    macrocycle: Mapped["Macrocycle"] = relationship(back_populates="semaines")
    seances: Mapped[list["SeanceEntrainement"]] = relationship(
        back_populates="semaine", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("macrocycle_id", "numero_semaine"),
        CheckConstraint("numero_semaine >= 1", name="ck_numero_semaine_positif"),
        CheckConstraint("multiplicateur_volume > 0", name="ck_multiplicateur_volume_positif"),
    )


class SeanceEntrainement(Base):
    """
    Une séance d'entraînement planifiée dans une semaine.
    Peut être une course, un EMOM, un AMRAP, une évaluation, une décharge ou un repos.
    """
    __tablename__ = "seances_entrainement"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    semaine_id: Mapped[int] = mapped_column(ForeignKey("semaines_entrainement.id"), nullable=False)
    date_seance: Mapped[date] = mapped_column(Date, nullable=False)
    type_seance: Mapped[TypeSeance] = mapped_column(Enum(TypeSeance), nullable=False)
    titre: Mapped[Optional[str]] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text)
    ordre_dans_semaine: Mapped[int] = mapped_column(
        Integer, default=1, comment="Ordre du jour dans la semaine (1-7)"
    )

    # Champs spécifiques à la course
    zone_cible: Mapped[Optional[ZoneCourse]] = mapped_column(Enum(ZoneCourse))
    distance_cible_km: Mapped[Optional[float]] = mapped_column(Float)
    duree_cible_min: Mapped[Optional[int]] = mapped_column(Integer)
    dplus_cible_m: Mapped[Optional[int]] = mapped_column(
        Integer, comment="Dénivelé positif cumulé cible en mètres"
    )

    # Champs spécifiques à la musculation
    temps_limite_min: Mapped[Optional[int]] = mapped_column(
        Integer, comment="Durée limite EMOM ou AMRAP en minutes"
    )

    # Planification libre (date choisie par l'utilisateur, indépendante de date_seance)
    date_planifiee: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    heure_planifiee: Mapped[Optional[str]] = mapped_column(String(5), nullable=True)

    semaine: Mapped["SemaineEntrainement"] = relationship(back_populates="seances")
    exercices: Mapped[list["ExerciceSeance"]] = relationship(
        back_populates="seance",
        cascade="all, delete-orphan",
        order_by="ExerciceSeance.ordre",
    )
    journal: Mapped[Optional["JournalSeance"]] = relationship(
        back_populates="seance", uselist=False
    )


class ExerciceSeance(Base):
    """
    Un exercice planifié dans une SeanceEntrainement, avec la spécification
    d'exécution complète EPC : séries, répétitions (ou durée), tempo, récupération
    et zone pour les intervalles de course.

    EMOM : chaque ligne correspond à un exercice dans la prescription minute par minute.
    AMRAP : chaque ligne correspond à un mouvement du circuit.
    """
    __tablename__ = "exercices_seance"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    seance_id: Mapped[int] = mapped_column(ForeignKey("seances_entrainement.id"), nullable=False)
    exercice_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("variations_exercices.id"), nullable=True
    )
    nom_affichage: Mapped[Optional[str]] = mapped_column(
        String(200), comment="Nom libre pour les exercices sans slug (machines salle, etc.)"
    )
    ordre: Mapped[int] = mapped_column(
        Integer, nullable=False, comment="Position dans la séance (indexée à 1)"
    )

    # Prescription
    series: Mapped[Optional[int]] = mapped_column(Integer)
    repetitions: Mapped[Optional[int]] = mapped_column(Integer)
    duree_sec: Mapped[Optional[int]] = mapped_column(
        Integer, comment="Alternative aux répétitions pour les séries chronométrées"
    )
    recuperation_sec: Mapped[Optional[int]] = mapped_column(Integer)

    # Modulation de l'intensité (leviers EPC — remplace l'ajout de charge pour les athlètes au poids du corps)
    duree_bloc_min: Mapped[Optional[int]] = mapped_column(
        Integer,
        comment="Durée du bloc EMOM en minutes pour cet exercice (ex. 9 pour un bloc de 9 min)"
    )
    tempo_override: Mapped[Optional[str]] = mapped_column(
        String(20),
        comment="Tempo spécifique à la séance, remplace le tempo par défaut de l'exercice, ex. '3/2/X/0'"
    )
    pause_isometrique_override_sec: Mapped[Optional[float]] = mapped_column(Float)
    zone_cible: Mapped[Optional[ZoneCourse]] = mapped_column(
        Enum(ZoneCourse),
        comment="Pour les intervalles de course intégrés dans un circuit"
    )
    notes: Mapped[Optional[str]] = mapped_column(String(500))

    seance: Mapped["SeanceEntrainement"] = relationship(back_populates="exercices")
    exercice: Mapped["VariationExercice"] = relationship(back_populates="exercices_seance")

    @property
    def tempo_effectif(self) -> Optional[str]:
        """Résout le tempo de séance en priorité, sinon utilise le tempo de la bibliothèque."""
        return self.tempo_override or (self.exercice.tempo if self.exercice else None)

    @property
    def pause_isometrique_effective(self) -> Optional[float]:
        """Résout la pause isométrique de séance en priorité, sinon celle de l'exercice."""
        return (
            self.pause_isometrique_override_sec
            or (self.exercice.pause_isometrique_sec if self.exercice else None)
        )


# ---------------------------------------------------------------------------
# Journalisation des séances — performance réelle vs planifiée
# ---------------------------------------------------------------------------

class JournalSeance(Base):
    """
    Performance enregistrée par l'athlète pour une SeanceEntrainement complétée.
    Utilisée par le calcul ACWA et les analyses de tendance RPE.
    """
    __tablename__ = "journaux_seances"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    seance_id: Mapped[int] = mapped_column(
        ForeignKey("seances_entrainement.id"), unique=True, nullable=False
    )
    enregistre_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    completee: Mapped[bool] = mapped_column(Boolean, default=True)

    # Charge subjective
    rpe: Mapped[Optional[float]] = mapped_column(
        Float, comment="Effort perçu, échelle de Borg CR10 de 1 à 10"
    )
    rpe_cible: Mapped[Optional[float]] = mapped_column(Float)

    # Réels course
    type_course: Mapped[Optional[str]] = mapped_column(String(20))  # "route" | "trail"
    distance_reelle_km: Mapped[Optional[float]] = mapped_column(Float)
    distance_repos_km: Mapped[Optional[float]] = mapped_column(Float)
    duree_reelle_min: Mapped[Optional[int]] = mapped_column(Integer)
    dplus_reel_m: Mapped[Optional[int]] = mapped_column(Integer)
    fc_moyenne_bpm: Mapped[Optional[int]] = mapped_column(Integer)
    fc_max_bpm: Mapped[Optional[int]] = mapped_column(Integer)

    # Réels musculation
    tours_amrap_completes: Mapped[Optional[float]] = mapped_column(
        Float,
        comment="Tours complétés (partiel en décimal, ex. 2.9 = 2 tours + 9 reps dans le 3e)"
    )
    total_reps_enregistrees: Mapped[Optional[int]] = mapped_column(Integer)

    notes: Mapped[Optional[str]] = mapped_column(Text)
    details_intervalles: Mapped[Optional[str]] = mapped_column(
        Text, comment="JSON — liste de blocs {distance_km, fc_moyenne_bpm, vitesse_kmh} pour séances seuil/fractionné"
    )

    utilisateur: Mapped["Utilisateur"] = relationship(back_populates="journaux_seances")
    seance: Mapped["SeanceEntrainement"] = relationship(back_populates="journal")
    journaux_exercices: Mapped[list["JournalExercice"]] = relationship(
        back_populates="journal_seance", cascade="all, delete-orphan"
    )


class JournalExercice(Base):
    """Performance réelle par exercice dans une séance journalisée."""
    __tablename__ = "journaux_exercices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    journal_seance_id: Mapped[int] = mapped_column(ForeignKey("journaux_seances.id"), nullable=False)
    exercice_seance_id: Mapped[int] = mapped_column(
        ForeignKey("exercices_seance.id"), nullable=False
    )
    numero_serie: Mapped[int] = mapped_column(Integer, default=1)
    reps_realisees: Mapped[Optional[int]] = mapped_column(Integer)
    duree_realisee_sec: Mapped[Optional[int]] = mapped_column(Integer)
    rpe_serie: Mapped[Optional[float]] = mapped_column(Float)
    notes: Mapped[Optional[str]] = mapped_column(String(500))

    journal_seance: Mapped["JournalSeance"] = relationship(back_populates="journaux_exercices")
    exercice_seance: Mapped["ExerciceSeance"] = relationship()


# ---------------------------------------------------------------------------
# Journalisation des évaluations — Tests d'induction et Semaine 8
# ---------------------------------------------------------------------------

class JournalEvaluationSeance(Base):
    """
    Enregistrement maître regroupant tous les résultats d'une session d'évaluation
    (typiquement la semaine 8 d'un macrocycle ou l'induction initiale).
    """
    __tablename__ = "journaux_evaluation_seance"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    macrocycle_id: Mapped[Optional[int]] = mapped_column(ForeignKey("macrocycles.id"))
    evalue_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    est_induction: Mapped[bool] = mapped_column(
        Boolean, default=False,
        comment="Vrai pour la toute première évaluation avant le début d'un bloc"
    )
    notes: Mapped[Optional[str]] = mapped_column(Text)

    utilisateur: Mapped["Utilisateur"] = relationship(back_populates="journaux_evaluation")
    macrocycle: Mapped[Optional["Macrocycle"]] = relationship()
    demi_cooper: Mapped[Optional["ResultatDemiCooper"]] = relationship(
        back_populates="evaluation", uselist=False, cascade="all, delete-orphan"
    )
    resultats_max_1min: Mapped[list["ResultatMax1Min"]] = relationship(
        back_populates="evaluation", cascade="all, delete-orphan"
    )
    benchmark_amrap: Mapped[Optional["ResultatAMRAPBenchmark"]] = relationship(
        back_populates="evaluation", uselist=False, cascade="all, delete-orphan"
    )


class ResultatDemiCooper(Base):
    """
    Résultats du test de course Demi-Cooper (6 minutes).
    Déclenche le recalcul automatique de la VMA et de tous les seuils de zones
    via BiometrieUtilisateur.depuis_demi_cooper().
    """
    __tablename__ = "resultats_demi_cooper"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    evaluation_id: Mapped[int] = mapped_column(
        ForeignKey("journaux_evaluation_seance.id"), unique=True, nullable=False
    )
    distance_metres: Mapped[float] = mapped_column(Float, nullable=False)
    # Valeur dérivée — stockée ici pour la traçabilité, la valeur canonique est dans BiometrieUtilisateur
    vma_calculee_kmh: Mapped[float] = mapped_column(
        Float, nullable=False,
        comment="VMA = distance_metres / 100"
    )
    conditions: Mapped[Optional[str]] = mapped_column(
        String(255), comment="Surface, météo, etc."
    )
    id_biometrie_instantanee: Mapped[Optional[int]] = mapped_column(
        ForeignKey("biometries_utilisateurs.id"),
        comment="Pointe vers la ligne BiometrieUtilisateur créée depuis ce résultat"
    )

    evaluation: Mapped["JournalEvaluationSeance"] = relationship(back_populates="demi_cooper")
    biometrie_instantanee: Mapped[Optional["BiometrieUtilisateur"]] = relationship()

    @staticmethod
    def calculer_vma(distance_metres: float) -> float:
        """Formule EPC : VMA (km/h) = distance en mètres / 100."""
        return distance_metres / 100.0


class ResultatMax1Min(Base):
    """
    Une ligne par exercice par session d'évaluation pour le test Max Répétitions 1 Minute.
    Couvre : Tractions, Dips, Pompes, Abdominaux, Squats, Pistol Squat G, Pistol Squat D.
    """
    __tablename__ = "resultats_max_1min"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    evaluation_id: Mapped[int] = mapped_column(
        ForeignKey("journaux_evaluation_seance.id"), nullable=False
    )
    exercice_id: Mapped[int] = mapped_column(
        ForeignKey("variations_exercices.id"), nullable=False
    )
    repetitions_realisees: Mapped[int] = mapped_column(Integer, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(String(255))

    evaluation: Mapped["JournalEvaluationSeance"] = relationship(
        back_populates="resultats_max_1min"
    )
    exercice: Mapped["VariationExercice"] = relationship(back_populates="resultats_max_1min")

    __table_args__ = (
        UniqueConstraint(
            "evaluation_id", "exercice_id",
            name="uq_max_1min_par_exercice_par_evaluation"
        ),
    )


class ResultatAMRAPBenchmark(Base):
    """
    Résultat du circuit AMRAP fixe de 10 minutes :
        10 Tractions → 10 Pompes → 10 Squats → 10 Dips → 10 Burpees → 10 Mountain Climbers

    Le score est exprimé en tours totaux (décimal pour les tours partiels, ex. 2.9).
    Permet de suivre le conditionnement métabolique entre les macrocycles.
    """
    __tablename__ = "resultats_amrap_benchmark"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    evaluation_id: Mapped[int] = mapped_column(
        ForeignKey("journaux_evaluation_seance.id"), unique=True, nullable=False
    )
    temps_limite_min: Mapped[int] = mapped_column(
        Integer, default=10, comment="Toujours 10 pour le benchmark EPC standard"
    )
    tours_completes: Mapped[float] = mapped_column(
        Float, nullable=False,
        comment="Tours complets + partiel, ex. 2.9 = 2 tours complets + 9 reps dans le 3e tour"
    )
    # Détail du tour partiel pour analyse approfondie
    total_reps: Mapped[Optional[int]] = mapped_column(
        Integer, comment="Total de répétitions individuelles tous mouvements confondus"
    )
    tractions_dernier_partiel: Mapped[Optional[int]] = mapped_column(Integer)
    pompes_dernier_partiel: Mapped[Optional[int]] = mapped_column(Integer)
    squats_dernier_partiel: Mapped[Optional[int]] = mapped_column(Integer)
    dips_dernier_partiel: Mapped[Optional[int]] = mapped_column(Integer)
    burpees_dernier_partiel: Mapped[Optional[int]] = mapped_column(Integer)
    mountain_climbers_dernier_partiel: Mapped[Optional[int]] = mapped_column(Integer)
    fc_moyenne_bpm: Mapped[Optional[int]] = mapped_column(Integer)
    fc_max_bpm: Mapped[Optional[int]] = mapped_column(Integer)
    notes: Mapped[Optional[str]] = mapped_column(Text)

    evaluation: Mapped["JournalEvaluationSeance"] = relationship(
        back_populates="benchmark_amrap"
    )


# ---------------------------------------------------------------------------
# Objectif course — race goal pour ajuster les séances de course
# ---------------------------------------------------------------------------

class ObjectifCourse(Base):
    """
    Prochain objectif de course de l'utilisateur.
    Une seule ligne active par utilisateur (remplacée à chaque POST).
    Utilisée pour ajuster les allures cibles dans les séances de course.
    """
    __tablename__ = "objectifs_course"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    nom: Mapped[str] = mapped_column(String(200), nullable=False)
    date_course: Mapped[date] = mapped_column(Date, nullable=False)
    distance_km: Mapped[float] = mapped_column(Float, nullable=False)
    dplus_m: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    objectif_temps_min: Mapped[int] = mapped_column(Integer, nullable=False, comment="Objectif en minutes")
    notes: Mapped[Optional[str]] = mapped_column(Text)
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ---------------------------------------------------------------------------
# Push notifications
# ---------------------------------------------------------------------------

class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    p256dh: Mapped[str] = mapped_column(Text, nullable=False)
    auth: Mapped[str] = mapped_column(Text, nullable=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
