"""
Vues dans le temps du carnet :
- bilan d'une semaine ou d'un mois (volume, intensité, charge, sommeil, faits marquants, comparaisons) ;
- calendrier d'un mois (séances faites et prévues, charge du jour, marqueurs) ;
- séries et jalons (semaines actives d'affilée, cumul de l'année, paliers franchis) ;
- exploration (kilomètres de chemins parcourus pour la première fois, mois par mois).
"""
from __future__ import annotations

import calendar
import json
import math
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

import analyses_service as an
import carnet_service as cs
import corps_service as co
import suivi_service as sv
from bilan_service import JOURS, MOIS
from models import Activite, MesureSante, Objectif, SeancePrevue, TraceGPS, Utilisateur


def _tous(db: Session, user_id: int) -> list[Activite]:
    return db.query(Activite).filter(Activite.utilisateur_id == user_id).order_by(Activite.debut).all()


def _totaux(acts: list[Activite]) -> dict:
    return {
        "km": round(sum(a.distance_km or 0 for a in acts), 1),
        "duree_sec": int(sum(a.duree_sec or 0 for a in acts)),
        "dplus_m": int(sum(a.dplus_m or 0 for a in acts)),
        "nb": len(acts),
        "charge": round(sum(cs.charge(a) for a in acts)),
    }


def _entre(acts: list[Activite], debut: date, fin: date) -> list[Activite]:
    return [a for a in acts if debut <= a.debut.date() <= fin]


def _breve(a: Activite) -> dict:
    t = cs.type_seance(cs._details_dict(a))
    return {"id": a.id, "titre": a.titre, "sport": a.sport, "date": a.debut.date().isoformat(),
            "distance_km": a.distance_km, "dplus_m": a.dplus_m, "duree_sec": a.duree_sec,
            "charge": round(cs.charge(a)), "type": t["label"] if t else None}


# ---------------------------------------------------------------------------
# Bilan d'une semaine ou d'un mois
# ---------------------------------------------------------------------------

def _bornes(type_: str, ref: Optional[str], auj: date) -> tuple[date, date]:
    if type_ == "mois":
        a, m = (int(ref[:4]), int(ref[5:7])) if ref else (auj.year, auj.month)
        m = min(12, max(1, m))
        return date(a, m, 1), date(a, m, calendar.monthrange(a, m)[1])
    d = cs._lundi(date.fromisoformat(ref) if ref and len(ref) == 10 else auj)
    return d, d + timedelta(days=6)


def _precedente(type_: str, debut: date) -> tuple[date, date]:
    if type_ == "mois":
        f = debut - timedelta(days=1)
        return f.replace(day=1), f
    return debut - timedelta(days=7), debut - timedelta(days=1)


def _suivante(type_: str, fin: date) -> date:
    return fin + timedelta(days=1)


def _ref(type_: str, debut: date) -> str:
    return debut.isoformat()[:7] if type_ == "mois" else debut.isoformat()


def _libelle(type_: str, debut: date, fin: date) -> str:
    if type_ == "mois":
        return f"{MOIS[debut.month - 1].capitalize()} {debut.year}"
    q = lambda d: "1er" if d.day == 1 else str(d.day)  # noqa: E731
    if debut.month == fin.month:
        return f"Semaine du {q(debut)} au {q(fin)} {MOIS[fin.month - 1]} {fin.year}"
    return f"Semaine du {q(debut)} {MOIS[debut.month - 1]} au {q(fin)} {MOIS[fin.month - 1]} {fin.year}"


def _intensite(acts: list[Activite]) -> Optional[dict]:
    """Minutes faciles (Z1–Z2), modérées (Z3) et dures (Z4–Z5). Sans zones cardiaques, la séance entière
    est rangée d'après l'effort ressenti (≤ 4 facile, 5–6 modéré, ≥ 7 dur)."""
    m = {"facile": 0.0, "modere": 0.0, "dur": 0.0}
    par_fc = par_rpe = sans = 0
    for a in acts:
        zones = cs._details_dict(a).get("zones_fc")
        if isinstance(zones, list) and len(zones) == 5 and sum(z.get("min_passees") or 0 for z in zones) > 0:
            z = [x.get("min_passees") or 0 for x in zones]
            m["facile"] += z[0] + z[1]
            m["modere"] += z[2]
            m["dur"] += z[3] + z[4]
            par_fc += 1
        elif a.rpe and a.duree_sec:
            m["facile" if a.rpe <= 4 else "modere" if a.rpe <= 6 else "dur"] += a.duree_sec / 60
            par_rpe += 1
        elif a.duree_sec:
            sans += 1
    total = sum(m.values())
    if total <= 0:
        return None
    return {**{f"{k}_min": round(v) for k, v in m.items()},
            **{f"{k}_pct": round(100 * v / total) for k, v in m.items()},
            "par_fc": par_fc, "par_rpe": par_rpe, "non_classees": sans}


def _sommeil(db: Session, user_id: int, debut: date, fin: date) -> Optional[dict]:
    v = [x for (x,) in db.query(MesureSante.valeur).filter(
        MesureSante.utilisateur_id == user_id, MesureSante.type == "sommeil",
        MesureSante.jour >= debut, MesureSante.jour <= fin).all()]
    return {"moyenne_h": round(sum(v) / len(v), 2), "nuits": len(v), "courtes": sum(1 for x in v if x < 6.5)} if v else None


def _faits(db: Session, user: Utilisateur, tous: list[Activite], acts: list[Activite],
           debut: date, fin: date, type_: str, auj: date) -> list[dict]:
    faits: list[dict] = []
    # Records de course battus dans la période
    for label, suite in sv._historique_records(tous).items():
        dans = [i for i, r in enumerate(suite) if debut.isoformat() <= r["date"] <= fin.isoformat()]
        if dans:
            r, avant = suite[dans[-1]], suite[dans[0] - 1] if dans[0] > 0 else None
            gain = avant["temps_sec"] - r["temps_sec"] if avant else None
            faits.append({"cle": f"record-{label}", "ico": "🥇", "titre": f"Record sur {label}",
                          "sous": f"{r['titre'] or 'Sortie'} · {r['allure_str']}",
                          "valeur": r["temps_str"], "detail": f"−{cs.fmt_duree(gain)}" if gain else "premier",
                          "activite_id": r["activite_id"], "record": True})
    dist = [a for a in acts if a.distance_km]
    if dist:
        a = max(dist, key=lambda x: x.distance_km)
        faits.append({"cle": "longue", "ico": cs.SPORTS.get(a.sport, cs.SPORTS["autre"])["emoji"], "titre": "Plus longue sortie",
                      "sous": a.titre or cs.SPORTS.get(a.sport, cs.SPORTS["autre"])["label"],
                      "valeur": f"{a.distance_km:.1f} km".replace(".", ","),
                      "detail": cs.fmt_duree(a.duree_sec), "activite_id": a.id})
        grimpe = max((x for x in acts if x.dplus_m), key=lambda x: x.dplus_m, default=None)
        if grimpe and grimpe.id != a.id and grimpe.dplus_m >= 200:
            faits.append({"cle": "dplus", "ico": "⛰️", "titre": "Plus gros dénivelé",
                          "sous": grimpe.titre or "Sortie", "valeur": f"{grimpe.dplus_m} m",
                          "detail": f"{grimpe.distance_km:.1f} km".replace(".", ",") if grimpe.distance_km else None,
                          "activite_id": grimpe.id})
    if acts:
        dure = max(acts, key=cs.charge)
        if cs.charge(dure) > 0 and dure.rpe and dure.rpe >= 7 and all(f.get("activite_id") != dure.id for f in faits):
            faits.append({"cle": "dure", "ico": "🔥", "titre": "Séance la plus exigeante",
                          "sous": dure.titre or "Séance", "valeur": f"effort {dure.rpe}/10",
                          "detail": cs.fmt_duree(dure.duree_sec), "activite_id": dure.id})
    if type_ == "mois" and acts:
        sem: dict[date, list[Activite]] = defaultdict(list)
        for a in acts:
            sem[cs._lundi(a.debut.date())].append(a)
        lundi, lot = max(sem.items(), key=lambda kv: sum(x.duree_sec or 0 for x in kv[1]))
        t = _totaux(lot)
        faits.append({"cle": "semaine", "ico": "📈", "titre": "Plus grosse semaine",
                      "sous": f"du {lundi.day} {MOIS[lundi.month - 1]} · {t['nb']} séance{'s' if t['nb'] > 1 else ''}",
                      "valeur": cs.fmt_duree(t["duree_sec"]),
                      "detail": f"{t['km']:.0f} km" if t["km"] >= 1 else None, "ref_semaine": lundi.isoformat()})
    # Plan suivi
    prevues = (db.query(SeancePrevue).filter(SeancePrevue.utilisateur_id == user.id,
                                             SeancePrevue.jour >= debut, SeancePrevue.jour <= fin).all())
    if prevues:
        c = Counter(cs.statut_prevue(p, auj) for p in prevues)
        passees = c["realisee"] + c["sautee"] + c["manquee"]
        if passees:
            reste = c["a_venir"]
            faits.append({"cle": "plan", "ico": "🗓️", "titre": "Plan suivi",
                          "sous": " · ".join(x for x in [
                              f"{c['sautee']} sautée{'s' if c['sautee'] > 1 else ''}" if c["sautee"] else "",
                              f"{c['manquee']} non faite{'s' if c['manquee'] > 1 else ''}" if c["manquee"] else "",
                              f"{reste} à venir" if reste else ""] if x) or "Toutes les séances prévues sont faites",
                          "valeur": f"{c['realisee']}/{len(prevues)}", "detail": "séances prévues"})
    # Contexte : marqueurs de journée
    marq = Counter(t for j, types in co.marqueurs_par_jour(db, user.id, debut).items() if j <= fin for t in types)
    for t, n in marq.most_common():
        label, emoji, _ = co.MARQUEURS[t]
        faits.append({"cle": f"marqueur-{t}", "ico": emoji, "titre": label,
                      "sous": "Marqueur de journée", "valeur": f"{n} j", "detail": None})
    return faits


def _phrase(type_: str, t: dict, moy: Optional[dict], som: Optional[dict], en_cours: bool) -> Optional[str]:
    nom = "semaine" if type_ == "semaine" else "mois"
    if not t["nb"]:
        return None
    bouts = []
    if moy and moy["charge"] > 0 and not (en_cours and type_ == "semaine" and t["nb"] < 2):
        r = t["charge"] / moy["charge"]
        pct = round(abs(r - 1) * 100)
        ref = "la moyenne des quatre précédentes" if type_ == "semaine" else "la moyenne des quatre précédents"
        if en_cours:
            ref += " à la même date"
        if r >= 1.3:
            bouts.append(f"{nom.capitalize()} nettement plus chargé{'e' if type_ == 'semaine' else ''} que {ref} "
                         f"(+{pct} % de charge) : surveille la récupération.")
        elif r >= 1.1:
            bouts.append(f"Charge en hausse de {pct} % par rapport à {ref}.")
        elif r <= 0.7:
            bouts.append(f"{nom.capitalize()} allégé{'e' if type_ == 'semaine' else ''} : {pct} % de charge en moins que {ref}.")
        elif r <= 0.9:
            bouts.append(f"Charge en baisse de {pct} % par rapport à {ref}.")
        else:
            bouts.append(f"Charge dans la continuité de {ref}.")
    if som and som["nuits"] >= 3 and som["moyenne_h"] < 7:
        h = int(som["moyenne_h"])
        bouts.append(f"Sommeil court : {h} h {round((som['moyenne_h'] - h) * 60):02d} en moyenne.")
    return " ".join(bouts) or None


def bilan_periode(db: Session, user: Utilisateur, type_: str, ref: Optional[str]) -> dict:
    auj = sv.aujourdhui(user)
    debut, fin = _bornes(type_, ref, auj)
    tous = _tous(db, user.id)
    an.maj_efforts(db, user.id, tous)
    en_cours = debut <= auj <= fin
    futur = debut > auj
    acts = _entre(tous, debut, fin)
    # Période en cours : comparaison à la même date (même nombre de jours écoulés)
    ecoules = (auj - debut).days + 1 if en_cours else (fin - debut).days + 1

    def tronquee(d: date, f: date) -> tuple[date, date]:
        return d, min(f, d + timedelta(days=ecoules - 1))

    pd, pf = _precedente(type_, debut)
    prec = _totaux(_entre(tous, *tronquee(pd, pf)))
    quatre, d4 = [], debut
    for _ in range(4):
        d4, f4 = _precedente(type_, d4)
        quatre.append(_totaux(_entre(tous, *tronquee(d4, f4))))
    moy = {k: round(sum(q[k] for q in quatre) / 4, 1) for k in quatre[0]} if any(q["nb"] for q in quatre) else None

    par_jour: dict[date, dict] = {}
    for a in acts:
        j = par_jour.setdefault(a.debut.date(), {"min": 0, "charge": 0.0, "km": 0.0})
        j["min"] += round((a.duree_sec or 0) / 60)
        j["charge"] += cs.charge(a)
        j["km"] += a.distance_km or 0
    jours = []
    for i in range((fin - debut).days + 1):
        d = debut + timedelta(days=i)
        x = par_jour.get(d, {"min": 0, "charge": 0, "km": 0})
        jours.append({"jour": d.isoformat(), "min": x["min"], "charge": round(x["charge"]), "km": round(x["km"], 1),
                      "futur": d > auj})

    sports: dict[str, dict] = {}
    for a in acts:
        s = sports.setdefault(a.sport, {"sport": a.sport, "label": cs.SPORTS.get(a.sport, cs.SPORTS["autre"])["label"],
                                        "duree_sec": 0, "km": 0.0, "nb": 0})
        s["duree_sec"] += a.duree_sec or 0
        s["km"] = round(s["km"] + (a.distance_km or 0), 1)
        s["nb"] += 1

    t = _totaux(acts)
    som = _sommeil(db, user.id, debut, fin)
    som_prec = _sommeil(db, user.id, pd, pf)
    premiere = tous[0].debut.date() if tous else auj
    suiv = _suivante(type_, fin)
    return {
        "type": type_, "ref": _ref(type_, debut), "libelle": _libelle(type_, debut, fin),
        "debut": debut.isoformat(), "fin": fin.isoformat(), "en_cours": en_cours, "futur": futur,
        "jusqu_au": min(auj, fin).isoformat(),
        "ref_precedente": _ref(type_, pd) if pf >= cs._lundi(premiere) - timedelta(days=31) else None,
        "ref_suivante": _ref(type_, suiv) if suiv <= auj else None,
        "totaux": t,
        "precedente": prec, "moyenne4": moy, "a_date": en_cours,
        "jours": jours, "jours_actifs": len(par_jour),
        "intensite": _intensite(acts),
        "sommeil": {**som, "precedente_h": som_prec["moyenne_h"] if som_prec else None} if som else None,
        "sports": sorted(sports.values(), key=lambda s: -s["duree_sec"]),
        "faits": _faits(db, user, tous, acts, debut, fin, type_, auj),
        "phrase": _phrase(type_, t, moy, som, en_cours),
        "seances": [_breve(a) for a in acts],
    }


# ---------------------------------------------------------------------------
# Calendrier d'un mois
# ---------------------------------------------------------------------------

def calendrier(db: Session, user: Utilisateur, mois: Optional[str], premier_jour: int = 1) -> dict:
    auj = sv.aujourdhui(user)
    premier, dernier = _bornes("mois", mois, auj)
    # premier_jour : 1 = semaines du lundi au dimanche, 0 = du dimanche au samedi (affichage seulement)
    tete = 0 if premier_jour == 1 else 6
    debut = premier - timedelta(days=(premier.weekday() - tete) % 7)
    fin = dernier - timedelta(days=(dernier.weekday() - tete) % 7) + timedelta(days=6)
    acts = (db.query(Activite).filter(Activite.utilisateur_id == user.id,
                                      Activite.debut >= datetime.combine(debut - timedelta(days=365), datetime.min.time()),
                                      Activite.debut < datetime.combine(fin + timedelta(days=1), datetime.min.time()))
            .order_by(Activite.debut).all())
    # Repère de charge : une « grosse journée » personnelle (9e décile des jours actifs sur un an)
    charges: dict[date, float] = defaultdict(float)
    for a in acts:
        charges[a.debut.date()] += cs.charge(a)
    actives = sorted(v for v in charges.values() if v > 0)
    repere = actives[min(len(actives) - 1, int(0.9 * len(actives)))] if actives else 0

    prevues = cs.lister_plan(db, user.id, debut, fin, auj)
    marqueurs = co.marqueurs_par_jour(db, user.id, debut)
    par_jour: dict[date, list[Activite]] = defaultdict(list)
    for a in acts:
        if a.debut.date() >= debut:
            par_jour[a.debut.date()].append(a)
    prevues_jour: dict[str, list[dict]] = defaultdict(list)
    liees: dict[int, str] = {}
    for p in prevues:
        if p["activite"]:
            liees[p["activite"]["id"]] = p["titre"]
            if p["activite"]["debut"][:10] >= debut.isoformat():
                continue  # la séance faite la représente dans le calendrier
        prevues_jour[p["jour"]].append({
            "id": p["id"], "sport": p["sport"], "titre": p["titre"], "statut": p["statut"],
            "duree_min": p["duree_min"], "distance_km": p["distance_km"], "description": p["description"],
            "deplacable": p["statut"] in ("a_venir", "manquee"),
        })

    jours, semaines = [], []
    for i in range((fin - debut).days + 1):
        d = debut + timedelta(days=i)
        lot = par_jour.get(d, [])
        ch = charges.get(d, 0.0)
        jours.append({
            "jour": d.isoformat(), "dans_mois": d.month == premier.month,
            "charge": round(ch),
            "niveau": 0 if ch <= 0 or not repere else min(4, max(1, math.ceil(4 * ch / repere))),
            "activites": [{**_breve(a), "prevue": a.id in liees} for a in lot],
            "prevues": prevues_jour.get(d.isoformat(), []),
            "marqueurs": marqueurs.get(d, []),
        })
        if i % 7 == 6:
            sem = [a for k in range(7) for a in par_jour.get(d - timedelta(days=k), [])]
            semaines.append({"lundi": (d - timedelta(days=6)).isoformat(), "bilan": tete == 0, **_totaux(sem)})
    pm = premier - timedelta(days=1)
    return {
        "mois": premier.isoformat()[:7], "libelle": f"{MOIS[premier.month - 1].capitalize()} {premier.year}",
        "aujourdhui": auj.isoformat(),
        "mois_precedent": pm.isoformat()[:7], "mois_suivant": (dernier + timedelta(days=1)).isoformat()[:7],
        "jours": jours, "semaines": semaines,
        "totaux": _totaux([a for a in acts if premier <= a.debut.date() <= dernier]),
        "types_marqueurs": co.TYPES_MARQUEURS,
    }


def deplacer_prevue(db: Session, user: Utilisateur, p: SeancePrevue, jour: date) -> None:
    """Change le jour d'une séance prévue (placée en fin de journée). Une séance faite ne bouge pas."""
    auj = sv.aujourdhui(user)
    if cs.statut_prevue(p, auj) == "realisee":
        raise ValueError("Une séance déjà réalisée ne se déplace pas")
    if abs((jour - auj).days) > 400:
        raise ValueError("Date trop éloignée")
    if jour == p.jour:
        return
    ordres = [o for (o,) in db.query(SeancePrevue.ordre).filter(
        SeancePrevue.utilisateur_id == user.id, SeancePrevue.jour == jour, SeancePrevue.id != p.id).all()]
    p.jour, p.ordre = jour, max([o or 0 for o in ordres], default=-1) + 1


# ---------------------------------------------------------------------------
# Séries et jalons
# ---------------------------------------------------------------------------

PALIERS = {
    "km": [100, 250, 500, 1000, 1500, 2000, 3000, 4000, 5000, 7500, 10000, 15000, 20000, 30000, 40000, 50000, 75000, 100000],
    "dplus": [5000, 10000, 25000, 50000, 75000, 100000, 150000, 200000, 300000, 500000, 750000, 1000000],
    "seances": [50, 100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000],
    "heures": [50, 100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000],
}
_LIBELLES = {"km": ("Distance", "km"), "dplus": ("Dénivelé positif", "m"), "seances": ("Séances", ""), "heures": ("Temps en mouvement", "h")}


def _apport(a: Activite) -> dict:
    return {"km": a.distance_km or 0, "dplus": a.dplus_m or 0, "seances": 1, "heures": (a.duree_sec or 0) / 3600}


def _series_semaines(acts: list[Activite], auj: date) -> dict:
    lundis = sorted({cs._lundi(a.debut.date()) for a in acts})
    if not lundis:
        return {"actuelle": 0, "record": 0, "record_fin": None, "semaine_en_cours_active": False}
    ens = set(lundis)
    record = n = 0
    record_fin = None
    for l in lundis:
        n = n + 1 if (l - timedelta(days=7)) in ens else 1
        if n > record:
            record, record_fin = n, l
    courant = cs._lundi(auj)
    active = courant in ens
    l = courant if active else courant - timedelta(days=7)   # la semaine en cours ne casse pas la série
    actuelle = 0
    while l in ens:
        actuelle += 1
        l -= timedelta(days=7)
    return {"actuelle": actuelle, "record": record,
            "record_fin": (record_fin + timedelta(days=6)).isoformat() if record_fin else None,
            "semaine_en_cours_active": active}


def jalons(db: Session, user: Utilisateur) -> dict:
    auj = sv.aujourdhui(user)
    acts = _tous(db, user.id)
    # Paliers franchis sur tout l'historique
    cumul = {k: 0.0 for k in PALIERS}
    franchis: dict[str, list[dict]] = {k: [] for k in PALIERS}
    for a in acts:
        for k, v in _apport(a).items():
            avant, cumul[k] = cumul[k], cumul[k] + v
            for p in PALIERS[k]:
                if avant < p <= cumul[k]:
                    franchis[k].append({"valeur": p, "date": a.debut.date().isoformat(), "activite_id": a.id})
    # Rythme des 12 dernières semaines, pour dater le prochain palier
    lim = auj - timedelta(days=84)
    rythme = {k: 0.0 for k in PALIERS}
    for a in acts:
        if a.debut.date() > lim:
            for k, v in _apport(a).items():
                rythme[k] += v / 84
    metriques = []
    for k in PALIERS:
        prochain = next((p for p in PALIERS[k] if p > cumul[k]), None)
        est = None
        if prochain and rythme[k] > 0:
            j = math.ceil((prochain - cumul[k]) / rythme[k])
            est = (auj + timedelta(days=j)).isoformat() if j <= 3 * 365 else None
        precedent = franchis[k][-1]["valeur"] if franchis[k] else 0
        metriques.append({
            "cle": k, "label": _LIBELLES[k][0], "unite": _LIBELLES[k][1], "total": round(cumul[k], 1 if k == "km" else 0),
            "franchis": franchis[k][-3:][::-1], "nb_franchis": len(franchis[k]),
            "prochain": {"valeur": prochain, "reste": round(prochain - cumul[k], 1 if k == "km" else 0),
                         "avancement": round((cumul[k] - precedent) / (prochain - precedent), 3),
                         "estimation": est} if prochain else None,
        })

    # Cumul de l'année, face à l'année précédente et à l'objectif personnel s'il couvre l'année
    an_, debut_an = auj.year, date(auj.year, 1, 1)
    fin_an = date(an_, 12, 31)
    objectif = next((o for o in db.query(Objectif).filter(
        Objectif.utilisateur_id == user.id, Objectif.type == "perso", Objectif.metrique == "distance_km",
        Objectif.statut != "abandonne").order_by(Objectif.id.desc())
        if o.valeur_cible and o.date_cible and o.date_cible.year == an_ and o.date_cible >= date(an_, 11, 1)
        and (o.date_debut or debut_an) <= date(an_, 2, 1)), None)
    sport = objectif.sport if objectif and objectif.sport else None
    garde = [a for a in acts if (a.distance_km or 0) > 0 and (not sport or cs.famille_sport(a.sport) == cs.famille_sport(sport))]

    def cumul_annee(annee: int) -> list[float]:
        jours = [0.0] * 367
        for a in garde:
            if a.debut.year == annee:
                jours[a.debut.timetuple().tm_yday] += a.distance_km
        for i in range(1, 367):
            jours[i] += jours[i - 1]
        return jours

    cette, avant = cumul_annee(an_), cumul_annee(an_ - 1)
    nj = auj.timetuple().tm_yday
    total_j = fin_an.timetuple().tm_yday
    points = []
    for j in sorted(set(list(range(1, total_j + 1, 7)) + [nj, total_j])):
        d = debut_an + timedelta(days=j - 1)
        points.append({"jour": d.isoformat(), "actuel": round(cette[j], 1) if j <= nj else None,
                       "precedent": round(avant[min(j, 366)], 1) if avant[366] > 0 else None,
                       "objectif": round(objectif.valeur_cible * j / total_j, 1) if objectif else None})
    actuel = round(cette[nj], 1)
    projection = round(actuel / nj * total_j) if nj >= 14 and actuel > 0 else None
    annee = {
        "annee": an_, "actuel": actuel, "sport": sport,
        "sport_label": cs.SPORTS.get(sport, cs.SPORTS["autre"])["label"] if sport else None,
        "precedent_a_date": round(avant[nj], 1) if avant[366] > 0 else None,
        "precedent_total": round(avant[366], 1) if avant[366] > 0 else None,
        "projection": projection, "points": points,
        "objectif": {"id": objectif.id, "titre": objectif.titre, "cible": objectif.valeur_cible,
                     "attendu_a_date": round(objectif.valeur_cible * nj / total_j, 1),
                     "rythme_requis_sem": round(max(0.0, objectif.valeur_cible - actuel) / max(1, total_j - nj) * 7, 1)}
        if objectif else None,
    }
    return {"semaines": _series_semaines(acts, auj), "metriques": metriques, "annee": annee, "nb": len(acts)}


# ---------------------------------------------------------------------------
# Exploration : kilomètres de chemins parcourus pour la première fois
# ---------------------------------------------------------------------------

MAILLE = 0.001          # ≈ 110 m en latitude
_CACHE_EXPLO: dict[int, tuple[str, dict]] = {}


def _dist_m(a, b) -> float:
    x = math.radians(b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    y = math.radians(b[0] - a[0])
    return 6371000 * math.hypot(x, y)


def _maille(lat: float, lon: float) -> tuple[int, int]:
    # Longitude resserrée par bande d'un degré de latitude : mailles à peu près carrées
    return math.floor(lat / MAILLE), math.floor(lon * math.cos(math.radians(round(lat))) / MAILLE)


def exploration(db: Session, user: Utilisateur) -> dict:
    """Pour chaque tracé pris dans l'ordre des dates : les portions passant dans une maille (~110 m)
    encore jamais visitée comptent comme « nouvelles »."""
    lignes = (db.query(TraceGPS.id, Activite.id, Activite.titre, Activite.sport, Activite.debut)
              .join(Activite, Activite.id == TraceGPS.activite_id)
              .filter(TraceGPS.utilisateur_id == user.id).order_by(Activite.debut, TraceGPS.id).all())
    signature = f"{len(lignes)}:{sum(l[0] for l in lignes)}"
    cache = _CACHE_EXPLO.get(user.id)
    if cache and cache[0] == signature:
        return cache[1]
    vues: set[tuple[int, int]] = set()
    mois: dict[str, dict] = {}
    sorties = []
    for tid, aid, titre, sport, debut in lignes:
        brut = db.query(TraceGPS.points).filter(TraceGPS.id == tid).scalar()
        try:
            pts = json.loads(brut) if brut else []
        except ValueError:
            pts = []
        total = nouveau = 0.0
        courante = None   # maille découverte pendant ce passage : on y reste « en terrain neuf »
        prec = None
        for p in pts:
            if not isinstance(p, list) or len(p) < 2 or p[0] is None or p[1] is None:
                continue
            m = _maille(p[0], p[1])
            neuf = False
            if m not in vues:
                vues.add(m)
                courante, neuf = m, True
            elif m == courante:
                neuf = True
            else:
                courante = None
            if prec is not None:
                d = _dist_m(prec, p)
                if d < 500:   # au-delà : trou dans le tracé
                    total += d
                    if neuf:
                        nouveau += d
            prec = p
        k = debut.strftime("%Y-%m")
        x = mois.setdefault(k, {"mois": k, "km": 0.0, "nouveaux_km": 0.0, "traces": 0})
        x["km"] += total / 1000
        x["nouveaux_km"] += nouveau / 1000
        x["traces"] += 1
        if nouveau >= 500:
            sorties.append({"activite_id": aid, "titre": titre, "sport": sport, "date": debut.date().isoformat(),
                            "km": round(total / 1000, 1), "nouveaux_km": round(nouveau / 1000, 1)})
    for x in mois.values():
        x["km"], x["nouveaux_km"] = round(x["km"], 1), round(x["nouveaux_km"], 1)
    res = {
        "nb_traces": len(lignes),
        "mois": [mois[k] for k in sorted(mois)],
        "explore_km": round(sum(x["nouveaux_km"] for x in mois.values()), 1),
        "parcouru_km": round(sum(x["km"] for x in mois.values()), 1),
        "mailles": len(vues),
        "sorties": sorted(sorties, key=lambda s: -s["nouveaux_km"])[:60],
    }
    _CACHE_EXPLO[user.id] = (signature, res)
    return res
