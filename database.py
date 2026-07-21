"""
Configuration de la connexion SQLAlchemy et utilitaires de session.
"""

import os

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from models import Base

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./coach_epc.db")

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
        "ALTER TABLE exercices_seance ADD COLUMN IF NOT EXISTS duree_bloc_min INTEGER",
        "ALTER TABLE semaines_entrainement DROP CONSTRAINT IF EXISTS ck_numero_semaine_plage",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS fc_max INTEGER",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS fc_repos INTEGER",
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS poids_kg FLOAT",
        "ALTER TABLE journaux_seances ADD COLUMN IF NOT EXISTS details_intervalles TEXT",
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
        # Exercices libres (machines salle, etc.)
        "ALTER TABLE exercices_seance ADD COLUMN IF NOT EXISTS nom_affichage VARCHAR(200)",
        "ALTER TABLE exercices_seance ADD COLUMN IF NOT EXISTS series INTEGER",
        "ALTER TABLE exercices_seance ALTER COLUMN exercice_id DROP NOT NULL",
        # Planification libre par l'utilisateur
        "ALTER TABLE seances_entrainement ADD COLUMN IF NOT EXISTS date_planifiee DATE",
        "ALTER TABLE seances_entrainement ADD COLUMN IF NOT EXISTS heure_planifiee VARCHAR(5)",
        "ALTER TABLE journaux_seances ADD COLUMN IF NOT EXISTS distance_repos_km FLOAT",
        "ALTER TABLE journaux_seances ADD COLUMN IF NOT EXISTS type_course VARCHAR(20)",
        # Token d'import iOS Shortcuts
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS import_token VARCHAR(64)",
        # Mode de génération du programme (auto vs manuel)
        "ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS programme_auto BOOLEAN DEFAULT TRUE",
    ]
    with engine.begin() as conn:
        for stmt in _migrations:
            try:
                conn.execute(text(stmt))
            except Exception:
                pass

    # ALTER TYPE ADD VALUE ne peut pas s'exécuter dans une transaction PostgreSQL
    _enum_migrations = [
        "ALTER TYPE typeseance ADD VALUE IF NOT EXISTS 'GYM_UPPER'",
        "ALTER TYPE typeseance ADD VALUE IF NOT EXISTS 'GYM_LOWER'",
        "ALTER TYPE typeseance ADD VALUE IF NOT EXISTS 'GYM_FULL'",
        "ALTER TYPE typeseance ADD VALUE IF NOT EXISTS 'BLESSURE'",
    ]
    if not DATABASE_URL.startswith("sqlite"):
        raw = engine.raw_connection()
        try:
            raw.set_isolation_level(0)  # AUTOCOMMIT
            cur = raw.cursor()
            for stmt in _enum_migrations:
                try:
                    cur.execute(stmt)
                except Exception:
                    pass
            cur.close()
        finally:
            raw.close()


def obtenir_session():
    """Dépendance FastAPI — fournit une session et la ferme après la requête."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
