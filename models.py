"""
Modèles SQLAlchemy ORM du carnet de suivi multi-sport.

Les tables de l'ancien programme EPC (macrocycles, séances, journaux,
évaluations, chat…) restent en base mais ne sont plus mappées.
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
    LargeBinary,
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

    # Intervals.icu : séances de l'Apple Watch (envoyées par l'app Intervals.icu Companion),
    # récupérées avec leur tracé GPS grâce à la clé API personnelle de l'utilisateur
    intervals_athlete_id: Mapped[Optional[str]] = mapped_column(String(30))
    intervals_cle: Mapped[Optional[str]] = mapped_column(String(100))
    intervals_derniere_synchro: Mapped[Optional[datetime]] = mapped_column(DateTime)
    montre: Mapped[Optional[str]] = mapped_column(String(20))  # apple, garmin, coros… (conseils de l'assistant de connexion)

    # Physiologie
    fc_max: Mapped[Optional[int]] = mapped_column(Integer, comment="FC max mesurée (bpm)")
    fc_repos: Mapped[Optional[int]] = mapped_column(Integer, comment="FC de repos (bpm)")
    fc_seuil: Mapped[Optional[int]] = mapped_column(Integer, comment="FC au seuil estimée (bpm), base des zones")
    poids_kg: Mapped[Optional[float]] = mapped_column(Float, comment="Poids corporel (kg)")
    taille_cm: Mapped[Optional[float]] = mapped_column(Float, comment="Taille (cm), pour l'IMC")
    besoin_sommeil_h: Mapped[Optional[float]] = mapped_column(Float, comment="Besoin de sommeil (h), pour la dette")

    # Adresse (domicile) : centre la carte « Mes tracés »
    adresse: Mapped[Optional[str]] = mapped_column(String(300))
    adresse_lat: Mapped[Optional[float]] = mapped_column(Float)
    adresse_lon: Mapped[Optional[float]] = mapped_column(Float)

    # Photo de profil (data URL base64, cf. absence de stockage objet dédié)
    photo_url: Mapped[Optional[str]] = mapped_column(Text)

    # Fuseau horaire IANA (ex. "Europe/Paris"), détecté par le navigateur —
    # sert à convertir les dates UTC des imports (export Strava).
    fuseau_horaire: Mapped[Optional[str]] = mapped_column(String(50))

    # Notification du matin : heure souhaitée ("HH:MM", heure locale) et date du dernier envoi
    notif_matin_heure: Mapped[Optional[str]] = mapped_column(String(5))
    notif_matin_le: Mapped[Optional[date]] = mapped_column(Date)
    # Rappel de pesée : jour de la semaine (0 = lundi … 6 = dimanche), -1 = désactivé
    rappel_poids_jour: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Filtres du carnet enregistrés : JSON [{nom, criteres}, …]
    filtres_carnet: Mapped[Optional[str]] = mapped_column(Text)
    # Notifications activées une par une : JSON {forme, vfc, nuit, records, seance, bilan, fc_repos}
    notifs_reglages: Mapped[Optional[str]] = mapped_column(Text)
    # Consentement explicite au traitement des données de santé (RGPD art. 9), donné à l'inscription.
    # Vide pour les comptes créés avant l'ouverture aux invités.
    consentement_sante_le: Mapped[Optional[datetime]] = mapped_column(DateTime)


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
    type: Mapped[str] = mapped_column(String(20), nullable=False)  # voir carnet_service.MESURES
    jour: Mapped[date] = mapped_column(Date, nullable=False)
    valeur: Mapped[float] = mapped_column(Float, nullable=False)


class NuitSommeil(Base):
    """Nuit importée par l'ancien raccourci « Carnet – Sommeil » ou l'export Santé (fonction retirée) :
    conservée pour l'export du compte et l'effacement depuis Sources (/api/sommeil/nuits-importees)."""
    __tablename__ = "nuits_sommeil"
    __table_args__ = (
        UniqueConstraint("utilisateur_id", "jour", name="uq_nuit_sommeil_jour"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False, index=True)
    jour: Mapped[date] = mapped_column(Date, nullable=False)  # jour du réveil
    endormissement: Mapped[datetime] = mapped_column(DateTime, nullable=False)  # heure locale
    reveil: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    endormi_min: Mapped[float] = mapped_column(Float, nullable=False)
    profond_min: Mapped[Optional[float]] = mapped_column(Float)
    paradoxal_min: Mapped[Optional[float]] = mapped_column(Float)
    essentiel_min: Mapped[Optional[float]] = mapped_column(Float)
    eveil_min: Mapped[float] = mapped_column(Float, default=0)
    reveils: Mapped[int] = mapped_column(Integer, default=0)
    score: Mapped[Optional[int]] = mapped_column(Integer)
    score_duree: Mapped[Optional[float]] = mapped_column(Float)
    score_regularite: Mapped[Optional[float]] = mapped_column(Float)
    score_interruptions: Mapped[Optional[float]] = mapped_column(Float)


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
    deroule: Mapped[Optional[str]] = mapped_column(Text, comment="Séance guidée (JSON) : durée, séries faites, difficulté et ressenti par exercice")
    structure: Mapped[Optional[str]] = mapped_column(Text, comment="Blocs de l'éditeur (JSON) : la description en est tirée, ils servent à rééditer et à l'envoi sur la montre")
    envoi_montre: Mapped[Optional[str]] = mapped_column(Text, comment="Envoi sur Intervals.icu (JSON) : event_id, jour, date d'envoi, empreinte du contenu envoyé")
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    maj_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class ModeleSeance(Base):
    """Séance enregistrée par l'athlète pour la reprendre plus tard (« Mes modèles »)."""
    __tablename__ = "modeles_seance"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False, index=True)
    nom: Mapped[str] = mapped_column(String(100), nullable=False)
    sport: Mapped[str] = mapped_column(String(30), nullable=False)
    titre: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    duree_min: Mapped[Optional[int]] = mapped_column(Integer)
    distance_km: Mapped[Optional[float]] = mapped_column(Float)
    dplus_m: Mapped[Optional[int]] = mapped_column(Integer)
    rpe_cible: Mapped[Optional[float]] = mapped_column(Float)
    structure: Mapped[Optional[str]] = mapped_column(Text)
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


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
    # Parcours enregistré (itineraires_favoris.id) lié à la course, pour la prédiction par tronçon
    itineraire_id: Mapped[Optional[int]] = mapped_column(Integer)
    unite: Mapped[Optional[str]] = mapped_column(String(30))
    statut: Mapped[str] = mapped_column(String(20), default="actif")  # actif | atteint | abandonne
    resultat_temps_sec: Mapped[Optional[int]] = mapped_column(Integer)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    # Préparation de la course : JSON {coches, ajouts, heure}
    preparation: Mapped[Optional[str]] = mapped_column(Text)
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class PushSubscription(Base):
    """Abonnement aux notifications push d'un appareil (Web Push, clés VAPID)."""
    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id"), nullable=False, index=True)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    p256dh: Mapped[str] = mapped_column(Text, nullable=False)
    auth: Mapped[str] = mapped_column(Text, nullable=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ItineraireFavori(Base):
    """
    Parcours mis de côté depuis la page Itinéraires (proposition retouchée ou non).
    `donnees` = JSON {points: [[lat, lon, alt], …], terrains, repartition, etapes, depart}.
    """
    __tablename__ = "itineraires_favoris"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), nullable=False, index=True)
    nom: Mapped[str] = mapped_column(String(120), nullable=False)
    sport: Mapped[str] = mapped_column(String(20), nullable=False)
    boucle: Mapped[bool] = mapped_column(Boolean, default=True)
    distance_km: Mapped[float] = mapped_column(Float, nullable=False)
    dplus_m: Mapped[int] = mapped_column(Integer, nullable=False)
    donnees: Mapped[str] = mapped_column(Text, nullable=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    maj_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


# ---------------------------------------------------------------------------
# Météo, matériel et segments
# ---------------------------------------------------------------------------

class MeteoActivite(Base):
    """Météo d'une sortie au départ du tracé (Open-Meteo), gardée une fois lue. `donnees` = JSON."""
    __tablename__ = "meteo_activites"

    activite_id: Mapped[int] = mapped_column(ForeignKey("activites.id", ondelete="CASCADE"), primary_key=True)
    donnees: Mapped[str] = mapped_column(Text, nullable=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Equipement(Base):
    """
    Paire de chaussures (ou autre matériel) dont on suit l'usure en km.
    Une paire « par défaut » est comptée pour chaque séance de ses sports à partir de sa
    mise en service, sauf choix contraire sur la séance (EquipementActivite).
    """
    __tablename__ = "equipements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), nullable=False, index=True)
    nom: Mapped[str] = mapped_column(String(120), nullable=False)
    sports: Mapped[str] = mapped_column(String(200), nullable=False, default="course")  # codes séparés par des virgules
    par_defaut: Mapped[bool] = mapped_column(Boolean, default=True)
    mise_en_service: Mapped[date] = mapped_column(Date, nullable=False)
    km_initial: Mapped[float] = mapped_column(Float, default=0)
    limite_km: Mapped[int] = mapped_column(Integer, default=700)
    retire_le: Mapped[Optional[date]] = mapped_column(Date)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class EquipementActivite(Base):
    """Choix fait sur une séance : telle paire, ou aucune (`equipement_id` vide)."""
    __tablename__ = "equipements_activites"

    activite_id: Mapped[int] = mapped_column(ForeignKey("activites.id", ondelete="CASCADE"), primary_key=True)
    equipement_id: Mapped[Optional[int]] = mapped_column(ForeignKey("equipements.id", ondelete="CASCADE"), index=True)


class Segment(Base):
    """
    Portion de parcours chronométrée à chaque passage (montée, ligne droite…).
    `points` = JSON [[lat, lon, alt|null], …], un point tous les ~10 m.
    """
    __tablename__ = "segments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), nullable=False, index=True)
    nom: Mapped[str] = mapped_column(String(120), nullable=False)
    sport: Mapped[Optional[str]] = mapped_column(String(30))
    distance_m: Mapped[float] = mapped_column(Float, nullable=False)
    dplus_m: Mapped[Optional[int]] = mapped_column(Integer)
    points: Mapped[str] = mapped_column(Text, nullable=False)
    activite_id: Mapped[Optional[int]] = mapped_column(ForeignKey("activites.id", ondelete="SET NULL"))
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Pictogramme(Base):
    """
    Pictogramme d'un exercice de muscu ajouté par le plan hebdomadaire (voir pictogrammes.py).
    `cle` = mots du nom sans accents ; `traces` = JSON [d SVG, …] dans un carré 24 × 24.
    """
    __tablename__ = "pictogrammes"
    __table_args__ = (UniqueConstraint("utilisateur_id", "cle", name="uq_pictogramme_cle"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), nullable=False, index=True)
    cle: Mapped[str] = mapped_column(String(200), nullable=False)
    nom: Mapped[str] = mapped_column(String(200), nullable=False)
    traces: Mapped[str] = mapped_column(Text, nullable=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Animation(Base):
    """
    Animation 3D d'un exercice de muscu ajoutée par le plan hebdomadaire (voir animations.py).
    `cle` = mots du nom sans accents ; `donnees` = JSON {poses, phases, consignes, decor, camera}.
    """
    __tablename__ = "animations"
    __table_args__ = (UniqueConstraint("utilisateur_id", "cle", name="uq_animation_cle"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), nullable=False, index=True)
    cle: Mapped[str] = mapped_column(String(200), nullable=False)
    nom: Mapped[str] = mapped_column(String(200), nullable=False)
    donnees: Mapped[str] = mapped_column(Text, nullable=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ---------------------------------------------------------------------------
# Corps : marqueurs de journée, ressenti du matin, journal des douleurs
# ---------------------------------------------------------------------------

class MarqueurJour(Base):
    """Contexte d'une journée (malade, voyage, alcool, stress, courbatures) : explique une mesure
    inhabituelle et l'écarte de la référence personnelle (voir corps_service)."""
    __tablename__ = "marqueurs_jour"
    __table_args__ = (UniqueConstraint("utilisateur_id", "jour", "type", name="uq_marqueur_jour"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), nullable=False, index=True)
    jour: Mapped[date] = mapped_column(Date, nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class RessentiMatin(Base):
    """Ressenti noté au réveil, de 1 (très mauvais) à 5 (excellent)."""
    __tablename__ = "ressentis_matin"
    __table_args__ = (UniqueConstraint("utilisateur_id", "jour", name="uq_ressenti_jour"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), nullable=False, index=True)
    jour: Mapped[date] = mapped_column(Date, nullable=False)
    energie: Mapped[Optional[int]] = mapped_column(Integer)
    jambes: Mapped[Optional[int]] = mapped_column(Integer)
    humeur: Mapped[Optional[int]] = mapped_column(Integer)
    motivation: Mapped[Optional[int]] = mapped_column(Integer)


class Douleur(Base):
    """Une gêne ou une blessure suivie dans le temps : zone du corps, dates, notes (kiné)."""
    __tablename__ = "douleurs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), nullable=False, index=True)
    zone: Mapped[str] = mapped_column(String(30), nullable=False)
    cote: Mapped[Optional[str]] = mapped_column(String(10))          # gauche | droite | None
    debut: Mapped[date] = mapped_column(Date, nullable=False)
    fin: Mapped[Optional[date]] = mapped_column(Date)                 # None = en cours
    notes: Mapped[Optional[str]] = mapped_column(Text)
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ReleveDouleur(Base):
    """Intensité d'une douleur un jour donné (0 = rien, 10 = insupportable)."""
    __tablename__ = "releves_douleur"
    __table_args__ = (UniqueConstraint("douleur_id", "jour", name="uq_releve_douleur_jour"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    douleur_id: Mapped[int] = mapped_column(ForeignKey("douleurs.id", ondelete="CASCADE"), nullable=False, index=True)
    jour: Mapped[date] = mapped_column(Date, nullable=False)
    intensite: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[Optional[str]] = mapped_column(String(500))


class Mensuration(Base):
    """Composition corporelle : masse grasse (%) et tours (cm), une valeur par type et par jour.
    `source` : manuel (saisie, prioritaire) ou intervals (balance connectée)."""
    __tablename__ = "mensurations"
    __table_args__ = (UniqueConstraint("utilisateur_id", "type", "jour", name="uq_mensuration_jour"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    jour: Mapped[date] = mapped_column(Date, nullable=False)
    valeur: Mapped[float] = mapped_column(Float, nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="manuel")
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ---------------------------------------------------------------------------
# Socle : qualité des données, journal des recalculs, sauvegardes
# ---------------------------------------------------------------------------

class Exclusion(Base):
    """Séance ou mesure d'un jour écartée des calculs sans être supprimée ni modifiée.
    `genre` : activite (activite_id renseigné) ou mesure (type_mesure + jour)."""
    __tablename__ = "exclusions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), nullable=False, index=True)
    genre: Mapped[str] = mapped_column(String(10), nullable=False)
    activite_id: Mapped[Optional[int]] = mapped_column(ForeignKey("activites.id", ondelete="CASCADE"), index=True)
    type_mesure: Mapped[Optional[str]] = mapped_column(String(20))
    jour: Mapped[Optional[date]] = mapped_column(Date)
    raison: Mapped[Optional[str]] = mapped_column(String(200))
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class JournalCalcul(Base):
    """Une ligne à chaque fois qu'un repère calculé change (VMA, allure critique, FC au seuil) : avant, après, pourquoi."""
    __tablename__ = "journal_calculs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), nullable=False, index=True)
    jour: Mapped[date] = mapped_column(Date, nullable=False)
    cle: Mapped[str] = mapped_column(String(20), nullable=False)   # vma | allure_critique | fc_seuil
    ancienne: Mapped[Optional[float]] = mapped_column(Float)
    nouvelle: Mapped[Optional[float]] = mapped_column(Float)
    cause: Mapped[Optional[str]] = mapped_column(String(300))
    cree_le: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Sauvegarde(Base):
    """Copie hebdomadaire du compte (JSON compressé, sans les tracés GPS). Les 4 dernières sont gardées."""
    __tablename__ = "sauvegardes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateurs.id", ondelete="CASCADE"), nullable=False, index=True)
    cree_le: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    origine: Mapped[str] = mapped_column(String(10), nullable=False, default="auto")   # auto | manuel
    taille: Mapped[int] = mapped_column(Integer, nullable=False)       # octets compressés
    resume: Mapped[Optional[str]] = mapped_column(Text)                # JSON : nombre de lignes par table
    contenu: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)


class Invitation(Base):
    """Code d'invitation à usage unique : sans lui, pas de création de compte (bêta fermée)."""
    __tablename__ = "invitations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    note: Mapped[Optional[str]] = mapped_column(String(80))            # pour qui (prénom…)
    cree_par_id: Mapped[Optional[int]] = mapped_column(ForeignKey("utilisateurs.id", ondelete="SET NULL"))
    cree_le: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    expire_le: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    utilisee_par_id: Mapped[Optional[int]] = mapped_column(ForeignKey("utilisateurs.id", ondelete="SET NULL"))
    utilisee_le: Mapped[Optional[datetime]] = mapped_column(DateTime)
    revoquee: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
