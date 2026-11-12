"""
Formulations « grand public » des messages de forme.

Le carnet n'est pas un dispositif médical : pour les comptes invités, les messages qui
évoquent une maladie ou une infection sont reformulés en simples écarts à la normale,
avec un renvoi vers un professionnel de santé quand ça dure. Le compte administrateur
garde les textes d'origine (son choix).

Le remplacement porte sur des morceaux de phrase exacts : si un texte source change,
le test tests/test_multi_comptes.py le signale.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from deps import est_admin

REMPLACEMENTS: list[tuple[str, str]] = [
    ("Signes de maladie possible", "FC de repos inhabituelle"),
    ("possible infection ou grosse fatigue, allège",
     "allège, et parles-en à un professionnel de santé si ça continue"),
    ("guette les signes (gorge, fièvre) et reste prudent", "reste prudent aujourd'hui"),
    ("Surveille les signes de maladie (gorge, courbatures inhabituelles) et évite l'intensité aujourd'hui.",
     "Évite l'intensité aujourd'hui ; si ça dure plusieurs jours, parles-en à un professionnel de santé."),
    ("fatigue, stress ou maladie qui couve", "fatigue, stress ou récupération incomplète"),
    ("fatigue, chaleur, alcool ou maladie qui couve", "fatigue, chaleur, alcool ou récupération incomplète"),
    ("fatigue, stress ou maladie", "fatigue, stress ou récupération incomplète"),
    ("Surcharge : risque de blessure, allège", "Surcharge : allège"),
    ("exposent au surmenage et aux maladies", "exposent à la fatigue"),
]


def _remplacer(texte: str) -> str:
    for ancien, nouveau in REMPLACEMENTS:
        if ancien in texte:
            texte = texte.replace(ancien, nouveau)
    return texte


def neutre(obj: Any) -> Any:
    """Copie de `obj` (dict, liste, texte) avec les formulations grand public. Ne modifie pas l'original
    (les résultats d'analyse sont mis en cache et partagés)."""
    if isinstance(obj, str):
        return _remplacer(obj)
    if isinstance(obj, dict):
        return {k: neutre(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [neutre(v) for v in obj]
    return obj


def pour(db: Session, user, obj: Any) -> Any:
    """Textes d'origine pour l'administrateur, formulations grand public pour les autres comptes."""
    return obj if est_admin(db, user) else neutre(obj)


# ── Réponses de l'API ──────────────────────────────────────────────────────────
# Les messages de forme viennent de nombreux calculs (forme du jour, analyses, alertes, statistiques…) :
# plutôt que d'adapter chaque route, les réponses JSON des comptes invités passent par `neutre`.
_MARQUEURS = ("maladie", "infection", "fièvre", r"fi\u00e8vre", "blessure", "surmenage")
_admin_par_id: dict[int, bool] = {}


def compte_admin(user_id: int) -> bool:
    if user_id not in _admin_par_id:
        from database import SessionLocal
        from models import Utilisateur
        db = SessionLocal()
        try:
            _admin_par_id[user_id] = est_admin(db, db.get(Utilisateur, user_id))
        finally:
            db.close()
    return _admin_par_id[user_id]


def a_reformuler(corps: bytes) -> bool:
    texte = corps.decode("utf-8", "ignore")
    return any(m in texte for m in _MARQUEURS)


def reformuler_json(corps: bytes) -> bytes:
    import json
    return json.dumps(neutre(json.loads(corps)), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
