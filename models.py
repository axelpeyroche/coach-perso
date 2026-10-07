"""
Modèles SQLAlchemy ORM du carnet de suivi multi-sport.

Les tables de l'ancien programme EPC (macrocycles, séances, journaux,
évaluations, push, chat…) restent en base mais ne sont plus mappées.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# Utilisateur
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

    # Colonnes héritées de l'ancien programme EPC (conservées, non utilisées)
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

    # Token du lien d'analyse en lecture seule (export pour Claude)
    analyse_token: Mapped[Optional[str]] = mapped_column(String(64))

    # Token Claude : lecture du carnet + écriture du plan (script outils/carnet.py)
    claude_token: Mapped[Optional[str]] = mapped_column(String(64))

    # Séances détectées automatiquement puis supprimées (JSON : débuts ISO),
    # pour ne pas les recréer au prochain envoi du raccourci
    seances_ignorees: Mapped[Optional[str]] = mapped_column(Text)

    # Ancienne connexion Strava OAuth (conservée, non utilisée)
    strava_athlete_id: Mapped[Optional[int]] = mapped_column(Integer)
    strava_access_token: Mapped[Optional[str]] = mapped_column(String(255))
    strava_refresh_token: Mapped[Optional[str]] = mapped_column(String(255))
    strava_expires_at: Mapped[Optional[int]] = mapped_column(Integer, comment="Epoch (s) d'expiration de l'access token")
    strava_derniere_synchro: Mapped[Optional[datetime]] = mapped_column(DateTime)

    # Physiologie
    fc_max: Mapped[Optional[int]] = mapped_column(Integer, comment="FC max mesurée (bpm)")
    fc_repos: Mapped[Optional[int]] = mapped_column(Integer, comment="FC de repos (bpm)")
    poids_kg: Mapped[Optional[float]] = mapped_column(Float, comment="Poids corporel (kg)")

    # Photo de profil (data URL base64, cf. absence de stockage objet dédié)
    photo_url: Mapped[Optional[str]] = mapped_column(Text)

    # Fuseau horaire IANA (ex. "Europe/Paris"), détecté par le navigateur —
    # sert à convertir les dates UTC des imports (export Strava).
    fuseau_horaire: Mapped[Optional[str]] = mapped_column(String(50))


# ---------------------------------------------------------------------------
# Historique de poids
# ---------------------------------------------------------------------------

class PoidsUtilisateur(Base):
    """Un relevé de poids horodaté — un point sur la courbe d'évolution."""
    __tablename__ = "poids_utilisateurs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False, index=True)
    poids_kg: Mapped[float] = mapped_column(Float, nullable=False)
    enregistre_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ---------------------------------------------------------------------------
# Mesures de forme quotidiennes (Apple Santé)
# ---------------------------------------------------------------------------

class MesureSante(Base):
    """Une valeur journalière : FC au repos, VFC (SDNN) ou VO2max."""
    __tablename__ = "mesures_sante"
    __table_args__ = (
        UniqueConstraint("utilisateur_id", "type", "jour", name="uq_mesure_sante_jour"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False)  # fc_repos | vfc | vo2max
    jour: Mapped[date] = mapped_column(Date, nullable=False)
    valeur: Mapped[float] = mapped_column(Float, nullable=False)


class EchantillonSante(Base):
    """
    Échantillon brut reçu du raccourci iOS (FC, énergie, distance, minutes d'exercice…),
    gardé quelques semaines pour que plusieurs raccourcis puissent envoyer chacun
    une partie des données, dans n'importe quel ordre.
    """
    __tablename__ = "echantillons_sante"
    __table_args__ = (
        UniqueConstraint("utilisateur_id", "type", "horodatage", name="uq_echantillon_sante"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    horodatage: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    valeur: Mapped[float] = mapped_column(Float, nullable=False)


# ---------------------------------------------------------------------------
# Ancien objectif course (migré vers Objectif au besoin)
# ---------------------------------------------------------------------------

class ObjectifCourse(Base):
    """
    Prochain objectif de course de l'utilisateur.
    Une seule ligne active par utilisateur (remplacée à chaque POST).
    Utilisée pour ajuster les allures cibles dans les séances de course.
    """
    __tablename__ = "objectifs_course"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False, index=True)
    nom: Mapped[str] = mapped_column(String(200), nullable=False)
    date_course: Mapped[date] = mapped_column(Date, nullable=False)
    distance_km: Mapped[float] = mapped_column(Float, nullable=False)
    dplus_m: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    objectif_temps_min: Mapped[int] = mapped_column(Integer, nullable=False, comment="Objectif en minutes")
    notes: Mapped[Optional[str]] = mapped_column(Text)
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ---------------------------------------------------------------------------
# Carnet — activités réalisées et objectifs
# ---------------------------------------------------------------------------

class Activite(Base):
    """
    Une activité sportive réellement effectuée — cœur du carnet.

    Provient d'une saisie manuelle, d'Apple Santé (raccourci iOS) ou d'un
    fichier importé (export Strava, CSV générique).
    `id_externe` permet de dédoublonner les imports répétés d'une même source.
    """
    __tablename__ = "activites"
    __table_args__ = (
        UniqueConstraint("utilisateur_id", "source", "id_externe", name="uq_activite_source_externe"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="manuel")  # manuel | strava | apple_sante | fichier | programme
    id_externe: Mapped[Optional[str]] = mapped_column(String(100))
    sport: Mapped[str] = mapped_column(String(30), nullable=False)  # course | trail | velo | marche | randonnee | natation | muscu | hiit | yoga | autre
    titre: Mapped[Optional[str]] = mapped_column(String(200))
    debut: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    duree_sec: Mapped[Optional[int]] = mapped_column(Integer)
    distance_km: Mapped[Optional[float]] = mapped_column(Float)
    dplus_m: Mapped[Optional[int]] = mapped_column(Integer)
    fc_moyenne_bpm: Mapped[Optional[int]] = mapped_column(Integer)
    fc_max_bpm: Mapped[Optional[int]] = mapped_column(Integer)
    calories: Mapped[Optional[int]] = mapped_column(Integer)
    rpe: Mapped[Optional[float]] = mapped_column(Float)
    ressenti: Mapped[Optional[int]] = mapped_column(Integer, comment="Ressenti global 1-5")
    notes: Mapped[Optional[str]] = mapped_column(Text)
    est_competition: Mapped[bool] = mapped_column(Boolean, default=False)
    objectif_id: Mapped[Optional[int]] = mapped_column(ForeignKey("objectifs.id", ondelete="SET NULL"), index=True)
    details: Mapped[Optional[str]] = mapped_column(Text, comment="JSON libre : exercices, splits, données brutes de la source")
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class TraceGPS(Base):
    """
    Tracé GPS d'une séance (GPX de l'export Santé), allégé côté navigateur :
    `points` = JSON [[lat, lon, altitude|null, secondes depuis le début], …].
    `activite_id` est vide tant qu'aucune séance ne correspond (rattaché plus tard).
    """
    __tablename__ = "traces_gps"
    __table_args__ = (
        UniqueConstraint("utilisateur_id", "debut", name="uq_trace_debut"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False, index=True)
    activite_id: Mapped[Optional[int]] = mapped_column(ForeignKey("activites.id", ondelete="SET NULL"), index=True)
    debut: Mapped[datetime] = mapped_column(DateTime, nullable=False)  # heure locale du premier point
    fin: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    distance_km: Mapped[Optional[float]] = mapped_column(Float)
    dplus_m: Mapped[Optional[int]] = mapped_column(Integer)
    points: Mapped[str] = mapped_column(Text, nullable=False)


class CacheCarte(Base):
    """Tracés allégés et encodés pour la carte « Mes tracés » (regénérés quand les tracés changent)."""
    __tablename__ = "cache_cartes"

    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id"), primary_key=True)
    signature: Mapped[str] = mapped_column(String(100), nullable=False)
    donnees: Mapped[str] = mapped_column(Text, nullable=False)


class SeancePrevue(Base):
    """
    Séance planifiée (envoyée par Claude via le token Claude, ou saisie).

    `id_externe` permet à Claude de renvoyer un plan sans créer de doublons.
    `activite_id` relie la séance à l'activité réellement effectuée : posé
    automatiquement par rapprochement (même jour, même famille de sport) ou à la main.
    """
    __tablename__ = "seances_prevues"
    __table_args__ = (
        UniqueConstraint("utilisateur_id", "id_externe", name="uq_seance_prevue_externe"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False, index=True)
    id_externe: Mapped[Optional[str]] = mapped_column(String(100))
    jour: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    ordre: Mapped[int] = mapped_column(Integer, default=0)  # plusieurs séances le même jour
    sport: Mapped[str] = mapped_column(String(30), nullable=False)
    titre: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, comment="Contenu détaillé (échauffement, blocs, consignes)")
    duree_min: Mapped[Optional[int]] = mapped_column(Integer)
    distance_km: Mapped[Optional[float]] = mapped_column(Float)
    dplus_m: Mapped[Optional[int]] = mapped_column(Integer)
    rpe_cible: Mapped[Optional[float]] = mapped_column(Float)
    objectif_id: Mapped[Optional[int]] = mapped_column(ForeignKey("objectifs.id", ondelete="SET NULL"), index=True)
    statut: Mapped[str] = mapped_column(String(20), default="prevue")  # prevue | sautee
    activite_id: Mapped[Optional[int]] = mapped_column(ForeignKey("activites.id", ondelete="SET NULL"), index=True)
    lien_manuel: Mapped[bool] = mapped_column(Boolean, default=False, comment="Rapprochement fixé à la main : ne pas recalculer")
    commentaire: Mapped[Optional[str]] = mapped_column(Text, comment="Note de l'athlète (pourquoi sautée, ressenti…)")
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    maj_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class Objectif(Base):
    """
    Objectif sportif : course officielle (date, distance, D+, temps visé)
    ou objectif personnel chiffré (ex. 1000 km de course sur l'année,
    100 séances, 20 tractions…).
    """
    __tablename__ = "objectifs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False)  # course | perso
    titre: Mapped[str] = mapped_column(String(200), nullable=False)
    sport: Mapped[Optional[str]] = mapped_column(String(30))
    date_cible: Mapped[Optional[date]] = mapped_column(Date)
    date_debut: Mapped[Optional[date]] = mapped_column(Date, comment="Début de la période comptée (objectif perso)")
    # Course officielle
    distance_km: Mapped[Optional[float]] = mapped_column(Float)
    dplus_m: Mapped[Optional[int]] = mapped_column(Integer)
    temps_cible_sec: Mapped[Optional[int]] = mapped_column(Integer)
    url: Mapped[Optional[str]] = mapped_column(Text)
    # Objectif perso : métrique cumulée sur la période
    metrique: Mapped[Optional[str]] = mapped_column(String(30))  # distance_km | duree_h | dplus_m | nb_seances | valeur_libre
    valeur_cible: Mapped[Optional[float]] = mapped_column(Float)
    valeur_actuelle: Mapped[Optional[float]] = mapped_column(Float, comment="Pour métrique valeur_libre, saisie à la main")
    unite: Mapped[Optional[str]] = mapped_column(String(30))
    statut: Mapped[str] = mapped_column(String(20), default="actif")  # actif | atteint | abandonne
    resultat_temps_sec: Mapped[Optional[int]] = mapped_column(Integer)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
