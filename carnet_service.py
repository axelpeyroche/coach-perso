"""
Logique métier du carnet d'activités : normalisation des sports, import
dédoublonné, statistiques,
progression des objectifs et export (Markdown / JSON / CSV) pour analyse.
"""

from __future__ import annotations

import csv
import io
import json
import re
import unicodedata
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Iterable, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from models import Activite, MesureSante, Objectif, SeancePrevue, Utilisateur

# ---------------------------------------------------------------------------
# Sports
# ---------------------------------------------------------------------------

SPORTS = {
    "course":    {"label": "Course",      "emoji": "🏃", "endurance": True},
    "trail":     {"label": "Trail",       "emoji": "⛰️", "endurance": True},
    "velo":      {"label": "Vélo",        "emoji": "🚴", "endurance": True},
    "marche":    {"label": "Marche",      "emoji": "🚶", "endurance": True},
    "randonnee": {"label": "Randonnée",   "emoji": "🥾", "endurance": True},
    "natation":  {"label": "Natation",    "emoji": "🏊", "endurance": True},
    "muscu":     {"label": "Renfo / Muscu", "emoji": "💪", "endurance": False},
    "hiit":      {"label": "HIIT / Cross", "emoji": "🔥", "endurance": False},
    "yoga":      {"label": "Yoga / Mobilité", "emoji": "🧘", "endurance": False},
    "autre":     {"label": "Autre",       "emoji": "⚡", "endurance": False},
}

# Sports dont la distance est une distance "à pied" (allure en min/km, records)
SPORTS_PIED = {"course", "trail"}

_STRAVA_MAP = {
    "Run": "course", "VirtualRun": "course", "TrailRun": "trail",
    "Ride": "velo", "VirtualRide": "velo", "GravelRide": "velo", "MountainBikeRide": "velo",
    "EBikeRide": "velo", "EMountainBikeRide": "velo", "Velomobile": "velo", "Handcycle": "velo",
    "Walk": "marche", "Hike": "randonnee", "Snowshoe": "randonnee",
    "Swim": "natation",
    "WeightTraining": "muscu", "Crossfit": "hiit", "HighIntensityIntervalTraining": "hiit",
    "Yoga": "yoga", "Pilates": "yoga",
}

# Mots-clés (sans accents, minuscules) → sport, testés dans l'ordre
_MOTS_CLES = [
    ("trail", "trail"),
    ("randonn", "randonnee"), ("hik", "randonnee"),
    ("marche", "marche"), ("walk", "marche"),
    ("velo", "velo"), ("cycl", "velo"), ("ride", "velo"), ("bike", "velo"), ("vtt", "velo"),
    ("nata", "natation"), ("swim", "natation"), ("nage", "natation"),
    ("hiit", "hiit"), ("interval", "hiit"), ("fraction", "hiit"), ("cross", "hiit"), ("emom", "hiit"), ("amrap", "hiit"),
    ("yoga", "yoga"), ("pilates", "yoga"), ("mobilit", "yoga"), ("etirement", "yoga"), ("stretch", "yoga"),
    ("renfo", "muscu"), ("muscu", "muscu"), ("strength", "muscu"), ("force", "muscu"),
    ("fonctionnel", "muscu"), ("functional", "muscu"), ("traditional", "muscu"), ("weight", "muscu"),
    ("course", "course"), ("run", "course"), ("footing", "course"), ("jogging", "course"),
]


def _sans_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()


def normaliser_sport(valeur: Optional[str]) -> str:
    """Convertit un type d'activité (Strava, Apple Santé, texte libre) en sport du carnet."""
    if not valeur:
        return "autre"
    if valeur in SPORTS:
        return valeur
    if valeur in _STRAVA_MAP:
        return _STRAVA_MAP[valeur]
    brut = _sans_accents(valeur)
    for mot, sport in _MOTS_CLES:
        if mot in brut:
            return sport
    return "autre"


def famille_sport(sport: str) -> str:
    return "pied" if sport in SPORTS_PIED else sport


# ---------------------------------------------------------------------------
# Formatage
# ---------------------------------------------------------------------------

def fmt_duree(sec: Optional[int]) -> Optional[str]:
    if sec is None:
        return None
    h, rest = divmod(int(sec), 3600)
    m, s = divmod(rest, 60)
    return f"{h}h{m:02d}" if h else f"{m}min{s:02d}" if s else f"{m}min"


def fmt_allure(sec_par_km: Optional[float]) -> Optional[str]:
    if not sec_par_km:
        return None
    m, s = divmod(int(round(sec_par_km)), 60)
    return f"{m}:{s:02d}/km"


def allure_sec_km(a: Activite) -> Optional[float]:
    if a.sport in SPORTS_PIED or a.sport in ("marche", "randonnee"):
        if a.duree_sec and a.distance_km and a.distance_km > 0.2:
            return a.duree_sec / a.distance_km
    return None


def vitesse_kmh(a: Activite) -> Optional[float]:
    if a.duree_sec and a.distance_km:
        return a.distance_km / (a.duree_sec / 3600)
    return None


def charge(a: Activite) -> float:
    """Charge d'entraînement (méthode session-RPE de Foster) : minutes × RPE.
    RPE manquant → 5 (effort modéré) pour ne pas sous-estimer la charge."""
    if not a.duree_sec:
        return 0.0
    return (a.duree_sec / 60) * (a.rpe if a.rpe else 5)


def serialiser_activite(a: Activite) -> dict:
    allure = allure_sec_km(a)
    v = vitesse_kmh(a)
    try:
        details = json.loads(a.details) if a.details else None
    except ValueError:
        details = None
    return {
        "id": a.id,
        "source": a.source,
        "sport": a.sport,
        "sport_label": SPORTS.get(a.sport, SPORTS["autre"])["label"],
        "emoji": SPORTS.get(a.sport, SPORTS["autre"])["emoji"],
        "titre": a.titre,
        "debut": a.debut.isoformat() if a.debut else None,
        "duree_sec": a.duree_sec,
        "duree_str": fmt_duree(a.duree_sec),
        "distance_km": round(a.distance_km, 2) if a.distance_km is not None else None,
        "dplus_m": a.dplus_m,
        "allure_sec_km": round(allure) if allure else None,
        "allure_str": fmt_allure(allure),
        "vitesse_kmh": round(v, 1) if v and a.sport not in SPORTS_PIED else None,
        "fc_moyenne_bpm": a.fc_moyenne_bpm,
        "fc_max_bpm": a.fc_max_bpm,
        "calories": a.calories,
        "rpe": a.rpe,
        "ressenti": a.ressenti,
        "notes": a.notes,
        "est_competition": bool(a.est_competition),
        "objectif_id": a.objectif_id,
        "details": details,
        # RPE pré-rempli à partir de l'effort estimé par l'Apple Watch (à confirmer)
        "rpe_estime": a.rpe is not None and isinstance(details, dict) and details.get("rpe_source") == "estime_apple",
    }


# ---------------------------------------------------------------------------
# Import dédoublonné
# ---------------------------------------------------------------------------

CHAMPS_ACTIVITE = (
    "sport", "titre", "debut", "duree_sec", "distance_km", "dplus_m", "fc_moyenne_bpm",
    "fc_max_bpm", "calories", "rpe", "ressenti", "notes", "est_competition", "details",
)


def _sans_heure(d: datetime) -> bool:
    return (d.hour, d.minute, d.second) == (0, 0, 0)


def _rpe_estime(details: Optional[str]) -> bool:
    """Vrai si le RPE vient de l'effort estimé par l'Apple Watch (pas encore confirmé)."""
    try:
        d = json.loads(details) if details else None
    except ValueError:
        return False
    return isinstance(d, dict) and d.get("rpe_source") == "estime_apple"


def importer_activite(db: Session, user_id: int, source: str, donnees: dict,
                      id_externe: Optional[str] = None, maj_si_existe: bool = True) -> tuple[Activite, str]:
    """
    Crée ou met à jour une activité. Retourne (activité, statut) avec statut
    ∈ {"cree", "maj", "fusion", "inchange"}.

    1. Même source + même id_externe → mise à jour (ré-import idempotent).
    2. Même activité venant d'une autre source (même famille de sport, début à
       ±15 min) → fusion : on complète les champs vides de l'existante au lieu
       de créer un doublon (ex. une sortie remontée à la fois par Strava et
       Apple Santé). Une séance saisie sans heure (début à 00:00, ex. CSV
       d'historique) correspond à toute séance du même jour et de la même
       famille : l'heure précise remplace alors minuit.
    3. Sinon création.
    """
    if isinstance(donnees.get("details"), (dict, list)):
        donnees = {**donnees, "details": json.dumps(donnees["details"], ensure_ascii=False)}
    donnees = {k: v for k, v in donnees.items() if k in CHAMPS_ACTIVITE}

    if id_externe:
        existante = (
            db.query(Activite)
            .filter(Activite.utilisateur_id == user_id, Activite.source == source,
                    Activite.id_externe == str(id_externe))
            .first()
        )
        if existante:
            if not maj_si_existe:
                return existante, "inchange"
            if (existante.rpe is not None and not _rpe_estime(existante.details)
                    and _rpe_estime(donnees.get("details"))):
                # RPE déjà noté/confirmé : l'estimation Apple ne l'écrase pas
                det = json.loads(donnees["details"])
                det.pop("rpe_source", None)
                donnees = {**donnees, "details": json.dumps(det, ensure_ascii=False)}
                donnees.pop("rpe", None)
            for k, v in donnees.items():
                if v is None:
                    continue
                if (k == "debut" and _sans_heure(v) and not _sans_heure(existante.debut)
                        and v.date() == existante.debut.date()):
                    continue  # ne pas écraser une heure précise par minuit
                setattr(existante, k, v)
            return existante, "maj"

    debut = donnees.get("debut")
    if debut:
        fam = famille_sport(donnees.get("sport", "autre"))
        jour = datetime.combine(debut.date(), datetime.min.time())
        candidates = (
            db.query(Activite)
            .filter(Activite.utilisateur_id == user_id,
                    Activite.source != source,
                    Activite.debut >= min(jour, debut - timedelta(minutes=15)),
                    Activite.debut <= max(jour + timedelta(days=1), debut + timedelta(minutes=15)))
            .all()
        )
        for p in candidates:
            if famille_sport(p.sport) != fam:
                continue
            sans_heure = _sans_heure(debut) or _sans_heure(p.debut)
            if sans_heure:
                if p.debut.date() != debut.date():
                    continue
            elif abs((p.debut - debut).total_seconds()) > 15 * 60:
                continue
            heure_precise = _sans_heure(p.debut) and not _sans_heure(debut)
            for k, v in donnees.items():
                if v is not None and (getattr(p, k) in (None, "") or (k == "debut" and heure_precise)):
                    setattr(p, k, v)
            return p, "fusion"

    a = Activite(utilisateur_id=user_id, source=source,
                 id_externe=str(id_externe) if id_externe else None, **donnees)
    db.add(a)
    db.flush()
    return a, "cree"


# ---------------------------------------------------------------------------
# Statistiques
# ---------------------------------------------------------------------------

DISTANCES_RECORDS = [("5 km", 5.0), ("10 km", 10.0), ("Semi", 21.0975), ("Marathon", 42.195)]


def _lundi(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _agreger(acts: Iterable[Activite]) -> dict:
    acts = list(acts)
    return {
        "nb": len(acts),
        "distance_km": round(sum(a.distance_km or 0 for a in acts), 1),
        "duree_h": round(sum(a.duree_sec or 0 for a in acts) / 3600, 1),
        "dplus_m": int(sum(a.dplus_m or 0 for a in acts)),
        "charge": round(sum(charge(a) for a in acts)),
    }


def predire_temps(acts: list[Activite], distance_km: float, dplus_m: int = 0,
                  depuis: Optional[datetime] = None) -> Optional[dict]:
    """
    Prédiction par la formule de Riegel (T2 = T1 × (D2/D1)^1.06) à partir de
    la meilleure performance course/trail récente. Le dénivelé est converti en
    distance-effort (1 km-effort = 1 km + 100 m D+) pour comparer route et trail.
    """
    cible_effort = distance_km + (dplus_m or 0) / 100
    cible_route = (dplus_m or 0) / distance_km < 15
    candidates = [
        a for a in acts
        if a.sport in SPORTS_PIED and a.duree_sec and a.distance_km and a.distance_km >= 3
        and (not depuis or a.debut >= depuis)
    ]
    if cible_route:
        # Objectif route : la conversion D+ → km-effort flatte les sorties trail,
        # on s'appuie sur les sorties roulantes dès qu'il y en a.
        roulantes = [a for a in candidates if (a.dplus_m or 0) / a.distance_km < 15]
        candidates = roulantes or candidates
    meilleur = None
    for a in candidates:
        effort = a.distance_km + (a.dplus_m or 0) / 100
        t = a.duree_sec * (cible_effort / effort) ** 1.06
        if meilleur is None or t < meilleur["temps_sec"]:
            meilleur = {"temps_sec": int(t), "base_activite_id": a.id,
                        "base": f"{a.debut:%d/%m/%Y} — {a.distance_km:.1f} km en {fmt_duree(a.duree_sec)}"}
    if meilleur:
        meilleur["temps_str"] = fmt_duree(meilleur["temps_sec"])
    return meilleur


def calculer_stats(acts: list[Activite], aujourd_hui: Optional[date] = None, sport: Optional[str] = None) -> dict:
    aujourd_hui = aujourd_hui or date.today()
    if sport:
        acts = [a for a in acts if a.sport == sport]
    acts = sorted(acts, key=lambda a: a.debut)

    def depuis(jours: int):
        lim = datetime.combine(aujourd_hui - timedelta(days=jours - 1), datetime.min.time())
        return [a for a in acts if a.debut >= lim]

    debut_annee = datetime(aujourd_hui.year, 1, 1)
    debut_mois = datetime(aujourd_hui.year, aujourd_hui.month, 1)
    debut_sem = datetime.combine(_lundi(aujourd_hui), datetime.min.time())

    totaux = {
        "semaine": _agreger(a for a in acts if a.debut >= debut_sem),
        "mois": _agreger(a for a in acts if a.debut >= debut_mois),
        "annee": _agreger(a for a in acts if a.debut >= debut_annee),
        "total": _agreger(acts),
        "7j": _agreger(depuis(7)),
        "28j": _agreger(depuis(28)),
    }

    # Répartition par sport (12 derniers mois)
    par_sport = defaultdict(list)
    for a in depuis(365):
        par_sport[a.sport].append(a)
    repartition = sorted(
        ({"sport": s, "label": SPORTS.get(s, SPORTS["autre"])["label"], **_agreger(l)} for s, l in par_sport.items()),
        key=lambda x: -x["duree_h"],
    )

    # Séries hebdomadaires (26 semaines) et mensuelles (12 mois)
    lundi_courant = _lundi(aujourd_hui)
    semaines = []
    for i in range(25, -1, -1):
        lun = lundi_courant - timedelta(weeks=i)
        d0 = datetime.combine(lun, datetime.min.time())
        d1 = d0 + timedelta(days=7)
        sel = [a for a in acts if d0 <= a.debut < d1]
        ligne = {"semaine": lun.isoformat(), "label": f"{lun:%d/%m}", **_agreger(sel)}
        for s in SPORTS:
            ligne[f"h_{s}"] = round(sum(a.duree_sec or 0 for a in sel if a.sport == s) / 3600, 2)
        ligne["km_pied"] = round(sum(a.distance_km or 0 for a in sel if a.sport in SPORTS_PIED), 1)
        semaines.append(ligne)

    mois = []
    y, m = aujourd_hui.year, aujourd_hui.month
    for i in range(11, -1, -1):
        mm, yy = m - i, y
        while mm <= 0:
            mm += 12
            yy -= 1
        d0 = datetime(yy, mm, 1)
        d1 = datetime(yy + (mm == 12), mm % 12 + 1, 1)
        sel = [a for a in acts if d0 <= a.debut < d1]
        mois.append({"mois": f"{yy}-{mm:02d}", "label": f"{mm:02d}/{str(yy)[2:]}", **_agreger(sel),
                     "km_pied": round(sum(a.distance_km or 0 for a in sel if a.sport in SPORTS_PIED), 1)})

    # Charge aiguë / chronique (ACWR) — 7 j vs moyenne hebdo sur 28 j
    aigue = sum(charge(a) for a in depuis(7))
    chronique = sum(charge(a) for a in depuis(28)) / 4
    acwr = round(aigue / chronique, 2) if chronique else None
    if acwr is None:
        zone = None
    elif acwr < 0.8:
        zone = "sous-charge"
    elif acwr <= 1.3:
        zone = "optimale"
    elif acwr <= 1.5:
        zone = "vigilance"
    else:
        zone = "risque"

    # Allure et efficacité sur les sorties à pied
    allures = []
    for a in acts:
        if a.sport in SPORTS_PIED:
            al = allure_sec_km(a)
            if al:
                pt = {"date": a.debut.date().isoformat(), "allure_sec_km": round(al),
                      "distance_km": round(a.distance_km, 1), "fc": a.fc_moyenne_bpm, "sport": a.sport}
                if a.fc_moyenne_bpm:
                    # Indice d'efficacité : mètres parcourus par battement cardiaque
                    pt["efficacite"] = round((1000 / al) * 60 / a.fc_moyenne_bpm, 3)
                allures.append(pt)

    # Records
    pied = [a for a in acts if a.sport in SPORTS_PIED and a.distance_km and a.duree_sec]
    records_dist = []
    for label, d in DISTANCES_RECORDS:
        cands = [a for a in pied if d * 0.98 <= a.distance_km <= d * 1.15 and (a.dplus_m or 0) < 15 * d]
        if cands:
            best = min(cands, key=lambda a: a.duree_sec / a.distance_km)
            t = int(best.duree_sec / best.distance_km * d)
            records_dist.append({"label": label, "temps_sec": t, "temps_str": fmt_duree(t),
                                 "allure_str": fmt_allure(best.duree_sec / best.distance_km),
                                 "date": best.debut.date().isoformat(), "activite_id": best.id})

    def record(sel, cle, label, fmt):
        sel = [a for a in sel if getattr(a, cle)]
        if not sel:
            return None
        b = max(sel, key=lambda a: getattr(a, cle))
        return {"label": label, "valeur": fmt(getattr(b, cle)), "date": b.debut.date().isoformat(), "activite_id": b.id}

    records_autres = [r for r in [
        record(pied, "distance_km", "Plus longue sortie à pied", lambda v: f"{v:.1f} km"),
        record(acts, "dplus_m", "Plus gros D+", lambda v: f"{v} m"),
        record([a for a in acts if a.sport == "velo"], "distance_km", "Plus longue sortie vélo", lambda v: f"{v:.1f} km"),
        record(acts, "duree_sec", "Plus longue activité", fmt_duree),
    ] if r]

    # Régularité : semaines consécutives avec au moins une activité
    semaines_actives = {_lundi(a.debut.date()) for a in acts}
    serie, lun = 0, lundi_courant
    if lun not in semaines_actives:
        lun -= timedelta(weeks=1)  # la semaine en cours n'est pas finie
    while lun in semaines_actives:
        serie += 1
        lun -= timedelta(weeks=1)

    # Calendrier d'activité (365 j) : minutes par jour
    jours = defaultdict(int)
    for a in depuis(365):
        jours[a.debut.date().isoformat()] += int((a.duree_sec or 0) / 60) or 1

    return {
        "totaux": totaux,
        "repartition": repartition,
        "semaines": semaines,
        "mois": mois,
        "charge": {"aigue_7j": round(aigue), "chronique_hebdo": round(chronique), "acwr": acwr, "zone": zone},
        "allures": allures[-120:],
        "records": {"distances": records_dist, "autres": records_autres},
        "regularite": {
            "serie_semaines": serie,
            "jours_actifs_28j": len({a.debut.date() for a in depuis(28)}),
            "calendrier": dict(jours),
        },
        "premiere_activite": acts[0].debut.date().isoformat() if acts else None,
    }


# ---------------------------------------------------------------------------
# Objectifs
# ---------------------------------------------------------------------------

METRIQUES = {
    "distance_km": "km",
    "duree_h": "h",
    "dplus_m": "m D+",
    "nb_seances": "séances",
    "valeur_libre": None,
}


def progression_objectif(o: Objectif, acts: list[Activite], aujourd_hui: Optional[date] = None) -> dict:
    aujourd_hui = aujourd_hui or date.today()
    res = {
        "id": o.id, "type": o.type, "titre": o.titre, "sport": o.sport,
        "date_cible": o.date_cible.isoformat() if o.date_cible else None,
        "date_debut": o.date_debut.isoformat() if o.date_debut else None,
        "jours_restants": (o.date_cible - aujourd_hui).days if o.date_cible else None,
        "distance_km": o.distance_km, "dplus_m": o.dplus_m,
        "temps_cible_sec": o.temps_cible_sec, "temps_cible_str": fmt_duree(o.temps_cible_sec),
        "url": o.url, "metrique": o.metrique, "valeur_cible": o.valeur_cible,
        "valeur_actuelle_saisie": o.valeur_actuelle,
        "unite": o.unite or METRIQUES.get(o.metrique or ""),
        "statut": o.statut, "notes": o.notes,
        "resultat_temps_sec": o.resultat_temps_sec, "resultat_temps_str": fmt_duree(o.resultat_temps_sec),
    }

    if o.type == "course":
        if o.distance_km and o.temps_cible_sec:
            res["allure_cible_str"] = fmt_allure(o.temps_cible_sec / o.distance_km)
        if o.distance_km:
            pred = predire_temps(acts, o.distance_km, o.dplus_m or 0,
                                 depuis=datetime.combine(aujourd_hui - timedelta(days=120), datetime.min.time()))
            res["prediction"] = pred
            if pred and o.temps_cible_sec:
                res["ecart_sec"] = pred["temps_sec"] - o.temps_cible_sec
        # Volume à pied des 4 dernières semaines (repère de préparation)
        lim = datetime.combine(aujourd_hui - timedelta(days=27), datetime.min.time())
        km4 = sum(a.distance_km or 0 for a in acts if a.sport in SPORTS_PIED and a.debut >= lim)
        res["km_hebdo_4sem"] = round(km4 / 4, 1)
        longues = [a.distance_km for a in acts if a.sport in SPORTS_PIED and a.debut >= lim and a.distance_km]
        res["plus_longue_4sem_km"] = round(max(longues), 1) if longues else None
        return res

    # Objectif perso : cumul de la métrique sur la période
    d0 = o.date_debut or (o.cree_le.date() if o.cree_le else aujourd_hui)
    d1 = o.date_cible or aujourd_hui
    sel = [a for a in acts if d0 <= a.debut.date() <= d1 and (not o.sport or a.sport == o.sport)]
    if o.metrique == "distance_km":
        val = sum(a.distance_km or 0 for a in sel)
    elif o.metrique == "duree_h":
        val = sum(a.duree_sec or 0 for a in sel) / 3600
    elif o.metrique == "dplus_m":
        val = sum(a.dplus_m or 0 for a in sel)
    elif o.metrique == "nb_seances":
        val = len(sel)
    else:
        val = o.valeur_actuelle or 0
    res["valeur_actuelle"] = round(val, 1)
    if o.valeur_cible:
        res["pourcentage"] = round(100 * val / o.valeur_cible, 1)
        if o.metrique != "valeur_libre" and o.date_cible:
            ecoules = max(1, (min(aujourd_hui, d1) - d0).days + 1)
            total = max(1, (d1 - d0).days + 1)
            res["projection"] = round(val / ecoules * total, 1)
            res["attendu_a_date"] = round(o.valeur_cible * ecoules / total, 1)
    return res


# ---------------------------------------------------------------------------
# Export (Markdown pour Claude, JSON, CSV)
# ---------------------------------------------------------------------------

def _profil(db: Session, user: Utilisateur) -> dict:
    # Dernière VMA mesurée par l'ancien programme (table conservée en base, non mappée)
    vma = None
    try:
        with db.begin_nested():
            vma = db.execute(text(
                "SELECT vma_kmh FROM biometries_utilisateurs WHERE utilisateur_id = :u "
                "ORDER BY enregistre_le DESC LIMIT 1"), {"u": user.id}).scalar()
    except Exception:
        vma = None
    age = None
    if user.date_naissance:
        t = date.today()
        dn = user.date_naissance
        age = t.year - dn.year - ((t.month, t.day) < (dn.month, dn.day))
    return {
        "prenom": user.prenom, "sexe": user.sexe, "age": age, "poids_kg": user.poids_kg,
        "fc_max": user.fc_max, "fc_repos": user.fc_repos,
        "vma_kmh": round(vma, 1) if vma else None,
    }


def construire_export(db: Session, user: Utilisateur) -> dict:
    acts = (
        db.query(Activite).filter(Activite.utilisateur_id == user.id)
        .order_by(Activite.debut.desc()).all()
    )
    objectifs = (
        db.query(Objectif).filter(Objectif.utilisateur_id == user.id)
        .order_by(Objectif.date_cible.is_(None), Objectif.date_cible).all()
    )
    stats = calculer_stats(acts)
    return {
        "genere_le": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "profil": _profil(db, user),
        "objectifs": [progression_objectif(o, acts) for o in objectifs],
        "stats": {k: v for k, v in stats.items() if k not in ("allures",)},
        "forme": series_mesures(db, user.id),
        "plan": lister_plan(db, user.id, date.today() - timedelta(days=28), date.today() + timedelta(days=42)),
        "activites":[serialiser_activite(a) for a in acts],
    }


def _cell(v) -> str:
    if v is None or v == "":
        return ""
    return re.sub(r"[\r\n|]+", " ", str(v)).strip()


def export_markdown(data: dict) -> str:
    p = data["profil"]
    l = ["# Carnet d'entraînement — export pour analyse", "",
         f"_Généré le {data['genere_le']}. Données complètes : profil, objectifs, statistiques agrégées et liste exhaustive des activités._", ""]

    l += ["## Profil", ""]
    if not any(p.get(k) is not None for k in ("age", "sexe", "poids_kg", "fc_max", "fc_repos", "vma_kmh")):
        l.append("_Non renseigné._")
    for k, lab in [("age", "Âge"), ("sexe", "Sexe"), ("poids_kg", "Poids (kg)"), ("fc_max", "FC max (bpm)"),
                   ("fc_repos", "FC repos (bpm)"), ("vma_kmh", "VMA (km/h)")]:
        if p.get(k) is not None:
            l.append(f"- {lab} : {p[k]}")
    l.append("")

    l += ["## Objectifs", ""]
    if not data["objectifs"]:
        l.append("_Aucun objectif enregistré._")
    for o in data["objectifs"]:
        if o["type"] == "course":
            ligne = f"- **{o['titre']}** (course, {o['statut']}) — {o.get('date_cible') or 'date ?'}"
            if o.get("distance_km"):
                ligne += f", {o['distance_km']} km"
            if o.get("dplus_m"):
                ligne += f", {o['dplus_m']} m D+"
            if o.get("temps_cible_str"):
                ligne += f", objectif {o['temps_cible_str']} ({o.get('allure_cible_str') or ''})"
            if o.get("prediction"):
                ligne += f" · prédiction actuelle {o['prediction']['temps_str']} (base : {o['prediction']['base']})"
            if o.get("resultat_temps_str"):
                ligne += f" · résultat {o['resultat_temps_str']}"
        else:
            ligne = (f"- **{o['titre']}** (perso, {o['statut']}) — {o.get('valeur_actuelle')} / {o.get('valeur_cible')} "
                     f"{o.get('unite') or ''} ({o.get('pourcentage', '?')} %), période {o.get('date_debut') or '?'} → {o.get('date_cible') or '?'}")
            if o.get("projection") is not None:
                ligne += f", projection fin de période {o['projection']}"
        l.append(ligne)
        if o.get("notes"):
            l.append(f"  - Notes : {_cell(o['notes'])}")
    l.append("")

    s = data["stats"]
    l += ["## Synthèse", "", "| Période | Séances | Distance (km) | Durée (h) | D+ (m) | Charge (min×RPE) |",
          "|---|---|---|---|---|---|"]
    for k, lab in [("semaine", "Semaine en cours"), ("28j", "28 derniers jours"), ("mois", "Mois en cours"),
                   ("annee", "Année en cours"), ("total", "Depuis le début")]:
        t = s["totaux"][k]
        l.append(f"| {lab} | {t['nb']} | {t['distance_km']} | {t['duree_h']} | {t['dplus_m']} | {t['charge']} |")
    c = s["charge"]
    l += ["", f"- Ratio charge aiguë/chronique (ACWR) : {c['acwr']} ({c['zone']})",
          f"- Semaines consécutives actives : {s['regularite']['serie_semaines']}",
          f"- Jours actifs sur 28 j : {s['regularite']['jours_actifs_28j']}", ""]

    if s["records"]["distances"] or s["records"]["autres"]:
        l += ["### Records", ""]
        for r in s["records"]["distances"]:
            l.append(f"- {r['label']} : {r['temps_str']} ({r['allure_str']}) le {r['date']}")
        for r in s["records"]["autres"]:
            l.append(f"- {r['label']} : {r['valeur']} le {r['date']}")
        l.append("")

    l += ["### Répartition par sport (12 mois)", "", "| Sport | Séances | Distance (km) | Durée (h) | D+ (m) |", "|---|---|---|---|---|"]
    for r in s["repartition"]:
        l.append(f"| {r['label']} | {r['nb']} | {r['distance_km']} | {r['duree_h']} | {r['dplus_m']} |")
    l.append("")

    l += ["### Volume hebdomadaire (26 semaines)", "", "| Semaine du | Séances | km à pied | Durée (h) | D+ (m) | Charge |", "|---|---|---|---|---|---|"]
    for w in s["semaines"]:
        l.append(f"| {w['semaine']} | {w['nb']} | {w['km_pied']} | {w['duree_h']} | {w['dplus_m']} | {w['charge']} |")
    l.append("")

    forme = data.get("forme") or {}
    if any(forme.get(k, {}).get("points") for k in MESURES):
        l += ["## Forme (Apple Santé)", "",
              "| Mesure | Dernière valeur | Moyenne 7 j | Moyenne 28 j | Moyenne 90 j |", "|---|---|---|---|---|"]
        for k, m in MESURES.items():
            f = forme.get(k) or {}
            if f.get("points"):
                d = f["derniere"]
                l.append(f"| {m['label']} ({m['unite']}) | {d['valeur']} ({d['jour']}) | {f['moy_7j']} | {f['moy_28j']} | {f['moy_90j']} |")
        l += ["", "### Mesures hebdomadaires (moyennes)", "",
              "| Semaine du | " + " | ".join(m["label"] for m in MESURES.values()) + " |",
              "|---" * (len(MESURES) + 1) + "|"]
        semaines = sorted({w for k in MESURES for w in (forme.get(k) or {}).get("hebdo", {})}, reverse=True)
        for w in semaines[:26]:
            l.append(f"| {w} | " + " | ".join(_cell((forme.get(k) or {}).get("hebdo", {}).get(w)) for k in MESURES) + " |")
        l.append("")

    plan = data.get("plan") or []
    if plan:
        libelle = {"realisee": "réalisée", "sautee": "sautée", "a_venir": "à venir",
                   "aujourdhui": "aujourd'hui", "manquee": "non faite"}
        l += ["## Plan (4 semaines passées → 6 semaines à venir)", "",
              "| Date | Sport | Séance | Prévu | RPE cible | Statut | Réalisé | Commentaire | id_externe |",
              "|---|---|---|---|---|---|---|---|---|"]
        for p in plan:
            prevu = " · ".join(x for x in [
                f"{p['duree_min']} min" if p["duree_min"] else "",
                f"{p['distance_km']:g} km" if p["distance_km"] else "",
                f"{p['dplus_m']} m D+" if p["dplus_m"] else "",
            ] if x)
            a = p["activite"]
            fait = ""
            if a:
                fait = " · ".join(str(x) for x in [a["duree_str"], f"{a['distance_km']} km" if a["distance_km"] else "",
                                                   a["allure_str"], f"FC {a['fc_moyenne_bpm']}" if a["fc_moyenne_bpm"] else "",
                                                   f"RPE {a['rpe']:g}" if a["rpe"] is not None else ""] if x)
            seance = p["titre"] + (f" — {p['description'][:240]}" if p["description"] else "")
            l.append("| " + " | ".join(_cell(x) for x in [
                p["jour"], p["sport_label"], seance, prevu,
                f"{p['rpe_cible']:g}" if p["rpe_cible"] is not None else None, libelle.get(p["statut"], p["statut"]),
                fait, p["commentaire"], p["id_externe"],
            ]) + " |")
        l.append("")

    l += [f"## Activités ({len(data['activites'])})", "",
          "_RPE suivi de « (est.) » : effort estimé par l'Apple Watch, non noté par l'athlète._", "",
          "| Date | Sport | Titre | Durée | Distance (km) | D+ (m) | Allure / vitesse | FC moy | FC max | RPE | Compét. | Notes |",
          "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for a in data["activites"]:
        vit = a["allure_str"] or (f"{a['vitesse_kmh']} km/h" if a["vitesse_kmh"] else "")
        rpe = a["rpe"]
        if rpe is not None and a.get("rpe_estime"):
            rpe = f"{rpe:g} (est.)"
        l.append("| " + " | ".join(_cell(x) for x in [
            (a["debut"] or "")[:16].replace("T", " "), a["sport_label"], a["titre"], a["duree_str"], a["distance_km"],
            a["dplus_m"], vit, a["fc_moyenne_bpm"], a["fc_max_bpm"], rpe, "oui" if a["est_competition"] else "",
            a["notes"],
        ]) + " |")
    l.append("")
    return "\n".join(l)


def export_csv(data: dict) -> str:
    buf = io.StringIO()
    cols = ["debut", "sport", "titre", "duree_sec", "distance_km", "dplus_m", "allure_str", "vitesse_kmh",
            "fc_moyenne_bpm", "fc_max_bpm", "calories", "rpe", "ressenti", "est_competition", "source", "notes"]
    w = csv.writer(buf, delimiter=";")
    w.writerow(cols)
    for a in data["activites"]:
        w.writerow([_cell(a.get(c)) for c in cols])
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Import de fichiers CSV (export Strava « activities.csv » ou CSV générique)
# ---------------------------------------------------------------------------

def _num(v) -> Optional[float]:
    if v is None:
        return None
    v = str(v).strip().replace(",", ".").replace(" ", "").replace(" ", "")
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _date_souple(v: str) -> Optional[datetime]:
    v = (v or "").strip()
    for f in ("%b %d, %Y, %I:%M:%S %p", "%d %b %Y, %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S",
              "%Y-%m-%d %H:%M", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(v, f)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(v.replace("Z", "")).replace(tzinfo=None)
    except ValueError:
        return None


def parser_csv(contenu: str) -> tuple[str, list[tuple[Optional[str], dict]]]:
    """
    Reconnaît l'export Strava (activities.csv, colonnes anglaises ou françaises)
    et le CSV générique du carnet. Retourne (source, [(id_externe, données)]).
    """
    echantillon = contenu.split("\n", 1)[0]  # en-tête seul : les détails JSON contiennent des virgules
    delim = ";" if echantillon.count(";") > echantillon.count(",") else ","
    lecteur = csv.reader(io.StringIO(contenu), delimiter=delim)
    entetes = next(lecteur, [])
    norm = [_sans_accents(h).strip() for h in entetes]

    def idx(*noms):
        for n in noms:
            if n in norm:
                return norm.index(n)
        return None

    i_id = idx("activity id", "id de l'activite")
    strava = i_id is not None
    if not strava:
        i_id = idx("id_externe")
    i_date = idx("activity date", "date de l'activite", "debut", "date")
    i_nom = idx("activity name", "nom de l'activite", "titre")
    i_type = idx("activity type", "type d'activite", "sport")
    i_desc = idx("activity description", "description de l'activite", "notes")
    # Strava répète « Elapsed Time » et « Distance » : la 2e occurrence est en secondes/mètres
    i_moving = idx("moving time", "temps de deplacement", "duree_sec")
    i_duree_min = None if strava else idx("duree_min")
    i_dist = [k for k, n in enumerate(norm) if n in ("distance", "distance_km")]
    i_dplus = idx("elevation gain", "denivele positif", "dplus_m")
    i_fcm = idx("average heart rate", "frequence cardiaque moyenne", "fc_moyenne_bpm")
    i_fcx = idx("max heart rate", "frequence cardiaque max", "fc_max_bpm")
    i_cal = idx("calories")
    i_rpe = idx("perceived exertion", "effort percu", "rpe")
    i_comp = idx("commute", "est_competition")
    i_details = None if strava else idx("details")

    lignes = []
    for row in lecteur:
        if not row or i_date is None or i_date >= len(row):
            continue
        get = lambda i: row[i] if i is not None and i < len(row) else None
        debut = _date_souple(get(i_date))
        if not debut:
            continue
        dist = None
        if i_dist:
            if strava and len(i_dist) > 1:
                m = _num(get(i_dist[1]))
                dist = m / 1000 if m else None
            else:
                dist = _num(get(i_dist[0]))
        duree = _num(get(i_moving))
        if not duree and _num(get(i_duree_min)):
            duree = _num(get(i_duree_min)) * 60
        rpe = _num(get(i_rpe))
        donnees = {
            "sport": normaliser_sport(get(i_type)),
            "titre": get(i_nom) or None,
            "debut": debut,
            "duree_sec": int(duree) if duree else None,
            "distance_km": round(dist, 3) if dist else None,
            "dplus_m": int(_num(get(i_dplus))) if _num(get(i_dplus)) else None,
            "fc_moyenne_bpm": int(_num(get(i_fcm))) if _num(get(i_fcm)) else None,
            "fc_max_bpm": int(_num(get(i_fcx))) if _num(get(i_fcx)) else None,
            "calories": int(_num(get(i_cal))) if _num(get(i_cal)) else None,
            "rpe": rpe if rpe and 1 <= rpe <= 10 else None,
            "notes": get(i_desc) or None,
        }
        if not strava and i_comp is not None:
            donnees["est_competition"] = str(get(i_comp)).strip().lower() in ("1", "true", "oui", "vrai")
        if get(i_details):
            try:
                donnees["details"] = json.loads(get(i_details))
            except ValueError:
                pass
        lignes.append(((get(i_id) or "").strip() or None, donnees))
    return ("strava" if strava else "fichier"), lignes


# ---------------------------------------------------------------------------
# Mesures de forme (FC au repos, VFC, VO2max) — une valeur par jour
# ---------------------------------------------------------------------------

MESURES = {
    "fc_repos": {"label": "FC au repos", "unite": "bpm", "min": 25, "max": 120},
    "vfc":      {"label": "VFC (SDNN)",  "unite": "ms",  "min": 5,  "max": 300},
    "vo2max":   {"label": "VO2max",      "unite": "ml/kg/min", "min": 15, "max": 95},
}
_ALIAS_MESURES = {
    "fc_repos": "fc_repos", "fcrepos": "fc_repos", "restingheartrate": "fc_repos", "fc_au_repos": "fc_repos",
    "vfc": "vfc", "hrv": "vfc", "heartratevariabilitysdnn": "vfc", "variabilite": "vfc",
    "vo2max": "vo2max", "vo2": "vo2max",
}


def normaliser_mesure(t: Optional[str]) -> Optional[str]:
    cle = re.sub(r"[^a-z0-9_]", "", _sans_accents(str(t or "")).lower().replace(" ", "_").replace("hkquantitytypeidentifier", ""))
    return _ALIAS_MESURES.get(cle) or _ALIAS_MESURES.get(cle.replace("_", ""))


def importer_mesures(db: Session, user_id: int, items: Iterable[tuple[str, date, float]]) -> dict:
    """Ajoute ou remplace des mesures journalières (clé : type + jour)."""
    bilan = {"cree": 0, "maj": 0, "ignore": 0}
    vus: dict[tuple[str, date], MesureSante] = {}
    for t, jour, valeur in items:
        t = normaliser_mesure(t)
        if not t or valeur is None or not (MESURES[t]["min"] <= valeur <= MESURES[t]["max"]):
            bilan["ignore"] += 1
            continue
        m = vus.get((t, jour)) or (
            db.query(MesureSante)
            .filter(MesureSante.utilisateur_id == user_id, MesureSante.type == t, MesureSante.jour == jour)
            .first()
        )
        if m:
            m.valeur = round(valeur, 1)
            bilan["maj"] += 1
        else:
            m = MesureSante(utilisateur_id=user_id, type=t, jour=jour, valeur=round(valeur, 1))
            db.add(m)
            bilan["cree"] += 1
        vus[(t, jour)] = m
    db.flush()
    return bilan


def parser_csv_mesures(contenu: str) -> Optional[list[tuple[str, date, float]]]:
    """CSV « date;type;valeur ». Retourne None si le fichier n'a pas ce format."""
    entete = contenu.split("\n", 1)[0]
    delim = ";" if entete.count(";") >= entete.count(",") else ","
    lecteur = csv.reader(io.StringIO(contenu), delimiter=delim)
    cols = [_sans_accents(c).strip().lower() for c in next(lecteur, [])]
    if not {"date", "type", "valeur"} <= set(cols):
        return None
    i_d, i_t, i_v = cols.index("date"), cols.index("type"), cols.index("valeur")
    items = []
    for r in lecteur:
        if len(r) <= max(i_d, i_t, i_v):
            continue
        d = _date_souple(r[i_d])
        if d:
            items.append((r[i_t], d.date(), _num(r[i_v])))
    return items


def series_mesures(db: Session, user_id: int, jours: int = 365, aujourd_hui: Optional[date] = None) -> dict:
    """Pour chaque mesure : points journaliers, moyennes 7/28/90 j, moyennes hebdomadaires."""
    auj = aujourd_hui or date.today()
    rows = (
        db.query(MesureSante)
        .filter(MesureSante.utilisateur_id == user_id, MesureSante.jour > auj - timedelta(days=jours))
        .order_by(MesureSante.jour).all()
    )
    moy = lambda xs: round(sum(xs) / len(xs), 1) if xs else None
    out = {}
    for t, info in MESURES.items():
        pts = [(r.jour, r.valeur) for r in rows if r.type == t]
        hebdo = defaultdict(list)
        for j, v in pts:
            hebdo[(j - timedelta(days=j.weekday())).isoformat()].append(v)
        fen = lambda n: moy([v for j, v in pts if j > auj - timedelta(days=n)])
        out[t] = {
            **info,
            "points": [{"jour": j.isoformat(), "valeur": v} for j, v in pts],
            "derniere": {"jour": pts[-1][0].isoformat(), "valeur": pts[-1][1]} if pts else None,
            "moy_7j": fen(7), "moy_28j": fen(28), "moy_90j": fen(90),
            "hebdo": {w: moy(vs) for w, vs in sorted(hebdo.items())},
        }
    return out


# ---------------------------------------------------------------------------
# Plan : séances prévues et rapprochement avec les activités réalisées
# ---------------------------------------------------------------------------

CHAMPS_PREVUE = ("jour", "ordre", "sport", "titre", "description", "duree_min", "distance_km",
                 "dplus_m", "rpe_cible", "objectif_id")


def _candidates(prevue: SeancePrevue, acts: list[Activite], prises: set[int]) -> list[Activite]:
    """Activités du même jour et de la même famille de sport, pas déjà rattachées.
    Une activité de moins de 40 % de la durée prévue (ex. vélotaf pour une sortie
    longue) n'est pas retenue."""
    res = []
    for a in acts:
        if a.id in prises or a.debut.date() != prevue.jour:
            continue
        if famille_sport(a.sport) != famille_sport(prevue.sport):
            continue
        if prevue.duree_min and a.duree_sec and a.duree_sec < prevue.duree_min * 60 * 0.4:
            continue
        res.append(a)
    return res


def rapprocher_plan(db: Session, user_id: int, aujourd_hui: Optional[date] = None, jours: int = 60) -> int:
    """Relie automatiquement les séances prévues passées à l'activité réalisée.
    Retourne le nombre de nouveaux rapprochements."""
    auj = aujourd_hui or date.today()
    debut = auj - timedelta(days=jours)
    prevues = (
        db.query(SeancePrevue)
        .filter(SeancePrevue.utilisateur_id == user_id, SeancePrevue.jour >= debut, SeancePrevue.jour <= auj)
        .order_by(SeancePrevue.jour, SeancePrevue.ordre, SeancePrevue.id).all()
    )
    a_relier = [p for p in prevues if p.activite_id is None and not p.lien_manuel and p.statut != "sautee"]
    if not a_relier:
        return 0
    acts = (
        db.query(Activite)
        .filter(Activite.utilisateur_id == user_id,
                Activite.debut >= datetime.combine(debut, datetime.min.time()),
                Activite.debut < datetime.combine(auj + timedelta(days=1), datetime.min.time()))
        .all()
    )
    prises = {p.activite_id for p in prevues if p.activite_id}
    n = 0
    for p in a_relier:
        cand = _candidates(p, acts, prises)
        if not cand:
            continue
        cible = (p.duree_min or 0) * 60
        a = min(cand, key=lambda a: abs((a.duree_sec or 0) - cible)) if cible else max(cand, key=lambda a: a.duree_sec or 0)
        p.activite_id = a.id
        prises.add(a.id)
        n += 1
    db.flush()
    return n


def statut_prevue(p: SeancePrevue, aujourd_hui: Optional[date] = None) -> str:
    auj = aujourd_hui or date.today()
    if p.activite_id:
        return "realisee"
    if p.statut == "sautee":
        return "sautee"
    if p.jour > auj:
        return "a_venir"
    return "aujourdhui" if p.jour == auj else "manquee"


def serialiser_prevue(p: SeancePrevue, activite: Optional[Activite] = None,
                      aujourd_hui: Optional[date] = None) -> dict:
    info = SPORTS.get(p.sport, SPORTS["autre"])
    d = {
        "id": p.id, "id_externe": p.id_externe, "jour": p.jour.isoformat(), "ordre": p.ordre,
        "sport": p.sport, "sport_label": info["label"], "emoji": info["emoji"],
        "titre": p.titre, "description": p.description, "duree_min": p.duree_min,
        "distance_km": p.distance_km, "dplus_m": p.dplus_m, "rpe_cible": p.rpe_cible,
        "objectif_id": p.objectif_id, "commentaire": p.commentaire, "lien_manuel": bool(p.lien_manuel),
        "statut": statut_prevue(p, aujourd_hui), "activite": None,
    }
    if activite:
        d["activite"] = serialiser_activite(activite)
    return d


def lister_plan(db: Session, user_id: int, depuis: date, jusqu_a: date,
                aujourd_hui: Optional[date] = None) -> list[dict]:
    rapprocher_plan(db, user_id, aujourd_hui)
    prevues = (
        db.query(SeancePrevue)
        .filter(SeancePrevue.utilisateur_id == user_id, SeancePrevue.jour >= depuis, SeancePrevue.jour <= jusqu_a)
        .order_by(SeancePrevue.jour, SeancePrevue.ordre, SeancePrevue.id).all()
    )
    ids = [p.activite_id for p in prevues if p.activite_id]
    acts = {a.id: a for a in db.query(Activite).filter(Activite.id.in_(ids)).all()} if ids else {}
    return [serialiser_prevue(p, acts.get(p.activite_id), aujourd_hui) for p in prevues]


def enregistrer_plan(db: Session, user_id: int, items: list[dict],
                     remplacer: Optional[tuple[date, date]] = None,
                     aujourd_hui: Optional[date] = None) -> dict:
    """
    Crée ou met à jour des séances prévues (clé : id_externe).
    Le statut, le rapprochement et le commentaire de l'athlète sont conservés.
    `remplacer=(depuis, jusqu_a)` supprime les séances de la période absentes de
    l'envoi, sauf celles déjà passées, réalisées ou sautées (l'historique reste).
    """
    auj = aujourd_hui or date.today()
    bilan = {"cree": 0, "maj": 0, "supprime": 0}
    envoyes: set[str] = set()
    for x in items:
        id_ext = x.get("id_externe") or f"{x['jour'].isoformat()}-{x['sport']}-{x.get('ordre') or 0}"
        envoyes.add(id_ext)
        p = (db.query(SeancePrevue)
             .filter(SeancePrevue.utilisateur_id == user_id, SeancePrevue.id_externe == id_ext).first())
        if p:
            if p.jour != x["jour"] and not p.lien_manuel:
                p.activite_id = None  # séance déplacée : le rapprochement sera recalculé
            bilan["maj"] += 1
        else:
            p = SeancePrevue(utilisateur_id=user_id, id_externe=id_ext, statut="prevue")
            db.add(p)
            bilan["cree"] += 1
        for k in CHAMPS_PREVUE:
            if k in x:
                setattr(p, k, x[k])
        if p.ordre is None:
            p.ordre = 0
    if remplacer:
        depuis, jusqu_a = remplacer
        for p in (db.query(SeancePrevue)
                  .filter(SeancePrevue.utilisateur_id == user_id,
                          SeancePrevue.jour >= max(depuis, auj), SeancePrevue.jour <= jusqu_a).all()):
            if p.id_externe not in envoyes and p.activite_id is None and p.statut != "sautee":
                db.delete(p)
                bilan["supprime"] += 1
    db.flush()
    return bilan
