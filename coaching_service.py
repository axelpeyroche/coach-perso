"""
Coaching : vue de la saison (semaines jusqu'à l'objectif, phases, charge prévue
contre réalisée), centre d'alertes (chaque alerte dit quoi faire), préparation
d'une course (compte à rebours, plan d'allure, météo, check-list, ravitaillement)
et bibliothèque de séances types dont les cibles suivent les zones du moment.

Tout est calculé par règles, sans IA.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime, time, timedelta
from typing import Optional

from sqlalchemy.orm import Session

import analyses_service as an
import carnet_service as cs
import suivi_service as sv
import zones_service as zs
from models import Activite, ItineraireFavori, Objectif, SeancePrevue, Utilisateur


def _mmss(sec) -> str:
    sec = int(round(sec))
    return f"{sec // 60}:{sec % 60:02d}"


def _hmin(sec) -> str:
    m = int(round(sec / 60))
    return f"{m // 60} h {m % 60:02d}" if m >= 60 else f"{m} min"


# ---------------------------------------------------------------------------
# Vue saison
# ---------------------------------------------------------------------------

SEMAINES_PASSEES = 8      # historique affiché avant la semaine en cours
SEMAINES_MAX = 44         # longueur maximale de la frise
SEMAINES_SANS_OBJECTIF = 8
AFFUTAGE_SEMAINES = 2
SPECIFIQUE_SEMAINES = 8   # avant l'affûtage
DECHARGE_SEUIL = 0.75     # charge sous 75 % de la moyenne des 3 semaines précédentes
DECHARGE_TOUTES_LES = 4   # au-delà de 4 semaines pleines d'affilée, on conseille d'alléger

PHASES = {
    "base": ("Base", "Du volume en endurance, monté progressivement (10 % par semaine au plus), "
                     "avec une semaine allégée toutes les 3 à 4 semaines."),
    "specifique": ("Spécifique", "Des séances à l'allure et sur le terrain de la course ; "
                                 "les sorties longues les plus longues se placent ici."),
    "affutage": ("Affûtage", "Volume réduit de 30 à 50 %, un peu d'intensité gardée : "
                             "tu arrives frais sans perdre la forme."),
    "course": ("Course", "Semaine de la course : deux ou trois footings courts, du sommeil, rien de nouveau."),
    "recuperation": ("Récupération", "Après la course : une à deux semaines faciles avant de relancer."),
    "entretien": ("Entretien", "Pas de course en vue : régularité, variété, et une semaine allégée de temps en temps."),
}


def _phase(n: Optional[int]) -> str:
    """Phase d'une semaine située n semaines avant celle de la course."""
    if n is None:
        return "entretien"
    if n < 0:
        return "recuperation"
    if n == 0:
        return "course"
    if n <= AFFUTAGE_SEMAINES:
        return "affutage"
    if n <= AFFUTAGE_SEMAINES + SPECIFIQUE_SEMAINES:
        return "specifique"
    return "base"


def _charge_prevue(p: SeancePrevue) -> float:
    return (p.duree_min or 45) * sv._intensite(p)


def saison(db: Session, user: Utilisateur, auj: Optional[date] = None) -> dict:
    auj = auj or sv.aujourdhui(user)
    lundi = cs._lundi(auj)
    courses = (db.query(Objectif)
               .filter(Objectif.utilisateur_id == user.id, Objectif.type == "course", Objectif.statut == "actif",
                       Objectif.date_cible.isnot(None), Objectif.date_cible >= auj)
               .order_by(Objectif.date_cible).all())
    cible = courses[0] if courses else None
    lundi_course = cs._lundi(cible.date_cible) if cible else None

    debut = lundi - timedelta(weeks=SEMAINES_PASSEES)
    fin = lundi_course if cible else lundi + timedelta(weeks=SEMAINES_SANS_OBJECTIF - 1)
    tronquee = False
    if (fin - debut).days // 7 + 1 > SEMAINES_MAX:
        fin, tronquee = debut + timedelta(weeks=SEMAINES_MAX - 1), True

    cs.rapprocher_plan(db, user.id, auj)
    avant = debut - timedelta(weeks=3)   # trois semaines de plus pour juger la première décharge
    acts = (db.query(Activite)
            .filter(Activite.utilisateur_id == user.id,
                    Activite.debut >= datetime.combine(avant - timedelta(days=150), time.min),
                    Activite.debut < datetime.combine(auj + timedelta(days=1), time.min)).all())
    prevues = (db.query(SeancePrevue)
               .filter(SeancePrevue.utilisateur_id == user.id, SeancePrevue.jour >= avant,
                       SeancePrevue.jour <= fin + timedelta(days=6)).all())

    forme = {p["jour"]: p["ctl"] for p in an.courbe_forme(an.charges_quotidiennes(acts), auj)}
    par_sem: dict[date, dict] = {}

    def sem(l: date) -> dict:
        return par_sem.setdefault(l, {"charge": 0.0, "duree": 0.0, "km": 0.0, "dplus": 0, "n": 0,
                                      "prevue": 0.0, "n_prevues": 0, "n_faites": 0})

    for a in acts:
        j = a.debut.date()
        if j < avant:
            continue
        s = sem(cs._lundi(j))
        s["charge"] += cs.charge(a)
        s["duree"] += (a.duree_sec or 0) / 3600
        s["km"] += a.distance_km or 0
        s["dplus"] += a.dplus_m or 0
        s["n"] += 1
    for p in prevues:
        if p.statut == "sautee":
            continue
        s = sem(cs._lundi(p.jour))
        s["prevue"] += _charge_prevue(p)
        s["n_prevues"] += 1
        s["n_faites"] += 1 if p.activite_id else 0

    def reference(l: date) -> Optional[float]:
        """Moyenne des 3 semaines précédentes (réalisé pour le passé, prévu pour l'avenir)."""
        vals = []
        for k in (1, 2, 3):
            s = par_sem.get(l - timedelta(weeks=k))
            if s:
                vals.append(s["charge"] if l - timedelta(weeks=k) < lundi else max(s["charge"], s["prevue"]))
        vals = [v for v in vals if v > 0]
        return sum(vals) / len(vals) if len(vals) >= 2 else None

    jalons: dict[date, list[dict]] = {}
    for o in courses:
        jalons.setdefault(cs._lundi(o.date_cible), []).append(
            {"id": o.id, "titre": o.titre, "date": o.date_cible.isoformat()})

    semaines = []
    l = debut
    while l <= fin:
        s = par_sem.get(l) or sem(l)
        passee, courante = l < lundi, l == lundi
        n = (lundi_course - l).days // 7 if lundi_course else None
        ref = reference(l)
        if passee:
            decharge = bool(ref and ref >= 60 and s["charge"] < ref * DECHARGE_SEUIL)
        elif courante:
            # semaine en cours : la charge partielle ne dit rien, on juge le plan s’il a l’air complet
            decharge = bool(ref and ref >= 60 and s["n_prevues"] >= 3
                            and max(s["charge"], s["prevue"]) < ref * DECHARGE_SEUIL)
        else:
            # semaine à venir : seulement si le plan a l’air complet (3 séances ou plus)
            decharge = bool(ref and ref >= 60 and s["n_prevues"] >= 3 and s["prevue"] < ref * DECHARGE_SEUIL)
        fin_sem = min(l + timedelta(days=6), auj)
        semaines.append({
            "lundi": l.isoformat(), "numero": l.isocalendar()[1],
            "phase": _phase(n), "avant_course": n, "passee": passee, "courante": courante,
            "charge": round(s["charge"]) if l <= lundi else None,
            "charge_prevue": round(s["prevue"]) if s["n_prevues"] else None,
            "duree_h": round(s["duree"], 1) if l <= lundi else None,
            "distance_km": round(s["km"], 1) if l <= lundi else None,
            "dplus_m": round(s["dplus"]) if l <= lundi else None,
            "seances": s["n"] if l <= lundi else None,
            "seances_prevues": s["n_prevues"], "seances_faites": s["n_faites"],
            "decharge": decharge,
            "ctl": forme.get(fin_sem.isoformat()) if l <= lundi else None,
            "courses": jalons.get(l, []),
        })
        l += timedelta(weeks=1)

    # Blocs de phases consécutives
    phases = []
    for s in semaines:
        if phases and phases[-1]["cle"] == s["phase"]:
            phases[-1]["fin"] = s["lundi"]
            phases[-1]["semaines"] += 1
        else:
            phases.append({"cle": s["phase"], "label": PHASES[s["phase"]][0], "texte": PHASES[s["phase"]][1],
                           "debut": s["lundi"], "fin": s["lundi"], "semaines": 1})
    actuelle = next((s["phase"] for s in semaines if s["courante"]), "entretien")

    # Semaines pleines d'affilée (jusqu'à la dernière semaine terminée)
    pleines = 0
    for s in reversed([x for x in semaines if x["passee"]]):
        if s["decharge"] or not s["charge"]:
            break
        pleines += 1
    passees = [s["charge"] for s in semaines if s["passee"]][-4:]
    moy4 = round(sum(passees) / len(passees)) if passees else None

    conseils = []
    courante = next((s for s in semaines if s["courante"]), None)
    if pleines >= DECHARGE_TOUTES_LES and actuelle in ("base", "specifique", "entretien") \
            and not (courante and courante["decharge"]):
        conseils.append({"ton": "attention", "titre": "Semaine allégée à prévoir",
                         "texte": f"{pleines} semaines pleines d'affilée sans décharge : réduis le volume d'un tiers "
                                  "cette semaine ou la suivante, en gardant une séance un peu vive."})
    if courante and moy4 and courante["charge_prevue"] and courante["charge_prevue"] > moy4 * 1.3 \
            and actuelle != "course":
        conseils.append({"ton": "attention", "titre": "Semaine prévue chargée",
                         "texte": f"Charge prévue {courante['charge_prevue']} contre {moy4} en moyenne sur 4 semaines "
                                  f"(+{round((courante['charge_prevue'] / moy4 - 1) * 100)} %) : au-delà de 30 % de hausse, "
                                  "retire ou raccourcis une séance."})
    if cible and actuelle == "affutage":
        conseils.append({"ton": "info", "titre": "Affûtage en cours",
                         "texte": "Le travail est fait : moins de volume, des rappels d'allure courts, et du sommeil."})
    if not cible:
        conseils.append({"ton": "info", "titre": "Aucune course en vue",
                         "texte": "Ajoute un objectif de course pour découper la saison en base, spécifique et affûtage."})

    return {
        "aujourd_hui": auj.isoformat(),
        "objectif": {"id": cible.id, "titre": cible.titre, "date": cible.date_cible.isoformat(),
                     "jours": (cible.date_cible - auj).days, "semaines": (lundi_course - lundi).days // 7,
                     "distance_km": cible.distance_km, "dplus_m": cible.dplus_m, "sport": cible.sport} if cible else None,
        "autres": [{"id": o.id, "titre": o.titre, "date": o.date_cible.isoformat(),
                    "jours": (o.date_cible - auj).days} for o in courses[1:]],
        "tronquee": tronquee,
        "phase": {"cle": actuelle, "label": PHASES[actuelle][0], "texte": PHASES[actuelle][1]},
        "phases": phases,
        "semaines": semaines,
        "repere": {"charge_moy_4s": moy4, "semaines_pleines": pleines},
        "conseils": conseils,
    }


# ---------------------------------------------------------------------------
# Centre d'alertes
# ---------------------------------------------------------------------------

# Quoi faire, par identifiant de constat (voir essentiel_service)
ACTIONS = {
    "forme": "Remplace les deux prochaines séances dures par de l'endurance facile ou du repos, "
             "puis reprends quand la fraîcheur repasse au-dessus de −10.",
    "rampe": "Garde le même volume la semaine prochaine au lieu de l'augmenter : "
             "la hausse se digère avant d'en ajouter.",
    "monotonie": "Rends les jours faciles vraiment faciles et place un jour de repos complet : "
                 "c'est le contraste qui fait progresser.",
    "intensite": "Passe les footings en Z1–Z2 (tu dois pouvoir parler) et limite-toi à deux séances dures par semaine.",
    "recup": "Aujourd'hui : endurance facile ou repos. Si la VFC reste basse trois matins, allège toute la semaine.",
    "nuit": "Surveille les signes de maladie (gorge, courbatures inhabituelles) et évite l'intensité aujourd'hui.",
    "dette": "Avance le coucher de 30 minutes pendant une semaine plutôt que de compter sur une grasse matinée.",
    "regularite": "Fixe une heure de coucher à ± 30 minutes, week-end compris.",
    "vc": "Replace une séance au seuil par semaine pendant un mois, puis refais un effort de 10 à 20 minutes à fond.",
    "ef": "Vérifie d'abord le sommeil et la chaleur ; si la baisse dure, ajoute du volume en endurance facile.",
    "dplus": "Stabilise le dénivelé deux semaines et ajoute du renforcement des mollets (montées sur pointes).",
    "plan": "Retire une séance du plan plutôt que d'en manquer une sur trois : un plan tenu vaut mieux qu'un plan ambitieux.",
    "vma_test": "Planifie un test (demi-Cooper ou 5 minutes à fond) depuis Analyses → Capacités → Tests.",
    "sortie_longue": "Place une sortie longue ce week-end, à allure facile ; reprends à 80 % de ta dernière durée.",
}

LONGUE_MIN = 75          # minutes : seuil d'une sortie longue à pied
LONGUE_SANS_JOURS = 21


def _alerte_sortie_longue(db: Session, user: Utilisateur, auj: date) -> Optional[dict]:
    depuis = datetime.combine(auj - timedelta(days=90), time.min)
    acts = (db.query(Activite.debut, Activite.duree_sec)
            .filter(Activite.utilisateur_id == user.id, Activite.sport.in_(cs.SPORTS_PIED), Activite.debut >= depuis)
            .all())
    recentes = [a for a in acts if a.debut.date() > auj - timedelta(days=42)]
    longues = sorted(a.debut.date() for a in acts if (a.duree_sec or 0) >= LONGUE_MIN * 60)
    if len(recentes) < 6 or not longues:
        return None   # pas de pratique régulière à pied, ou jamais de sortie longue : rien à rappeler
    ecart = (auj - longues[-1]).days
    if ecart <= LONGUE_SANS_JOURS:
        return None
    return {"id": "sortie_longue", "ton": "attention", "titre": "Pas de sortie longue récente",
            "texte": f"Ta dernière sortie de plus de {LONGUE_MIN} minutes à pied remonte à {ecart} jours "
                     f"({ecart // 7} semaines) : l'endurance longue se perd en premier.",
            "onglet": None, "ancre": None, "lien": "/plan"}


def alertes(db: Session, user: Utilisateur, auj: Optional[date] = None) -> dict:
    a = an.calculer_analyses(db, user, auj)
    auj = auj or date.today()
    constats = a.get("essentiel") or []
    out = []
    for c in constats:
        if c["ton"] in ("alerte", "attention"):
            out.append({**c, "lien": f"/analyses#{c.get('ancre') or c.get('onglet')}"})
        elif c["id"] == "vma_test":
            # estimation périmée : sans test récent, zones et prédictions reposent sur une valeur ancienne
            out.append({**c, "ton": "attention", "titre": "Estimation périmée",
                        "lien": "/analyses#tests"})
    longue = _alerte_sortie_longue(db, user, auj)
    if longue:
        out.append(longue)
    for c in out:
        c["action"] = ACTIONS.get(c["id"])
        if c["id"] == "forme" and c["ton"] != "alerte":
            c["action"] = ("Hors affûtage ou repos voulu, relance : remets une sortie longue et une séance soutenue "
                           "cette semaine, puis remonte le volume de 10 % par semaine.")
    ordre = {"alerte": 0, "attention": 1}
    out.sort(key=lambda c: ordre[c["ton"]])
    return {
        "aujourd_hui": auj.isoformat(),
        "alertes": out,
        "nb_alerte": sum(1 for c in out if c["ton"] == "alerte"),
        "nb_attention": sum(1 for c in out if c["ton"] == "attention"),
        "bons": [{"id": c["id"], "titre": c["titre"], "texte": c["texte"],
                  "lien": f"/analyses#{c.get('ancre') or c.get('onglet')}"}
                 for c in constats if c["ton"] == "bon"],
    }


# ---------------------------------------------------------------------------
# Préparation d'une course
# ---------------------------------------------------------------------------

HEURE_DEPART_DEFAUT = "09:00"
PREVISION_JOURS = 15
GEL_G = 25


def lire_preparation(o: Objectif) -> dict:
    try:
        d = json.loads(o.preparation) if o.preparation else {}
    except ValueError:
        d = {}
    if not isinstance(d, dict):
        d = {}
    heure = d.get("heure") if re.fullmatch(r"\d{2}:\d{2}", str(d.get("heure") or "")) else HEURE_DEPART_DEFAUT
    return {"coches": [str(x) for x in d.get("coches") or []][:200],
            "ajouts": [str(x)[:80] for x in d.get("ajouts") or []][:30],
            "heure": heure}


def enregistrer_preparation(o: Objectif, coches: Optional[list[str]] = None, ajouts: Optional[list[str]] = None,
                            heure: Optional[str] = None) -> dict:
    p = lire_preparation(o)
    if coches is not None:
        p["coches"] = list(dict.fromkeys(coches))[:200]
    if ajouts is not None:
        p["ajouts"] = list(dict.fromkeys(a.strip() for a in ajouts if a.strip()))[:30]
    if heure:
        p["heure"] = heure
    o.preparation = json.dumps(p, ensure_ascii=False)
    return p


def ravitaillement(duree_sec: Optional[float], temperature: Optional[float]) -> Optional[dict]:
    """Repères de glucides, d'eau et de sodium par heure, selon la durée et la chaleur."""
    if not duree_sec:
        return None
    h = duree_sec / 3600
    if h < 1:
        glu = (0, 0)
        glu_txt = "Pas de glucides nécessaires sous une heure : un gel en réserve suffit."
    elif h < 2.5:
        glu = (30, 60)
        glu_txt = "30 à 60 g de glucides par heure, à partir de la 30ᵉ minute."
    else:
        glu = (60, 90)
        glu_txt = ("60 à 90 g de glucides par heure dès le début (mélange glucose + fructose au-delà de 60 g), "
                   "à condition de l'avoir testé à l'entraînement.")
    t = temperature
    if t is None:
        eau, eau_txt = (400, 600), "Sans prévision météo : compte 400 à 600 ml par heure."
    elif t < 12:
        eau, eau_txt = (300, 500), f"Temps frais ({round(t)} °C) : 300 à 500 ml par heure suffisent."
    elif t < 20:
        eau, eau_txt = (400, 600), f"Température modérée ({round(t)} °C) : 400 à 600 ml par heure."
    elif t < 26:
        eau, eau_txt = (500, 750), f"Il fera chaud ({round(t)} °C) : 500 à 750 ml par heure, bois dès le début."
    else:
        eau, eau_txt = (600, 900), (f"Forte chaleur ({round(t)} °C) : 600 à 900 ml par heure, "
                                   "mouille-toi la nuque aux ravitaillements et ralentis l'allure visée.")
    if h < 1:
        eau, eau_txt = (0, 300), "Sous une heure : bois selon ta soif, quelques gorgées suffisent."
    sodium = (300, 600) if (h >= 2 or (t is not None and t >= 22)) and h >= 1 else None
    moy = (glu[0] + glu[1]) / 2
    gels = round(moy * max(h - 0.4, 0) / GEL_G) if moy else 0
    prises = None
    if moy:
        toutes = 20 if moy >= 70 else 25 if moy >= 55 else 30 if moy >= 40 else 40
        prises = f"En pratique : un gel de {GEL_G} g (ou équivalent) toutes les {toutes} minutes, avec de l'eau."
    return {
        "duree_h": round(h, 2),
        "glucides_g_h": list(glu), "glucides_texte": glu_txt,
        "eau_ml_h": list(eau), "eau_texte": eau_txt,
        "sodium_mg_h": list(sodium) if sodium else None,
        "glucides_total_g": [round(glu[0] * h), round(glu[1] * h)] if moy else None,
        "eau_total_l": [round(eau[0] * h / 1000, 1), round(eau[1] * h / 1000, 1)],
        "gels": gels, "prises": prises,
        "avant": ("Dernier repas 3 h avant le départ, riche en glucides et déjà testé ; "
                  "quelques gorgées d'eau jusqu'au départ." +
                  (" Les deux jours précédents, augmente la part de féculents." if h >= 1.5 else "")),
    }


def _checklist(o: Objectif, duree_sec: Optional[float], meteo: Optional[dict], ravito: Optional[dict]) -> list[dict]:
    h = (duree_sec or 0) / 3600
    trail = o.sport == "trail" or (o.dplus_m or 0) >= 500
    groupes: list[tuple[str, list[tuple[str, str]]]] = []
    base = [("dossard", "Dossard, épingles ou ceinture porte-dossard"),
            ("justificatif", "Pièce d'identité, licence ou attestation demandée par l'organisation"),
            ("chaussures", "Chaussures déjà portées sur une sortie longue"),
            ("tenue", "Tenue complète déjà testée (chaussettes comprises)"),
            ("montre", "Montre chargée, parcours ou allures chargés dedans")]
    if h >= 1.5:
        base.append(("anti_frottements", "Crème anti-frottements, pansements sur les zones sensibles"))
    groupes.append(("Indispensable", base))

    rav = []
    if ravito and ravito["gels"]:
        rav.append(("gels", f"{ravito['gels'] + 1} gels ou équivalents ({ravito['gels']} prévus + 1 de secours)"))
    if h >= 1.25 or trail:
        rav.append(("flasques", "Flasques ou gourde remplies"))
    if ravito and ravito["sodium_mg_h"]:
        rav.append(("sel", "Pastilles de sel ou boisson avec sodium"))
    rav.append(("petit_dej", "Petit-déjeuner habituel prévu (rien de nouveau le jour J)"))
    groupes.append(("Ravitaillement", rav))

    if trail:
        t = [("sac", "Gilet ou sac d'hydratation réglé"), ("survie", "Couverture de survie et sifflet"),
             ("telephone", "Téléphone chargé, numéro de l'organisation enregistré"),
             ("gobelet", "Gobelet réutilisable")]
        if h >= 5:
            t.append(("frontale", "Lampe frontale et piles de rechange"))
        if (o.dplus_m or 0) >= 1500:
            t.append(("batons", "Bâtons (si autorisés) déjà utilisés à l'entraînement"))
        groupes.append(("Trail", t))

    if meteo:
        m = []
        if (meteo.get("precipitation_mm") or 0) >= 1:
            m.append(("veste", "Veste imperméable légère"))
        temp = meteo.get("ressentie") if meteo.get("ressentie") is not None else meteo.get("temperature")
        if temp is not None and temp <= 5:
            m.append(("froid", "Gants, bonnet ou tour de cou, manches longues"))
        if temp is not None and temp >= 22:
            m.append(("chaud", "Casquette, crème solaire, éponge ou eau pour s'arroser"))
        if (meteo.get("vent_kmh") or 0) >= 30:
            m.append(("vent", "Coupe-vent pour l'attente au départ"))
        if m:
            groupes.append(("Selon la météo prévue", m))

    groupes.append(("Logistique", [("trajet", "Trajet, parking et heure d'arrivée repérés"),
                                   ("retrait", "Lieu et horaires de retrait du dossard vérifiés"),
                                   ("reveil", "Réveil réglé : petit-déjeuner 3 h avant le départ"),
                                   ("apres", "Vêtements secs et collation pour l'arrivée")]))
    return [{"groupe": g, "elements": [{"id": i, "label": lib} for i, lib in items]} for g, items in groupes]


def _etapes(jour: date, auj: date, duree_sec: Optional[float]) -> list[dict]:
    long = (duree_sec or 0) >= 90 * 60
    plan = [
        (14, "Dernière grosse séance", "Dernière sortie longue ou séance spécifique complète. Ensuite, on ne construit plus."),
        (10, "Début de l'affûtage", "Volume réduit d'un tiers ; les allures restent les mêmes."),
        (7, "Rappel d'allure", "Une séance courte à l'allure de course (15 à 20 minutes au total), sans aller au bout."),
        (3, "Recharge", ("Plus de féculents à chaque repas et bonne hydratation." if long
                         else "Repas habituels, hydratation régulière.") + " Dernier footing avec 4 lignes droites."),
        (2, "La nuit qui compte", "Couche-toi tôt : c'est l'avant-dernière nuit qui pèse le plus. Repos ou 20 minutes très faciles."),
        (1, "Veille", "Sac prêt, check-list cochée, 15 minutes de trot facultatives. Dîner simple et connu."),
        (0, "Jour J", "Petit-déjeuner 3 h avant, échauffement de 10 à 15 minutes, départ prudent."),
    ]
    out = []
    for n, titre, texte in plan:
        d = jour - timedelta(days=n)
        out.append({"j": n, "date": d.isoformat(), "titre": titre, "texte": texte,
                    "passee": d < auj, "aujourd_hui": d == auj})
    return out


def _passages_reguliers(distance_km: float, duree_sec: float) -> list[dict]:
    """Sans parcours lié : allure régulière, un passage tous les 1, 2 ou 5 km."""
    pas = 1 if distance_km <= 12 else 2 if distance_km <= 25 else 5
    allure = duree_sec / distance_km
    out, km = [], 0.0
    while km < distance_km - 1e-6:
        suiv = min(km + pas, distance_km)
        out.append({"km": round(suiv, 1), "longueur_km": round(suiv - km, 2), "dplus_m": None, "dmoins_m": None,
                    "sec": round((suiv - km) * allure), "allure_sec_km": round(allure), "cumul_sec": round(suiv * allure)})
        km = suiv
    return out


def preparation(db: Session, user: Utilisateur, o: Objectif, auj: Optional[date] = None) -> dict:
    import meteo_service

    auj = auj or sv.aujourdhui(user)
    etat = lire_preparation(o)
    jours = (o.date_cible - auj).days if o.date_cible else None

    pred = None
    try:
        a = an.calculer_analyses(db, user, auj)
        pred = next((p for p in (((a.get("capacites") or {}).get("prediction") or {}).get("objectifs") or [])
                     if p.get("id") == o.id), None)
    except Exception:  # la préparation reste utile sans prédiction
        pred = None
    temps = (pred or {}).get("temps") if pred and pred.get("disponible") else None
    visee = (temps or {}).get("visee", {}).get("sec") if temps else None
    duree = o.temps_cible_sec or visee
    source = "cible" if o.temps_cible_sec else "prediction" if visee else None

    passages, par_troncon = None, False
    if pred and pred.get("passages"):
        passages, par_troncon = pred["passages"], True
        total = passages[-1].get("cumul_sec")
        if o.temps_cible_sec and total:
            # le tableau de la prédiction est ramené au temps visé : mêmes écarts entre tronçons
            k = o.temps_cible_sec / total
            cumul = 0
            ajustes = []
            for p in passages:
                sec = round(p["sec"] * k)
                cumul += sec
                ajustes.append({**p, "sec": sec, "cumul_sec": cumul,
                                "allure_sec_km": round(sec / p["longueur_km"]) if p.get("longueur_km") else None})
            passages = ajustes
    elif duree and o.distance_km:
        passages = _passages_reguliers(o.distance_km, duree)

    # Météo prévue : départ du parcours lié, sinon adresse du profil
    lat = lon = None
    lieu = None
    if o.itineraire_id:
        f = db.query(ItineraireFavori).filter(ItineraireFavori.id == o.itineraire_id,
                                              ItineraireFavori.utilisateur_id == user.id).first()
        try:
            pts = json.loads(f.donnees).get("points") if f else None
            if pts:
                lat, lon, lieu = pts[0][0], pts[0][1], "départ du parcours"
        except (ValueError, TypeError, IndexError, AttributeError):
            pass
    if lat is None and user.adresse_lat is not None and user.adresse_lon is not None:
        lat, lon, lieu = user.adresse_lat, user.adresse_lon, "ton adresse"
    meteo, meteo_etat = None, None
    if jours is None or jours < 0:
        meteo_etat = "passee"
    elif jours > PREVISION_JOURS:
        meteo_etat = "trop_tot"
    elif lat is None:
        meteo_etat = "sans_lieu"
    else:
        h, m = map(int, etat["heure"].split(":"))
        debut = datetime.combine(o.date_cible, time(h, m))
        try:
            meteo = meteo_service.lire(lat, lon, debut, debut + timedelta(seconds=duree or 7200),
                                       user.fuseau_horaire or "Europe/Paris", auj)
        except Exception:
            meteo = None
        meteo_etat = "ok" if meteo else "indisponible"

    temp = None
    if meteo:
        temp = meteo.get("ressentie") if meteo.get("ressentie") is not None else meteo.get("temperature")
    rav = ravitaillement(duree, temp)

    return {
        "objectif": {"id": o.id, "titre": o.titre, "sport": o.sport, "date": o.date_cible.isoformat() if o.date_cible else None,
                     "distance_km": o.distance_km, "dplus_m": o.dplus_m, "temps_cible_sec": o.temps_cible_sec,
                     "itineraire_id": o.itineraire_id, "statut": o.statut},
        "jours": jours,
        "heure": etat["heure"],
        "temps": {"sec": round(duree), "texte": _hmin(duree), "source": source,
                  "allure_sec_km": round(duree / o.distance_km) if o.distance_km else None} if duree else None,
        "fourchette": {k: {"sec": v.get("sec"), "texte": v.get("texte")} for k, v in temps.items()} if temps else None,
        "prediction_raison": (pred or {}).get("raison") if pred and not pred.get("disponible") else None,
        "passages": passages, "par_troncon": par_troncon,
        "profil": (pred or {}).get("profil") if par_troncon else None,
        "meteo": meteo, "meteo_etat": meteo_etat, "meteo_lieu": lieu,
        "ravitaillement": rav,
        "checklist": _checklist(o, duree, meteo, rav),
        "coches": etat["coches"], "ajouts": etat["ajouts"],
        "etapes": _etapes(o.date_cible, auj, duree) if o.date_cible else [],
    }


# ---------------------------------------------------------------------------
# Bibliothèque de séances types
# ---------------------------------------------------------------------------

def _cible(zones: dict[int, dict], bas: int, haut: Optional[int] = None, allure: bool = True) -> str:
    """« Z2, 135–150 bpm, 5:40–6:10 /km » d'après les zones du moment (ce qui est connu)."""
    haut = haut or bas
    nom = f"Z{bas}" if bas == haut else f"Z{bas}–Z{haut}"
    zb, zh = zones.get(bas), zones.get(haut)
    if not zb or not zh:
        return nom
    parts = [nom]
    fmin, fmax = zb.get("fc_min"), zh.get("fc_max")
    if fmin and fmax:
        parts.append(f"{fmin}–{fmax} bpm")
    elif fmax:
        parts.append(f"sous {fmax + 1} bpm")
    elif fmin:
        parts.append(f"au-dessus de {fmin} bpm")
    if allure:
        lente, rapide = zb.get("allure_lente"), zh.get("allure_rapide")
        if lente and rapide:
            parts.append(f"{_mmss(rapide)}–{_mmss(lente)} /km")
        elif rapide:
            parts.append(f"plus lent que {_mmss(rapide)} /km")
        elif lente:
            parts.append(f"plus vite que {_mmss(lente)} /km")
    return ", ".join(parts)


def seances_types(db: Session, user: Utilisateur) -> dict:
    z = zs.zones_actuelles(db, user)
    zones = {x["zone"]: x for x in z.get("zones") or []}
    c = lambda bas, haut=None, allure=True: _cible(zones, bas, haut, allure)  # noqa: E731
    vma = zones.get(5, {}).get("allure_vma")
    # sur 30 secondes la FC n’a pas le temps de monter : on vise une allure ou un effort
    vite = f"allure VMA {_mmss(vma)} /km" if vma else "effort 9/10"

    def s(cle, categorie, titre, sport, duree, rpe, resume, lignes):
        return {"cle": cle, "categorie": categorie, "titre": titre, "sport": sport, "duree_min": duree,
                "rpe_cible": rpe, "resume": resume, "description": "\n".join(lignes)}

    liste = [
        s("footing", "Endurance", "Footing en endurance", "course", 45, 3, "45 min faciles",
          ["Échauffement : 5' très facile",
           f"Corps de séance : 35' en endurance ({c(2)})",
           "Retour au calme : 5' en trottinant",
           "Tu dois pouvoir tenir une conversation du début à la fin."]),
        s("recuperation", "Endurance", "Footing de récupération", "course", 30, 2, "30 min très faciles",
          [f"Corps de séance : 25' très facile ({c(1)})",
           "Retour au calme : 5' de marche",
           "Aucune ambition d'allure : le but est de faire circuler le sang."]),
        s("sortie_longue", "Endurance", "Sortie longue", "course", 90, 4, "1 h 30 en endurance",
          ["Échauffement : 10' très facile",
           f"Corps de séance : 75' en endurance ({c(2)})",
           "Retour au calme : 5' en trottinant",
           "Bois toutes les 20 minutes ; au-delà d'1 h 15, prends un gel pour t'habituer."]),
        s("longue_progressive", "Endurance", "Sortie longue progressive", "course", 100, 5, "1 h 40, fin plus vive",
          ["Échauffement : 10' très facile",
           f"Corps de séance : 60' en endurance ({c(2)})",
           f"Puis : 20' en tempo ({c(3)})",
           "Retour au calme : 10' facile"]),
        s("tempo", "Seuil", "Tempo continu 20 min", "course", 50, 6, "20 min en tempo",
          ["Échauffement : 15' en endurance, puis 3 lignes droites",
           f"Corps de séance : 20' en tempo ({c(3)})",
           "Retour au calme : 10' facile",
           "Allure soutenue mais contrôlée : tu peux dire une phrase courte."]),
        s("seuil_3x10", "Seuil", "Seuil 3 × 10 min", "course", 60, 7, "3 × 10 min au seuil, récup 2 min",
          ["Échauffement : 15' en endurance, puis 3 lignes droites",
           f"Corps de séance : 3 × 10' au seuil ({c(4)}), récup 2' en trottinant",
           "Retour au calme : 10' facile",
           "La dernière répétition doit ressembler à la première."]),
        s("seuil_5x6", "Seuil", "Seuil 5 × 6 min", "course", 60, 7, "5 × 6 min au seuil, récup 1 min 30",
          ["Échauffement : 15' en endurance, puis 3 lignes droites",
           f"Corps de séance : 5 × 6' au seuil ({c(4)}), récup 1'30 en trottinant",
           "Retour au calme : 10' facile"]),
        s("vma_3030", "VMA", "VMA courte 2 × 8 × 30/30", "course", 50, 8, "16 × 30 s vite, 30 s lentes",
          ["Échauffement : 20' en endurance, puis 4 lignes droites",
           f"Bloc 1 : 8 × 30 s vite ({vite}), récup 30 s en trottinant",
           "Récupération : 3' en trottinant",
           f"Bloc 2 : 8 × 30 s vite ({vite}), récup 30 s en trottinant",
           "Retour au calme : 10' facile"]),
        s("vma_5x3", "VMA", "VMA longue 5 × 3 min", "course", 55, 8, "5 × 3 min dures, récup 2 min",
          ["Échauffement : 20' en endurance, puis 4 lignes droites",
           f"Corps de séance : 5 × 3' en {c(5)}, récup 2' en trottinant",
           "Retour au calme : 10' facile",
           "Pars sur une allure que tu peux tenir cinq fois."]),
        s("fartlek", "VMA", "Fartlek 10 × 1 min", "course", 45, 7, "10 × 1 min vite, 1 min lente",
          ["Échauffement : 15' en endurance",
           f"Corps de séance : 10 × 1' vite ({c(4, 5, allure=False)}), récup 1' en trottinant",
           "Retour au calme : 10' facile",
           "Au ressenti, sur chemin si possible."]),
        s("cotes", "Côtes", "Côtes 8 × 45 s", "course", 50, 8, "8 × 45 s en côte",
          ["Échauffement : 20' en endurance jusqu'au pied de la côte",
           "Corps de séance : 8 × 45 s en côte à effort soutenu, récup 1'30 en redescendant",
           "Retour au calme : 10' facile",
           "Côte de 6 à 8 %, foulée courte, regard loin devant."]),
        s("cotes_longues", "Côtes", "Côtes longues 5 × 3 min", "trail", 60, 7, "5 × 3 min en montée",
          ["Échauffement : 20' en endurance",
           f"Corps de séance : 5 × 3' en montée ({c(4, allure=False)}), récup 3' en redescendant",
           "Retour au calme : 10' facile"]),
        s("allure_course", "Spécifique", "Allure de course 2 × 15 min", "course", 65, 6, "2 × 15 min à l'allure visée",
          ["Échauffement : 15' en endurance, puis 3 lignes droites",
           "Corps de séance : 2 × 15' à l'allure visée le jour de la course, récup 3' en trottinant",
           "Retour au calme : 10' facile",
           "Profite-en pour tester la tenue et le ravitaillement du jour J."]),
        s("velo_endurance", "Vélo", "Sortie vélo en endurance", "velo", 90, 3, "1 h 30 facile",
          ["Échauffement : 10' souple",
           f"Corps de séance : 75' en endurance ({c(2, allure=False)})",
           "Retour au calme : 5' souple"]),
        s("velo_tempo", "Vélo", "Vélo 3 × 12 min soutenu", "velo", 75, 6, "3 × 12 min soutenues, récup 4 min",
          ["Échauffement : 15' souple",
           f"Corps de séance : 3 × 12' soutenu ({c(3, 4, allure=False)}), récup 4' souple",
           "Retour au calme : 10' souple"]),
    ]
    return {
        "seances": liste,
        "categories": list(dict.fromkeys(x["categorie"] for x in liste)),
        "zones_connues": bool(zones),
        "allures_connues": any(x.get("allure_lente") or x.get("allure_rapide") for x in zones.values()),
        "fc_seuil": z.get("fc_seuil"),
        "allure_critique_sec_km": z.get("allure_critique_sec_km"),
    }
