"""Les tests tournent sur une base SQLite jetable : jamais sur la base réelle, quoi que dise l'environnement."""
import os
import sys
import tempfile
from pathlib import Path

_DOSSIER = tempfile.mkdtemp(prefix="carnet-tests-")
os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(_DOSSIER) / "tests.db").replace("\\", "/")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

import database  # noqa: E402

assert database.DATABASE_URL.startswith("sqlite"), "les tests ne doivent jamais toucher une vraie base"
assert "carnet-tests-" in str(database.engine.url), "les tests ne doivent jamais toucher une vraie base"
database.creer_tables()


@pytest.fixture()
def db():
    session = database.SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture()
def user(db):
    from models import Utilisateur
    n = db.query(Utilisateur).count() + 1
    u = Utilisateur(email=f"essai{n}@exemple.test", nom="Essai", fc_max=190)
    db.add(u)
    db.commit()
    return u
