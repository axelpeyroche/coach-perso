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
    ]
    with engine.begin() as conn:
        for stmt in _migrations:
            try:
                conn.execute(text(stmt))
            except Exception:
                pass


def obtenir_session():
    """Dépendance FastAPI — fournit une session et la ferme après la requête."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
