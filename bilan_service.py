"""
Bilan d'une année : totaux et comparaison avec l'année précédente, mois par mois, régularité,
records battus, sorties marquantes et répartition par sport.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import extract, func
from sqlalchemy.orm import Session

import analyses_service as an
import carnet_service as cs
import parcours_service as ps
import suivi_service as sv
from models import Activite, Segment, TraceGPS, Utilisateur

JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
        "septembre", "octobre", "novembre", "décembre"]


def annees(db: Session, user_id: int) -> list[int]:
    lignes = (db.query(extract("year", Activite.debut)).filter(Activite.utilisateur_id == user_id)
              .distinct().all())
    return sorted({int(a) for (a,) in lignes if a is not None})


def _totaux(acts: list[Activite]) -> dict:
    return {
        "km": round(sum(a.distance_km or 0 for a in acts), 1),
        "duree_sec": sum(a.duree_sec or 0 for a in acts),
        "dplus_m": sum(a.dplus_m or 0 for a in acts),
        "nb": len(acts),
    }


def _breve(a: Activite) -> dict:
    return {"id": a.id, "titre": a.titre, "sport": a.sport, "date": a.debut.date().isoformat(),
            "distance_km": a.distance_km, "dplus_m": a.dplus_m, "duree_sec": a.duree_sec}


def _plus_longue_serie(jours: set[date]) -> tuple[int, Optional[date]]:
    meilleure, fin, n = 0, None, 0
    for j in sorted(jours):
        n = n + 1 if (j - timedelta(days=1)) in jours else 1
        if n > meilleure:
            meilleure, fin = n, j
    return meilleure, fin


def _records(acts_tous: list[Activite], annee: int) -> list[dict]:
    """Records de course battus dans l'année : le dernier de chaque distance, avec le gain sur l'ancien."""
    res = []
    for label, suite in sv._historique_records(acts_tous).items():
        idx = [i for i, r in enumerate(suite) if r["date"].startswith(str(annee))]
        if not idx:
            continue
        i = idx[-1]
        avant = suite[idx[0] - 1] if idx[0] > 0 else None
        res.append({**suite[i], "label": label, "nb_fois": len(idx),
                    "gain_sec": avant["temps_sec"] - suite[i]["temps_sec"] if avant else None})
    return res


def _segments(db: Session, user_id: int, annee: int) -> list[dict]:
    """Segments dont le meilleur temps a été signé dans l'année."""
    segments = {s.id: s for s in db.query(Segment).filter(Segment.utilisateur_id == user_id)}
    if not segments:
        return []
    res = []
    for sid, pas in ps.tous_les_passages(db, user_id).items():
        dans = [p for p in pas if str(p["date"]).startswith(str(annee))]
        if sid in segments and pas and str(pas[0]["date"]).startswith(str(annee)):
            res.append({"id": sid, "nom": segments[sid].nom, "duree_sec": pas[0]["duree_sec"],
                        "date": str(pas[0]["date"])[:10], "activite_id": pas[0]["activite_id"],
                        "nb_passages": len(dans)})
    return sorted(res, key=lambda r: -r["nb_passages"])[:5]


def bilan(db: Session, user: Utilisateur, annee: int) -> dict:
    tous = (db.query(Activite).filter(Activite.utilisateur_id == user.id).order_by(Activite.debut).all())
    an.maj_efforts(db, user.id, tous)
    acts = [a for a in tous if a.debut.year == annee]
    auj = sv.aujourdhui(user)
    en_cours = annee == auj.year
    # Comparaison à date égale l'année en cours, sur l'année entière sinon
    limite = auj.replace(year=annee - 1) if en_cours and not (auj.month == 2 and auj.day == 29) else None
    preced = [a for a in tous if a.debut.year == annee - 1 and (limite is None or a.debut.date() <= limite)]

    mois = [{"km": 0.0, "duree_sec": 0, "nb": 0} for _ in range(12)]
    semaines: dict[date, float] = defaultdict(float)
    par_jour: dict[date, int] = defaultdict(int)
    for a in acts:
        m = mois[a.debut.month - 1]
        m["km"] += a.distance_km or 0
        m["duree_sec"] += a.duree_sec or 0
        m["nb"] += 1
        semaines[cs._lundi(a.debut.date())] += a.distance_km or 0
        par_jour[a.debut.date()] += round((a.duree_sec or 0) / 60)
    for m in mois:
        m["km"] = round(m["km"], 1)

    mois_top = max(range(12), key=lambda i: (mois[i]["duree_sec"], mois[i]["km"])) if acts else None
    sem_top = max(semaines.items(), key=lambda kv: kv[1]) if semaines else None
    serie, fin_serie = _plus_longue_serie(set(par_jour))
    fin_periode = auj if en_cours else date(annee, 12, 31)
    jours_ecoules = (min(fin_periode, date(annee, 12, 31)) - date(annee, 1, 1)).days + 1
    jour_prefere = Counter(j.weekday() for j in par_jour).most_common(1)

    sports: dict[str, dict] = {}
    for a in acts:
        s = sports.setdefault(a.sport, {"sport": a.sport, "label": cs.SPORTS.get(a.sport, cs.SPORTS["autre"])["label"],
                                        "duree_sec": 0, "km": 0.0, "nb": 0})
        s["duree_sec"] += a.duree_sec or 0
        s["km"] += a.distance_km or 0
        s["nb"] += 1
    for s in sports.values():
        s["km"] = round(s["km"], 1)

    distance = [a for a in acts if a.distance_km]
    marquantes = {
        "plus_longue": _breve(max(distance, key=lambda a: a.distance_km)) if distance else None,
        "plus_gros_dplus": _breve(max((a for a in acts if a.dplus_m), key=lambda a: a.dplus_m))
        if any(a.dplus_m for a in acts) else None,
        "plus_longue_duree": _breve(max((a for a in acts if a.duree_sec), key=lambda a: a.duree_sec))
        if any(a.duree_sec for a in acts) else None,
    }

    nb_traces = (db.query(func.count(TraceGPS.id))
                 .filter(TraceGPS.utilisateur_id == user.id, extract("year", TraceGPS.debut) == annee).scalar() or 0)

    return {
        "annee": annee,
        "annees": annees(db, user.id),
        "en_cours": en_cours,
        "jusqu_au": fin_periode.isoformat(),
        "totaux": _totaux(acts),
        "precedente": {**_totaux(preced), "annee": annee - 1, "a_date": limite is not None} if preced else None,
        "mois": mois,
        "mois_top": {"index": mois_top, "nom": MOIS[mois_top], **mois[mois_top]} if mois_top is not None else None,
        "semaine_top": {"debut": sem_top[0].isoformat(), "km": round(sem_top[1], 1)} if sem_top and sem_top[1] else None,
        "jours": sorted([j.isoformat(), m] for j, m in par_jour.items()),
        "jours_actifs": len(par_jour),
        "jours_ecoules": jours_ecoules,
        "plus_longue_serie": {"jours": serie, "fin": fin_serie.isoformat() if fin_serie else None},
        "jour_prefere": JOURS[jour_prefere[0][0]] if jour_prefere else None,
        "sports": sorted(sports.values(), key=lambda s: -s["duree_sec"]),
        "marquantes": marquantes,
        "records": _records(tous, annee),
        "segments": _segments(db, user.id, annee),
        "nb_traces": nb_traces,
    }
