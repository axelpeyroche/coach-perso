"""
Cache en mémoire des analyses : le calcul complet est gardé pour la journée et jeté dès qu'une écriture
passe par l'ORM (séance reçue, ressenti saisi, profil modifié…). Un seul processus sert l'app : pas de
cache partagé à tenir à jour. Les écritures du calcul lui-même (meilleurs efforts mémorisés, journal)
ne comptent pas : elles ne changent pas le résultat.
"""
from __future__ import annotations

import time
from datetime import date
from typing import Callable

from sqlalchemy import event
from sqlalchemy.orm import Session

from database import SessionLocal

DUREE_MAX_S = 6 * 3600     # filet de sécurité pour une écriture qui échapperait aux événements
_generation = 0            # augmente à chaque écriture
_cache: dict[int, tuple[date, int, float, dict]] = {}
_stats = {"servis": 0, "calcules": 0}
_DRAPEAU = "calcul_analyses"


def invalider() -> None:
    global _generation
    _generation += 1
    _cache.clear()


@event.listens_for(SessionLocal, "after_flush")
def _apres_flush(session, _contexte):
    if not session.info.get(_DRAPEAU) and (session.new or session.dirty or session.deleted):
        invalider()


@event.listens_for(SessionLocal, "do_orm_execute")
def _a_l_execution(etat):
    if (etat.is_insert or etat.is_update or etat.is_delete) and not etat.session.info.get(_DRAPEAU):
        invalider()


def obtenir(db: Session, user_id: int, calculer: Callable[[], dict]) -> dict:
    """Résultat du jour s'il est encore valable, sinon `calculer()` puis commit (ce que le calcul mémorise)."""
    auj = date.today()
    garde = _cache.get(user_id)
    if garde and garde[0] == auj and garde[1] == _generation and time.monotonic() - garde[2] < DUREE_MAX_S:
        _stats["servis"] += 1
        return garde[3]
    db.flush()   # une écriture en attente dans cette session invalide avant le calcul, pas pendant
    generation = _generation
    db.info[_DRAPEAU] = True
    try:
        res = calculer()
        db.commit()
    finally:
        db.info.pop(_DRAPEAU, None)
    _stats["calcules"] += 1
    if generation == _generation:
        _cache[user_id] = (auj, generation, time.monotonic(), res)
    return res


def stats() -> dict:
    return dict(_stats)
