"""
Capacités : ce que l'athlète vaut aujourd'hui, et à quel point on peut s'y fier.

- Profil d'athlète : VMA, VO2max, seuil, allure critique, réserve anaérobie, endurance, force,
  poids de forme. Chaque valeur porte sa date, sa tendance sur 3 mois, ce sur quoi elle repose
  et un niveau de confiance ; une estimation trop ancienne est signalée et un test est proposé.
- Radar forces / faiblesses : chaque qualité en % du record personnel, aujourd'hui et il y a un an.
- Musculation : séries par groupe musculaire, progression par exercice, 1RM estimé,
  séries proches de l'échec. Lu dans les séances guidées (déroulé) et, à défaut, dans les notes.
"""
import re
import unicodedata
from collections import defaultdict
from datetime import date, timedelta
from statistics import median
from typing import Optional

from sqlalchemy.orm import Session

import capacites_avancees
import prediction_service
import tests_service
import carnet_service as cs
from models import Activite, PoidsUtilisateur, SeancePrevue, Utilisateur

TENDANCE_J = 91          # « tendance 3 mois »
FENETRE_J = 90           # fenêtre « actuelle » du radar et des repères de force


def _r(x, n=1):
    return None if x is None else round(x, n)


def _fr(x: float, n: int = 1) -> str:
    return f"{x:.{n}f}".replace(".", ",")


def _mmss(sec) -> str:
    sec = int(round(sec))
    return f"{sec // 60}:{sec % 60:02d}"


def il_y_a(jours: Optional[int]) -> str:
    if jours is None:
        return "date inconnue"
    if jours <= 0:
        return "aujourd'hui"
    if jours == 1:
        return "hier"
    if jours < 60:
        return f"il y a {jours} jours"
    mois = round(jours / 30.44)
    return f"il y a {mois} mois" if mois < 24 else f"il y a {round(jours / 365.25)} ans"


def _age(iso: Optional[str], auj: date) -> Optional[int]:
    return (auj - date.fromisoformat(iso[:10])).days if iso else None


def _pl(n: int, mot: str, pluriel: Optional[str] = None) -> str:
    return f"{n} {mot if n <= 1 else (pluriel or mot + 's')}"


# ---------------------------------------------------------------------------
# Musculation
# ---------------------------------------------------------------------------

GROUPES = [
    ("dos", "Dos"), ("pectoraux", "Pectoraux"), ("epaules", "Épaules"), ("biceps", "Biceps"),
    ("triceps", "Triceps"), ("abdos", "Abdos"), ("lombaires", "Lombaires"), ("fessiers", "Fessiers"),
    ("quadriceps", "Quadriceps"), ("ischios", "Ischios"), ("mollets", "Mollets"),
]
REGIONS = {"dos": "tirage", "biceps": "tirage", "pectoraux": "poussee", "epaules": "poussee", "triceps": "poussee",
           "abdos": "tronc", "lombaires": "tronc", "fessiers": "jambes", "quadriceps": "jambes",
           "ischios": "jambes", "mollets": "jambes"}
REGIONS_LABELS = [("tirage", "Tirage"), ("poussee", "Poussée"), ("tronc", "Tronc"), ("jambes", "Jambes")]

_TIR = {"dos": 1, "biceps": 0.5}
_POUSSE = {"pectoraux": 1, "triceps": 0.5, "epaules": 0.5}
_ABDOS = {"abdos": 1}
_CUISSES = {"quadriceps": 1, "fessiers": 0.5}
_CHAINE = {"ischios": 1, "fessiers": 0.5, "lombaires": 0.5}
# (mots tous présents dans le nom, nom affiché, groupes sollicités : 1 = principal, 0,5 = secondaire)
# Du plus précis au plus général : la première règle qui correspond l'emporte.
CATALOGUE = [
    (("negative",), "Tractions négatives", _TIR),
    (("traction",), "Tractions", _TIR), (("pull-up",), "Tractions", _TIR), (("chin",), "Tractions", _TIR),
    (("australienne",), "Australiennes", _TIR),
    (("rowing",), "Rowing", _TIR), (("tirage",), "Tirage", _TIR),
    (("face", "pull"), "Face pull", {"epaules": 1, "dos": 0.5}), (("oiseau",), "Oiseau", {"epaules": 1, "dos": 0.5}),
    (("dip",), "Dips", {"triceps": 1, "pectoraux": 0.5, "epaules": 0.5}),
    (("pompe",), "Pompes", _POUSSE), (("push-up",), "Pompes", _POUSSE),
    (("militaire",), "Développé militaire", {"epaules": 1, "triceps": 0.5}),
    (("pike",), "Pompes piquées", {"epaules": 1, "triceps": 0.5}),
    (("developpe",), "Développé", _POUSSE),
    (("mollet",), "Mollets", {"mollets": 1}), (("talon",), "Mollets", {"mollets": 1}), (("pointe",), "Mollets", {"mollets": 1}),
    (("releve", "jambe"), "Relevés de jambes", _ABDOS), (("elevation", "jambe"), "Relevés de jambes", _ABDOS),
    (("elevation",), "Élévations latérales", {"epaules": 1}),
    (("kickback",), "Kickback triceps", {"triceps": 1}), (("triceps",), "Extension triceps", {"triceps": 1}),
    (("leg", "curl"), "Leg curl", {"ischios": 1}),
    (("curl", "marteau"), "Curl marteau", {"biceps": 1}), (("curl",), "Curl", {"biceps": 1}),
    (("planche",), "Planche", _ABDOS), (("gainage",), "Gainage", _ABDOS), (("hollow",), "Hollow", _ABDOS),
    (("sit-up",), "Sit-ups", _ABDOS), (("situp",), "Sit-ups", _ABDOS), (("crunch",), "Crunchs", _ABDOS),
    (("russian",), "Rotations russes", _ABDOS), (("mountain",), "Mountain climbers", _ABDOS),
    (("dead", "bug"), "Dead bug", _ABDOS), (("abdo",), "Abdos", _ABDOS),
    (("superman",), "Superman", {"lombaires": 1}), (("lombaire",), "Lombaires", {"lombaires": 1}),
    (("bird", "dog"), "Bird dog", {"lombaires": 1, "abdos": 0.5}),
    (("pont",), "Pont fessier", {"fessiers": 1, "ischios": 0.5}), (("hip", "thrust"), "Hip thrust", {"fessiers": 1, "ischios": 0.5}),
    (("bulgare",), "Fentes bulgares", _CUISSES), (("fente",), "Fentes", _CUISSES), (("step",), "Step-up", _CUISSES),
    (("pistol",), "Pistol squat", _CUISSES), (("goblet",), "Squat goblet", _CUISSES), (("squat",), "Squats", _CUISSES),
    (("leg", "extension"), "Leg extension", {"quadriceps": 1}),
    (("souleve",), "Soulevé de terre", _CHAINE), (("deadlift",), "Soulevé de terre", _CHAINE),
    (("good", "morning"), "Good morning", _CHAINE), (("nordic",), "Nordic curl", {"ischios": 1}),
    (("fessier",), "Fessiers", {"fessiers": 1}),
    (("abduction",), "Abduction de hanche", {"fessiers": 1}), (("clamshell",), "Abduction de hanche", {"fessiers": 1}),
]
POIDS_DE_CORPS = {"Tractions", "Dips", "Pompes"}

_RE_KG = re.compile(r"(\d{1,3}(?:[.,]\d{1,2})?)\s*kg", re.I)
_RE_PRESC = re.compile(r"(\d{1,2})\s*[×x*]\s*(\d{1,3})(?:\s*(?:-|–|à)\s*\d{1,3})?\s*(s\b|sec\b|min\b|['′])?", re.I)


def _plat(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")


def identifier(nom: str) -> tuple[str, dict]:
    """Nom libre → (nom affiché, groupes musculaires). Exercice inconnu : nom raccourci, aucun groupe."""
    court = re.split(r"[,(:]", nom or "")[0].strip()
    p = _plat(court)
    for mots, joli, groupes in CATALOGUE:
        if all(m in p for m in mots):
            return joli, groupes
    court = " ".join(court.split()[:4])
    return (court[:1].upper() + court[1:]) if court else "Exercice", {}


def _reps_exercice(e: dict, description: str) -> tuple[Optional[float], Optional[int]]:
    """(répétitions par série, durée tenue en s) d'un exercice du déroulé."""
    brut = str(e.get("reps") or "").strip()
    m = re.match(r"(\d{1,3})\s*(s\b|sec\b|min\b|['′])?", brut, re.I) if brut else None
    if m:
        n, u = int(m[1]), (m[2] or "").lower()
        return (None, n * (60 if u in ("min", "'", "′") else 1)) if u else (float(n), None)
    m = _RE_PRESC.search(str(e.get("prescription") or ""))
    if not m and e.get("numero") and description:
        # EMOM : les répétitions ne sont que dans le texte de la séance (« 1. Dips en EMOM : 10 × 8 »)
        ligne = re.search(rf"^\s*{re.escape(str(e['numero']))}\.\s[^\n]*", description, re.M)
        m = _RE_PRESC.search(ligne[0]) if ligne else None
    if not m:
        return None, None
    n, u = int(m[2]), (m[3] or "").lower()
    return (None, n * (60 if u in ("min", "'", "′") else 1)) if u else (float(n), None)


def series_realisees(db: Session, user_id: int, acts: list[Activite], auj: date) -> list[dict]:
    """Une ligne par exercice réalisé : séances guidées d'abord, notes libres pour les jours sans séance guidée."""
    out, jours_guides = [], set()
    for p in db.query(SeancePrevue).filter(SeancePrevue.utilisateur_id == user_id, SeancePrevue.deroule.isnot(None)):
        d = cs.lire_deroule(p)
        if not d or not d.get("fin"):
            continue
        try:
            jour = date.fromisoformat(str(d.get("debut") or "")[:10])
        except ValueError:
            jour = p.jour
        if jour > auj:
            continue
        jours_guides.add(jour)
        for e in d.get("exercices") or []:
            if not isinstance(e, dict) or e.get("passe") or not e.get("series_faites"):
                continue
            nom, groupes = identifier(str(e.get("nom") or ""))
            reps, tenue = _reps_exercice(e, p.description or "")
            charge = str(e.get("charge") or "")
            kg = _RE_KG.search(charge)
            out.append({"jour": jour, "nom": nom, "groupes": groupes, "series": int(e["series_faites"]), "reps": reps,
                        "tenue_s": tenue, "kg": float(kg[1].replace(",", ".")) if kg else None,
                        "par_main": "par main" in charge.lower() or "par bras" in charge.lower(),
                        "difficulte": e.get("difficulte") if e.get("difficulte") in cs.DIFFICULTES else None,
                        "max": False, "source": "guidee"})
    import suivi_service as sv
    for a in acts:
        if a.sport not in ("muscu", "hiit") or a.debut.date() in jours_guides or not a.notes:
            continue
        for e in sv.exercices_muscu(a.notes):
            nom, groupes = identifier(e["nom"])
            out.append({"jour": a.debut.date(), "nom": nom, "groupes": groupes, "series": int(e["series"]),
                        "reps": float(e["reps"]), "tenue_s": None, "kg": e.get("kg"), "par_main": False,
                        "difficulte": None, "max": bool(e.get("max")), "source": "notes"})
    out.sort(key=lambda x: x["jour"])
    return out


def _perf(x: dict) -> Optional[float]:
    """Performance d'une ligne, comparable d'une séance à l'autre pour un même exercice."""
    if x["kg"] and x["reps"]:
        return x["kg"] * (1 + min(x["reps"], 20) / 30)      # 1RM estimé (Epley)
    return x["reps"] or x["tenue_s"]


def _poids_corps(db: Session, user: Utilisateur) -> Optional[float]:
    p = (db.query(PoidsUtilisateur).filter(PoidsUtilisateur.utilisateur_id == user.id)
         .order_by(PoidsUtilisateur.enregistre_le.desc()).first())
    return p.poids_kg if p else user.poids_kg


def musculation(db: Session, user: Utilisateur, acts: list[Activite], auj: date, semaines: int = 12) -> dict:
    lignes = series_realisees(db, user.id, acts, auj)
    seances_muscu = [a for a in acts if a.sport in ("muscu", "hiit")]
    pdc = _poids_corps(db, user)

    def volume(debut: date, fin: date) -> dict[str, float]:
        v: dict[str, float] = defaultdict(float)
        for x in lignes:
            if debut <= x["jour"] <= fin:
                for g, poids in x["groupes"].items():
                    v[g] += x["series"] * poids
        return v

    # Carte du corps : séries des 7 derniers jours, comparées à l'habitude des 4 semaines d'avant
    v7 = volume(auj - timedelta(days=6), auj)
    v28 = volume(auj - timedelta(days=34), auj - timedelta(days=7))
    carte = []
    for g, label in GROUPES:
        s7, hab = v7.get(g, 0.0), v28.get(g, 0.0) / 4
        carte.append({"groupe": g, "label": label, "region": REGIONS[g], "series_7j": _r(s7), "habituel": _r(hab),
                      "niveau": 0 if s7 <= 0 else 1 if s7 < 4 else 2 if s7 < 10 else 3})

    # Volume hebdomadaire par région
    lundi0 = cs._lundi(auj)
    hebdo = []
    for k in range(semaines - 1, -1, -1):
        lundi = lundi0 - timedelta(weeks=k)
        v = volume(lundi, lundi + timedelta(days=6))
        ligne = {"semaine": lundi.isoformat(), "seances": sum(1 for a in seances_muscu if cs._lundi(a.debut.date()) == lundi)}
        for r, _ in REGIONS_LABELS:
            ligne[r] = _r(sum(s for g, s in v.items() if REGIONS[g] == r))
        ligne["total"] = _r(sum(ligne[r] for r, _ in REGIONS_LABELS))
        hebdo.append(ligne)

    # Progression par exercice : une ligne par séance
    par_ex: dict[str, dict[date, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for x in lignes:
        par_ex[x["nom"]][x["jour"]].append(x)
    exercices = []
    for nom, jours in par_ex.items():
        histo = []
        for j in sorted(jours):
            xs = jours[j]
            charges = [x for x in xs if x["kg"] and x["reps"]]
            rm = max((_perf(x) for x in charges), default=None)
            reps = max((x["reps"] for x in xs if x["reps"]), default=None)
            travail = [x for x in xs if not x["max"]]
            histo.append({
                "date": j.isoformat(), "reps": _r(reps), "tenue_s": max((x["tenue_s"] for x in xs if x["tenue_s"]), default=None),
                "series": sum(x["series"] for x in travail) or None,
                "total_reps": round(sum(x["series"] * x["reps"] for x in travail if x["reps"])) or None,
                "kg": max((x["kg"] for x in xs if x["kg"]), default=None), "rm": _r(rm),
                "difficulte": next((d for d in ("echec", "dur", "correct", "facile") if any(x["difficulte"] == d for x in xs)), None),
                "test": any(x["max"] for x in xs),
            })
        mesure = "rm" if any(h["rm"] for h in histo) else "reps" if any(h["reps"] for h in histo) else "tenue_s"
        pts = [h for h in histo if h[mesure]]
        if not pts:
            continue
        meilleur = max(pts, key=lambda h: h[mesure])
        groupes = next(iter(jours.values()))[0]["groupes"]
        e = {"nom": nom, "mesure": mesure, "nb": len(histo), "derniere": histo[-1]["date"],
             "groupes": [g for g, p in groupes.items() if p == 1], "par_main": any(x["par_main"] for xs in jours.values() for x in xs),
             "meilleur": {"valeur": meilleur[mesure], "date": meilleur["date"]},
             "actuel": pts[-1][mesure], "debut": pts[0][mesure], "historique": histo[-40:]}
        if nom in POIDS_DE_CORPS and mesure == "reps" and pdc:
            # Au poids du corps : lest qu'on pourrait soulever une fois, d'après la meilleure série
            e["lest_kg"] = _r(pdc * min(meilleur["reps"], 20) / 30)
        exercices.append(e)
    exercices.sort(key=lambda e: (-e["nb"], e["nom"]))

    # Séries proches de l'échec : ressenti noté à la fin de chaque exercice des séances guidées
    echec = []
    for k in range(7, -1, -1):
        lundi = lundi0 - timedelta(weeks=k)
        ligne = {"semaine": lundi.isoformat(), **{d: 0 for d in cs.DIFFICULTES}}
        for x in lignes:
            if x["difficulte"] and lundi <= x["jour"] <= lundi + timedelta(days=6):
                ligne[x["difficulte"]] += x["series"]
        echec.append(ligne)
    notees = [x for x in lignes if x["difficulte"] and x["jour"] > auj - timedelta(days=28)]
    tot = sum(x["series"] for x in notees)
    proches = sum(x["series"] for x in notees if x["difficulte"] in ("dur", "echec"))

    recents = [x for x in lignes if x["jour"] > auj - timedelta(days=28)]
    return {
        "carte": carte, "hebdo": hebdo, "exercices": exercices[:24],
        "echec": {"semaines": echec if any(sum(l[d] for d in cs.DIFFICULTES) for l in echec) else [],
                  "series_4s": tot, "proches_4s": proches, "part_pct": round(proches / tot * 100) if tot else None},
        "series_7j": _r(sum(v7.values())), "poids_corps_kg": _r(pdc),
        "nb_seances": len(seances_muscu), "nb_seances_4s": sum(1 for a in seances_muscu if a.debut.date() > auj - timedelta(days=28)),
        "nb_lignes": len(lignes), "sources_4s": {s: len({x["jour"] for x in recents if x["source"] == s}) for s in ("guidee", "notes")},
        "inconnus": sorted({x["nom"] for x in recents if not x["groupes"]})[:8],
        "_lignes": lignes,
    }


def _indice_force(lignes: list[dict], debut: date, fin: date) -> tuple[Optional[float], int]:
    """Force sur une fenêtre, en % des records : moyenne, par exercice, de la meilleure performance / record."""
    records: dict[str, float] = {}
    fen: dict[str, float] = {}
    for x in lignes:
        p = _perf(x)
        if not p or not x["groupes"] or x["jour"] > fin:
            continue
        cle = f"{x['nom']}|{'kg' if x['kg'] else 'reps' if x['reps'] else 's'}"
        records[cle] = max(records.get(cle, 0), p)
        if debut < x["jour"]:
            fen[cle] = max(fen.get(cle, 0), p)
    if not fen:
        return None, 0
    return sum(v / records[c] for c, v in fen.items()) / len(fen) * 100, len(fen)


def _repere_force(m: dict, auj: date) -> Optional[dict]:
    """Repère de force du profil : tractions (répétitions par série) si elles existent, sinon l'exercice le plus suivi."""
    ex = next((e for e in m["exercices"] if e["nom"] == "Tractions"), None) or next(
        (e for e in m["exercices"] if e["mesure"] in ("rm", "reps")), None)
    if not ex:
        return None
    mes = ex["mesure"]

    def meilleur(debut: date, fin: date):
        pts = [h for h in ex["historique"] if h[mes] and debut < date.fromisoformat(h["date"]) <= fin]
        return max(pts, key=lambda h: h[mes]) if pts else None
    act = meilleur(auj - timedelta(days=FENETRE_J), auj)
    avant = meilleur(auj - timedelta(days=2 * FENETRE_J), auj - timedelta(days=FENETRE_J))
    n = sum(1 for h in ex["historique"] if h[mes] and date.fromisoformat(h["date"]) > auj - timedelta(days=FENETRE_J))
    ref = act or max((h for h in ex["historique"] if h[mes]), key=lambda h: h["date"])
    return {"exercice": ex["nom"], "mesure": mes, "valeur": ref[mes], "date": ex["derniere"] if act else ref["date"], "n": n,
            "avant": avant[mes] if avant and act else None, "lest_kg": ex.get("lest_kg")}


# ---------------------------------------------------------------------------
# Profil d'athlète
# ---------------------------------------------------------------------------

TESTS = {
    "demi_cooper": "Demi-Cooper (6 min à fond)",
    "seuil_30": "30 min au seuil",
    "cs_3_10": "3 min + 10 min à fond",
    "sortie_longue": "Sortie longue régulière (75 min et plus)",
    "traction_max": "Maximum de tractions",
}


def _confiance(n: int, age: Optional[int], n_haut: int, age_frais: int, age_perime: int) -> tuple[str, bool]:
    """(haute | moyenne | faible, encore fraîche ?)"""
    if age is None:
        return "faible", False
    if n >= n_haut and age <= age_frais:
        return "haute", True
    if n <= max(1, n_haut // 3) or age > age_perime:
        return "faible", age <= age_perime
    return "moyenne", True


def _tendance(delta: Optional[float], texte: str, bon_si_hausse: Optional[bool], seuil: float) -> Optional[dict]:
    if delta is None:
        return None
    sens = "stable" if abs(delta) < seuil else "hausse" if delta > 0 else "baisse"
    bon = None if sens == "stable" or bon_si_hausse is None else (sens == "hausse") == bon_si_hausse
    return {"sens": sens, "texte": texte, "bon": bon}


def _signe(v: float, n: int = 1) -> str:
    return ("+" if v > 0 else "−" if v < 0 else "") + _fr(abs(v), n)


def _manque(cle: str, label: str, raison: str, test: Optional[str] = None, ancre: Optional[str] = None) -> dict:
    return {"cle": cle, "label": label, "texte": None, "raison": raison, "confiance": None, "frais": False,
            "test": test, "ancre": ancre}


def _fiche(cle, label, valeur, texte, unite, jour: Optional[str], base: str, confiance: tuple[str, bool], auj: date,
           tendance=None, test=None, ancre=None, detail=None, source=None) -> dict:
    niveau, frais = confiance
    return {"cle": cle, "label": label, "valeur": valeur, "texte": texte, "unite": unite, "date": jour,
            "age_j": _age(jour, auj), "base": base, "confiance": niveau, "frais": frais, "tendance": tendance,
            "test": test if (niveau == "faible" or not frais) else None, "ancre": ancre, "detail": detail, "source": source}


def _p_vma(vma: dict, auj: date) -> dict:
    act = vma.get("actuelle")
    if not act or not act.get("vma"):
        return _manque("vma", "VMA", "Pas encore d'estimation : il faut des sorties avec tracé GPS ou un test.", "demi_cooper", "vma")
    eff = [s for s in vma["seances"] if s["source"] == "effort" and _age(s["date"], auj) < 56]
    fc = [s for s in vma["seances"] if s["source"] == "fc" and _age(s["date"], auj) < 28]
    n = len(eff) + len(fc)
    dern = max((s["date"] for s in eff + fc), default=None)
    age = _age(dern, auj) if dern else _age(act["semaine"], auj)
    test = vma.get("dernier_test")
    age_test = _age(test["date"], auj) if test else None
    base = (f"{_pl(n, 'séance')} sur 8 semaines, la dernière {il_y_a(age)}" if n else f"ta dernière estimation, {il_y_a(age)}")
    base += f" · dernier test {il_y_a(age_test)}" if test else " · jamais calée sur un test"
    conf = _confiance(n, age, 6, 21, 60)
    if conf[0] == "haute" and (age_test is None or age_test > 180):
        conf = ("moyenne", True)          # sans test récent, l'estimation n'est pas calée
    pts = [p for p in vma["points"] if p["estimee"]]
    ref = next((p for p in reversed(pts) if _age(p["semaine"], auj) >= TENDANCE_J - 3), None)
    delta = act["vma"] - ref["estimee"] if ref and _age(ref["semaine"], auj) <= TENDANCE_J + 30 else None
    f = _fiche("vma", "VMA", act["vma"], _fr(act["vma"]), "km/h", dern or act["semaine"], base, conf, auj,
               _tendance(delta, f"{_signe(delta)} km/h" if delta is not None else "", True, 0.15),
               "demi_cooper", "vma", detail=f"soit {_mmss(3600 / act['vma'])}/km")
    if not f["test"] and (age_test is None or age_test > 120):
        f["test"] = "demi_cooper"
        f["raison_test"] = f"VMA : dernier test {il_y_a(age_test)}" if test else "VMA : jamais calée sur un test"
    return f


def _p_vo2max(mesures: dict, vma_fiche: dict, auj: date) -> dict:
    serie = mesures.get("vo2max") or {}
    recents = sorted(d for d in serie if (auj - d).days <= 120)
    if recents:
        d = recents[-1]
        n = sum(1 for x in recents if (auj - x).days <= 90)
        avant = [serie[x] for x in serie if TENDANCE_J - 20 <= (auj - x).days <= TENDANCE_J + 20]
        delta = serie[d] - median(avant) if avant else None
        return _fiche("vo2max", "VO2max", _r(serie[d]), _fr(serie[d]), "ml/kg/min", d.isoformat(),
                      f"la mesure de ta montre : {_pl(n, 'relevé')} sur 3 mois, le dernier {il_y_a((auj - d).days)}",
                      _confiance(n, (auj - d).days, 6, 21, 60), auj,
                      _tendance(delta, f"{_signe(delta)}" if delta is not None else "", True, 0.4),
                      "demi_cooper", "saisons", source="montre")
    if vma_fiche.get("valeur"):
        v = vma_fiche["valeur"] * 3.5
        niveau = "moyenne" if vma_fiche["confiance"] == "haute" else vma_fiche["confiance"]
        f = _fiche("vo2max", "VO2max", _r(v), _fr(v), "ml/kg/min", vma_fiche["date"],
                   "ta VMA (VMA × 3,5), faute de mesure de la montre", (niveau, vma_fiche["frais"]), auj,
                   None, "demi_cooper", "vma", source="vma")
        return f
    return _manque("vo2max", "VO2max", "Ni mesure de la montre ni VMA estimée.", "demi_cooper")


def _p_seuil(cands: list, user: Utilisateur, auj: date) -> dict:
    import zones_service as zs
    ref = zs.fc_seuil_au(cands, auj, user.fc_max)
    if not ref:
        return _manque("seuil_fc", "Seuil (FC)", "Aucun effort soutenu de 20 min ou plus avec cardio sur 12 mois.", "seuil_30", "zones")
    age = _age(ref["date"], auj)
    avant = zs.fc_seuil_au(cands, auj - timedelta(days=TENDANCE_J), user.fc_max)
    delta = ref["valeur"] - avant["valeur"] if avant else None
    n = ref["nb_efforts"]
    return _fiche("seuil_fc", "Seuil (FC)", ref["valeur"], str(ref["valeur"]), "bpm", ref["date"],
                  f"le meilleur de {_pl(n, 'effort soutenu', 'efforts soutenus')} sur 12 mois, retenu {il_y_a(age)}",
                  _confiance(n, age, 6, 90, 240), auj,
                  _tendance(delta, f"{_signe(delta, 0)} bpm" if delta is not None else "", None, 1.5),
                  "seuil_30", "zones", detail=f"{round(ref['valeur'] / user.fc_max * 100)} % de ta FC max" if user.fc_max else None)


def _p_critique(efforts: dict, auj: date) -> tuple[dict, dict]:
    import analyses_service as an
    vc = efforts.get("vc")
    if not vc:
        raison = "Il faut au moins 3 efforts francs de 3 à 20 min sur les 90 derniers jours."
        return (_manque("allure_critique", "Allure critique", raison, "cs_3_10", "efforts"),
                _manque("dprime", "Réserve anaérobie", raison, "cs_3_10", "efforts"))
    dates = [c["actuel"]["date"] for c in efforts["courbe"] if c["minutes"] in an.DUREES_CS and c.get("actuel")]
    dern, ancien = max(dates), min(dates)
    age = _age(dern, auj)
    n = vc["n"]
    base = f"{_pl(n, 'effort')} de 3 à 20 min, le dernier {il_y_a(age)}, le plus ancien {il_y_a(_age(ancien, auj))}"
    conf = _confiance(n, age, 4, 30, 75)
    h = efforts.get("historique") or []
    ref = h[-4] if len(h) >= 4 else None
    d_al = vc["allure_sec_km"] - ref["allure_sec_km"] if ref and ref.get("allure_sec_km") else None
    d_dp = vc["dprime_m"] - ref["dprime_m"] if ref and ref.get("dprime_m") else None
    return (
        _fiche("allure_critique", "Allure critique", vc["allure_sec_km"], _mmss(vc["allure_sec_km"]), "/km", dern, base, conf, auj,
               _tendance(-d_al if d_al is not None else None, f"{_signe(d_al, 0)} s/km" if d_al is not None else "", True, 2),
               "cs_3_10", "efforts", detail=f"{_fr(vc['vitesse_ms'] * 3.6)} km/h, tenable 30 à 40 min"),
        _fiche("dprime", "Réserve anaérobie", vc["dprime_m"], str(vc["dprime_m"]), "m", dern, base, conf, auj,
               _tendance(d_dp, f"{_signe(d_dp, 0)} m" if d_dp is not None else "", True, 12),
               "cs_3_10", "efforts", detail="distance au-dessus de l'allure critique (D′)"),
    )


def _p_endurance(course: dict, auj: date) -> dict:
    tous = [d for d in course.get("durabilites") or [] if d.get("durabilite_pct") is not None]
    rec = [d for d in tous if _age(d["date"], auj) <= 180]
    if not rec:
        return _manque("endurance", "Endurance", "Aucune sortie de 75 min ou plus avec cardio sur 6 mois.", "sortie_longue", "efforts")
    der = rec[-5:]
    v = median(d["durabilite_pct"] for d in der)
    age = _age(der[-1]["date"], auj)
    a = [d["durabilite_pct"] for d in tous if _age(d["date"], auj) <= 90]
    b = [d["durabilite_pct"] for d in tous if 90 < _age(d["date"], auj) <= 180]
    delta = median(a) - median(b) if len(a) >= 2 and len(b) >= 2 else None
    lecture = "solide" if v < 3 else "correcte" if v < 6 else "à travailler"
    return _fiche("endurance", "Endurance", _r(v), _fr(v), "%", der[-1]["date"],
                  f"la médiane de {_pl(len(der), 'sortie longue', 'sorties longues')}, la dernière {il_y_a(age)}",
                  _confiance(len(der), age, 4, 30, 90), auj,
                  _tendance(-delta if delta is not None else None, f"{_signe(delta)} pt" if delta is not None else "", True, 0.7),
                  "sortie_longue", "efforts", detail=f"perte d'efficacité en fin de sortie : {lecture}")


def _p_force(m: dict, auj: date) -> dict:
    r = _repere_force(m, auj)
    if not r:
        return _manque("force", "Force", "Aucune série lue : lance tes séances de muscu en mode guidé ou note-les (« Dips 4x8 »).",
                       "traction_max", "muscu")
    age = _age(r["date"], auj)
    if r["mesure"] == "rm":
        texte, unite, pas = _fr(r["valeur"]), "kg", 1.0
        detail = f"{r['exercice']} · 1RM estimé"
    else:
        texte, unite, pas = _fr(r["valeur"], 0 if float(r["valeur"]).is_integer() else 1), "reps", 0.5
        detail = f"{r['exercice']} · meilleure série" + (f" · ≈ +{_fr(r['lest_kg'], 0)} kg de lest sur une rep" if r.get("lest_kg") else "")
    delta = r["valeur"] - r["avant"] if r.get("avant") is not None else None
    return _fiche("force", "Force", r["valeur"], texte, unite, r["date"],
                  f"{_pl(r['n'], 'séance')} avec cet exercice sur 3 mois, la dernière {il_y_a(age)}",
                  _confiance(r["n"], age, 6, 14, 45), auj,
                  _tendance(delta, f"{_signe(delta, 1 if r['mesure'] == 'rm' else 0)} {unite}" if delta is not None else "", True, pas),
                  "traction_max", "muscu", detail=detail)


def _p_poids(db: Session, user: Utilisateur, vma: dict, auj: date) -> dict:
    pesees = sorted(((p.enregistre_le.date(), p.poids_kg) for p in db.query(PoidsUtilisateur).filter(
        PoidsUtilisateur.utilisateur_id == user.id) if p.enregistre_le.date() <= auj))
    if not pesees:
        return _manque("poids_forme", "Poids de forme", "Aucune pesée enregistrée.", ancre="poids")
    semaine = [k for d, k in pesees if (auj - d).days < 7]
    actuel = sum(semaine) / len(semaine) if semaine else pesees[-1][1]
    age = (auj - pesees[-1][0]).days
    # Poids de forme : poids moyen autour des meilleures performances des 2 dernières années
    perfs = sorted((s for s in vma.get("seances") or [] if s["source"] == "effort" and _age(s["date"], auj) <= 730),
                   key=lambda s: -s["vma"])
    retenues: list[tuple[date, float]] = []
    for s in perfs:
        j = date.fromisoformat(s["date"])
        if any(abs((j - d).days) < 21 for d, _ in retenues):
            continue
        autour = [k for d, k in pesees if abs((d - j).days) <= 10]
        if autour:
            retenues.append((j, sum(autour) / len(autour)))
        if len(retenues) == 3:
            break
    if not retenues:
        return {**_manque("poids_forme", "Poids de forme",
                          "Pas de pesée autour de tes meilleures performances : continue à te peser, le repère viendra.", ancre="poids"),
                "detail": f"poids actuel {_fr(actuel)} kg"}
    forme = sum(k for _, k in retenues) / len(retenues)
    ecart = actuel - forme
    n = len(retenues)
    return _fiche("poids_forme", "Poids de forme", _r(forme), _fr(forme), "kg", max(d for d, _ in retenues).isoformat(),
                  f"ton poids moyen autour de tes {_pl(n, 'meilleure performance', 'meilleures performances')} sur 2 ans · "
                  f"dernière pesée {il_y_a(age)}",
                  ("haute" if n >= 3 else "moyenne" if n == 2 else "faible", age <= 21), auj,
                  None, None, "poids", detail=f"aujourd'hui {_fr(actuel)} kg ({_signe(ecart)} kg)")


AXES = [("vitesse", "Vitesse", "1", "1 min"), ("vma", "VMA", "5", "5 min"), ("seuil", "Seuil", "20", "20 min"),
        ("endurance", "Endurance", "60", "1 h")]


def _radar(acts: list[Activite], lignes: list[dict], auj: date) -> dict:
    """Chaque qualité en % du record personnel : 90 derniers jours et même fenêtre il y a un an."""
    pts = []
    for a in acts:
        if a.sport not in cs.SPORTS_PIED:
            continue
        eff = cs._details_dict(a).get("efforts") or {}
        pts.append((a.debut.date(), eff.get("d") or {}, eff.get("vam")))
    fen_act = (auj - timedelta(days=FENETRE_J), auj)
    fen_an = (auj - timedelta(days=365 + FENETRE_J), auj - timedelta(days=365))

    def meilleur(lire, fen=None):
        xs = [v for j, d, vam in pts if (fen is None or fen[0] < j <= fen[1]) and (v := lire(d, vam))]
        return max(xs) if xs else None

    axes = []
    for cle, label, m, duree in AXES:
        lire = lambda d, vam, m=m: d.get(m)
        rec, act, an_ = meilleur(lire), meilleur(lire, fen_act), meilleur(lire, fen_an)
        allure = lambda v: f"{_mmss(int(m) * 60 / (v / 1000))}/km sur {duree}" if v else None
        axes.append({"cle": cle, "label": label, "actuel": _r(act / rec * 100, 0) if act and rec else None,
                     "an": _r(an_ / rec * 100, 0) if an_ and rec else None,
                     "detail": allure(act), "detail_an": allure(an_), "detail_record": allure(rec)})
    lire = lambda d, vam: vam
    rec, act, an_ = meilleur(lire), meilleur(lire, fen_act), meilleur(lire, fen_an)
    vam = lambda v: f"{round(v)} m/h en montée" if v else None
    axes.append({"cle": "montee", "label": "Montée", "actuel": _r(act / rec * 100, 0) if act and rec else None,
                 "an": _r(an_ / rec * 100, 0) if an_ and rec else None,
                 "detail": vam(act), "detail_an": vam(an_), "detail_record": vam(rec)})
    f_act, n_act = _indice_force(lignes, *fen_act)
    f_an, n_an = _indice_force(lignes, *fen_an)
    axes.append({"cle": "force", "label": "Force", "actuel": _r(f_act, 0), "an": _r(f_an, 0),
                 "detail": f"{_pl(n_act, 'exercice')} suivis" if n_act else None,
                 "detail_an": f"{_pl(n_an, 'exercice')} suivis" if n_an else None, "detail_record": None})
    notes = [x for x in axes if x["actuel"] is not None]
    fort = max(notes, key=lambda x: x["actuel"], default=None)
    faible = min(notes, key=lambda x: x["actuel"], default=None)
    progres = [x for x in axes if x["actuel"] is not None and x["an"] is not None]
    return {"axes": axes, "fort": fort and fort["cle"], "faible": faible and faible["cle"] if faible is not fort else None,
            "compare": len(progres) >= 3,
            "mieux": [x["cle"] for x in progres if x["actuel"] - x["an"] >= 2],
            "moins": [x["cle"] for x in progres if x["an"] - x["actuel"] >= 2]}


def profil(db: Session, user: Utilisateur, acts: list[Activite], mesures: dict, vma: dict, efforts: dict,
           course: dict, cands_seuil: list, m: dict, auj: date) -> dict:
    f_vma = _p_vma(vma, auj)
    critique, dprime = _p_critique(efforts, auj)
    fiches = [f_vma, _p_vo2max(mesures, f_vma, auj), _p_seuil(cands_seuil, user, auj), critique, dprime,
              _p_endurance(course, auj), _p_force(m, auj), _p_poids(db, user, vma, auj)]
    # Tests à proposer : une ligne par test, avec la raison la plus parlante
    tests, vus = [], set()
    for f in fiches:
        t = f.get("test")
        if not t or t in vus:
            continue
        vus.add(t)
        if f.get("raison_test"):
            raison = f["raison_test"]
        elif f.get("texte") is None:
            raison = f"{f['label']} : pas encore mesurable"
        elif not f["frais"]:
            raison = f"{f['label']} : estimation ancienne ({il_y_a(f['age_j'])})"
        elif f["confiance"] == "faible":
            raison = f"{f['label']} : repose sur trop peu d'efforts"
        else:
            raison = f"{f['label']} : à confirmer"
        tests.append({"cle": t, "label": TESTS[t], "raison": raison})
    connues = [f for f in fiches if f.get("texte") is not None]
    return {
        "fiches": fiches, "tests": tests, "radar": _radar(acts, m["_lignes"], auj),
        "bilan": {"total": len(fiches), "connues": len(connues),
                  "fiables": sum(1 for f in connues if f["confiance"] == "haute" and f["frais"]),
                  "a_rafraichir": sum(1 for f in connues if not f["frais"] or f["confiance"] == "faible")},
    }


def calculer(db: Session, user: Utilisateur, acts: list[Activite], mesures: dict, vma: dict, efforts: dict,
             course: dict, cands_seuil: list, auj: date) -> dict:
    m = musculation(db, user, acts, auj)
    p = profil(db, user, acts, mesures, vma, efforts, course, cands_seuil, m, auj)
    m.pop("_lignes", None)
    return {"profil": p, "musculation": m}


# ---------------------------------------------------------------------------
# Export (plan hebdomadaire)
# ---------------------------------------------------------------------------

def resume(c: Optional[dict]) -> Optional[dict]:
    if not c:
        return None
    m = c["musculation"]
    return {
        "profil": [{k: f.get(k) for k in ("label", "texte", "unite", "confiance", "frais", "base", "detail")}
                   | {"tendance_3_mois": (f.get("tendance") or {}).get("texte") or None}
                   for f in c["profil"]["fiches"] if f.get("texte") is not None],
        "tests_suggeres": c["profil"]["tests"],
        "muscu_series_7j": {x["label"]: x["series_7j"] for x in m["carte"] if x["series_7j"]},
        "muscu_series_habituelles": {x["label"]: x["habituel"] for x in m["carte"] if x["habituel"]},
        "muscu_proches_echec_pct": m["echec"]["part_pct"],
        "muscu_exercices": [{"nom": e["nom"], "mesure": e["mesure"], "actuel": e["actuel"], "meilleur": e["meilleur"]["valeur"],
                             "seances": e["nb"]} for e in m["exercices"][:10]],
        "avancees": capacites_avancees.resume(c),
        "tests": tests_service.resume(c.get("tests")),
        "prediction": prediction_service.resume(c.get("prediction")),
    }


_MESURES = {"rm": "kg (1RM estimé)", "reps": "reps par série", "tenue_s": "s tenues"}


def markdown(r: Optional[dict]) -> list[str]:
    if not r:
        return []
    l = ["## Capacités (profil d'athlète et musculation)", ""]
    for f in r["profil"]:
        etat = f"confiance {f['confiance']}" + ("" if f["frais"] else ", estimation ancienne")
        l.append(f"- {f['label']} : {f['texte']} {f['unite']}"
                 + (f" (3 mois : {f['tendance_3_mois']})" if f.get("tendance_3_mois") else "")
                 + f" — {etat} ; {f['base']}" + (f" ; {f['detail']}" if f.get("detail") else ""))
    if r["tests_suggeres"]:
        l.append("- Tests à placer quand la forme le permet : " + " ; ".join(f"{t['label']} ({t['raison']})" for t in r["tests_suggeres"]))
    if r["muscu_series_7j"] or r["muscu_series_habituelles"]:
        l.append("- Musculation, séries des 7 derniers jours par groupe (habitude hebdomadaire entre parenthèses) : "
                 + ", ".join(f"{g} {_fr(v)} ({_fr(r['muscu_series_habituelles'].get(g, 0))})" for g, v in r["muscu_series_7j"].items())
                 + ". Groupes habituels non travaillés cette semaine : "
                 + (", ".join(g for g in r["muscu_series_habituelles"] if g not in r["muscu_series_7j"]) or "aucun") + ".")
    if r["muscu_proches_echec_pct"] is not None:
        l.append(f"- Séries notées « dur » ou « échec » sur 4 semaines : {r['muscu_proches_echec_pct']} %.")
    for e in r["muscu_exercices"]:
        l.append(f"  - {e['nom']} : {_fr(e['actuel'])} {_MESURES[e['mesure']]}, record {_fr(e['meilleur'])} ({e['seances']} séances)")
    l += capacites_avancees.markdown(r.get("avancees"))
    l += tests_service.markdown(r.get("tests"))
    l += prediction_service.markdown(r.get("prediction"))
    l.append("")
    return l
