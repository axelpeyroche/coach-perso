"""
Configuration de la connexion SQLAlchemy et utilitaires de session.
"""

import os

from sqlalchemy import create_engine
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
    """Crée toutes les tables si elles n'existent pas encore."""
    Base.metadata.create_all(bind=engine)


def obtenir_session():
    """Dépendance FastAPI — fournit une session et la ferme après la requête."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
