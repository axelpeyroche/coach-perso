"""
Usure du matériel (chaussures surtout) : km cumulés de chaque paire.

Une séance compte pour la paire choisie dessus ; sans choix, pour la paire « par défaut »
de son sport en service à cette date (la plus récemment mise en service s'il y en a plusieurs).
"""
from __future__ import annotations

from datetime import date
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from models import Activite, Equipement, EquipementActivite

SEUIL_ALERTE = 0.8    # part de la limite à partir de laquelle on prévient


def sports_de(e: Equipement) -> set[str]:
    return {s.strip() for s in (e.sports or "").split(",") if s.strip()}


def en_service(e: Equipement, jour: date) -> bool:
    return e.mise_en_service <= jour and (e.retire_le is None or jour <= e.retire_le)


def par_defaut(equipements: Iterable[Equipement], sport: str, jour: date) -> Optional[Equipement]:
    cands = [e for e in equipements if e.par_defaut and sport in sports_de(e) and en_service(e, jour)]
    return max(cands, key=lambda e: (e.mise_en_service, e.id)) if cands else None


def attribution(db: Session, user_id: int) -> tuple[list[Equipement], dict[int, Optional[int]], dict[int, bool]]:
    """(matériel, activité → matériel compté, activité → choisi à la main ?)."""
    eqs = db.query(Equipement).filter(Equipement.utilisateur_id == user_id).order_by(Equipement.mise_en_service).all()
    choix = {c.activite_id: c.equipement_id for c in
             db.query(EquipementActivite).join(Activite, Activite.id == EquipementActivite.activite_id)
             .filter(Activite.utilisateur_id == user_id)}
    if not eqs:
        return eqs, {}, {}
    sports = set().union(*(sports_de(e) for e in eqs))
    acts = (db.query(Activite.id, Activite.sport, Activite.debut)
            .filter(Activite.utilisateur_id == user_id, Activite.sport.in_(sports)).all())
    compte: dict[int, Optional[int]] = {}
    for a in acts:
        if a.id in choix:
            compte[a.id] = choix[a.id]
        else:
            e = par_defaut(eqs, a.sport, a.debut.date())
            compte[a.id] = e.id if e else None
    for aid, eid in choix.items():  # choix sur une séance d'un autre sport
        compte.setdefault(aid, eid)
    return eqs, compte, {aid: True for aid in choix}


def serialiser(e: Equipement, km: float, nb: int, derniere: Optional[date]) -> dict:
    total = (e.km_initial or 0) + km
    return {
        "id": e.id, "nom": e.nom, "sports": sorted(sports_de(e)), "par_defaut": bool(e.par_defaut),
        "mise_en_service": e.mise_en_service.isoformat(), "km_initial": e.km_initial or 0,
        "limite_km": e.limite_km, "retire_le": e.retire_le.isoformat() if e.retire_le else None,
        "notes": e.notes, "km": round(total, 1), "nb_seances": nb,
        "derniere_sortie": derniere.isoformat() if derniere else None,
        "usure": round(total / e.limite_km, 3) if e.limite_km else None,
        "alerte": bool(e.limite_km and not e.retire_le and total >= e.limite_km * SEUIL_ALERTE),
    }


def lister(db: Session, user_id: int) -> list[dict]:
    eqs, compte, _ = attribution(db, user_id)
    if not eqs:
        return []
    ids = [aid for aid, eid in compte.items() if eid]
    km: dict[int, float] = {}
    nb: dict[int, int] = {}
    der: dict[int, date] = {}
    for i in range(0, len(ids), 500):
        for a in db.query(Activite.id, Activite.distance_km, Activite.debut).filter(Activite.id.in_(ids[i:i + 500])):
            eid = compte[a.id]
            km[eid] = km.get(eid, 0) + (a.distance_km or 0)
            nb[eid] = nb.get(eid, 0) + 1
            der[eid] = max(der.get(eid, a.debut.date()), a.debut.date())
    res = [serialiser(e, km.get(e.id, 0), nb.get(e.id, 0), der.get(e.id)) for e in eqs]
    # En service d'abord (les plus usées en tête), puis les retirées
    return sorted(res, key=lambda r: (r["retire_le"] is not None, -(r["km"] or 0)))


def de_activite(db: Session, user_id: int, a: Activite) -> dict:
    """Matériel compté pour la séance, et choix possibles (matériel en service pour ce sport)."""
    eqs, compte, manuels = attribution(db, user_id)
    tous = {e["id"]: e for e in lister(db, user_id)} if eqs else {}
    eid = compte.get(a.id)
    jour = a.debut.date()
    options = [tous[e.id] for e in eqs if e.id in tous and en_service(e, jour)]
    options.sort(key=lambda o: (a.sport not in o["sports"], o["nom"].lower()))
    return {"equipement": tous.get(eid) if eid else None, "manuel": bool(manuels.get(a.id)), "options": options}
