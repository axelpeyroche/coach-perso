"""
Configuration de la connexion SQLAlchemy et utilitaires de session.
"""

import logging
import os

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from models import Base

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./carnet.db")

# Render injecte une URL postgres:// — SQLAlchemy requiert postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=300,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def creer_tables() -> None:
    """Crée toutes les tables si elles n'existent pas encore, et applique les migrations."""
    Base.metadata.create_all(bind=engine)
    # Migrations manuelles pour les colonnes ajoutées après la création initiale
    _migrations = [
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS fc_max INTEGER",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS fc_repos INTEGER",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS poids_kg FLOAT",
        # Auth + onboarding
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS prenom VARCHAR(120)",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS sexe VARCHAR(10)",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS onboarding_complet BOOLEAN DEFAULT FALSE",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS type_programme VARCHAR(20)",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS seances_semaine INTEGER",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS seances_course_semaine INTEGER",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS seances_muscu_semaine INTEGER",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS frequence_tests_semaines INTEGER DEFAULT 8",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS objectif_type VARCHAR(20)",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS historique_perf TEXT",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS type_course VARCHAR(20)",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS type_muscu VARCHAR(20)",
        # Token d'import iOS Shortcuts
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS import_token VARCHAR(64)",
        # Mode de génération du programme (auto vs manuel)
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS programme_auto BOOLEAN DEFAULT TRUE",
        # Nombre de séances vélo par semaine
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS seances_velo_semaine INTEGER",
        # Photo de profil (remplace le stockage localStorage côté frontend)
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS photo_url TEXT",
        # Fuseau horaire IANA de l'utilisateur
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS fuseau_horaire VARCHAR(50)",
        # Carnet : lien d'analyse + connexion Strava
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS analyse_token VARCHAR(64)",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS strava_athlete_id INTEGER",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS strava_access_token VARCHAR(255)",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS strava_refresh_token VARCHAR(255)",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS strava_expires_at INTEGER",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS strava_derniere_synchro TIMESTAMP",
        # Token Claude (plan d'entraînement)
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS claude_token VARCHAR(64)",
        # Séances détectées par le raccourci puis supprimées
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS seances_ignorees TEXT",
        # Synchro Intervals.icu (séances + tracés GPS)
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS intervals_athlete_id VARCHAR(30)",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS intervals_cle VARCHAR(100)",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS intervals_derniere_synchro TIMESTAMP",
        # Index sur les clés étrangères, absents des tables déjà existantes en
        # production (Base.metadata.create_all ne les crée que sur les tables neuves).
        "CREATE INDEX IF NOT EXISTS idx_poids_utilisateurs_utilisateur_id ON poids_utilisateurs (utilisateur_id)",
        "CREATE INDEX IF NOT EXISTS idx_objectifs_course_utilisateur_id ON objectifs_course (utilisateur_id)",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS notif_matin_heure VARCHAR(5)",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS notif_matin_le DATE",
    ]
    with engine.begin() as conn:
        for stmt in _migrations:
            try:
                # Savepoint par instruction : une migration qui échoue (ex. clause
                # non supportée par SQLite en local) ne doit pas invalider la
                # transaction pour les instructions suivantes.
                with conn.begin_nested():
                    conn.execute(text(stmt))
            except Exception:
                if not DATABASE_URL.startswith("sqlite"):
                    logger.warning("Migration ignorée (échec) : %s", stmt)


def obtenir_session():
    """Dépendance FastAPI — fournit une session et la ferme après la requête."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
