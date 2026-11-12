"""
Corps au quotidien : marqueurs de journée (malade, voyage, alcool, stress, courbatures),
ressenti du matin, journal des douleurs, et adaptation du plan quand la forme ne suit pas.

Les jours marqués (sauf courbatures) sont écartés de la référence personnelle de récupération :
une semaine de grippe ne doit pas devenir « la normale ».
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, timedelta
from typing import Optional

from sqlalchemy.orm import Session

import carnet_service as cs
from models import Activite, Douleur, MarqueurJour, ReleveDouleur, RessentiMatin, SeancePrevue

# type → (libellé, emoji, écarté de la référence de récupération)
MARQUEURS = {
    "malade": ("Malade", "🤒", True),
    "voyage": ("Voyage / décalage", "✈️", True),
    "alcool": ("Alcool", "🍷", True),
    "stress": ("Stress fort", "⚡", True),
    "courbatures": ("Courbatures", "🦵", False),
}
TYPES_MARQUEURS = [{"type": t, "label": v[0], "emoji": v[1]} for t, v in MARQUEURS.items()]

# zone → (libellé, a un côté gauche/droite)
ZONES = {
    "tete": ("Tête", False), "cou": ("Cou", False), "epaule": ("Épaule", True), "bras": ("Bras", True),
    "coude": ("Coude", True), "avant_bras": ("Avant-bras", True), "poignet": ("Poignet / main", True),
    "poitrine": ("Poitrine", False), "abdos": ("Abdominaux", False), "haut_dos": ("Haut du dos", False),
    "lombaires": ("Lombaires", False), "hanche": ("Hanche", True), "fessier": ("Fessier", True),
    "adducteur": ("Adducteur", True), "quadriceps": ("Quadriceps", True), "ischio": ("Ischio-jambiers", True),
    "genou": ("Genou", True), "tibia": ("Tibia", True), "mollet": ("Mollet", True),
    "achille": ("Tendon d'Achille", True), "cheville": ("Cheville", True), "pied": ("Pied", True),
}
RESSENTIS = [("energie", "Énergie"), ("jambes", "Jambes"), ("humeur", "Humeur"), ("motivation", "Motivation")]
_RE_DOULEUR = re.compile(r"douleur|\bmal\b|gêne|\bgene\b|tire|pince|bless|tendin|contractur|crampe", re.I)


# ---------------------------------------------------------------------------
# Marqueurs de journée
# ---------------------------------------------------------------------------

def marqueurs_par_jour(db: Session, user_id: int, depuis: Optional[date] = None) -> dict[date, list[str]]:
    q = db.query(MarqueurJour).filter(MarqueurJour.utilisateur_id == user_id)
    if depuis:
        q = q.filter(MarqueurJour.jour >= depuis)
    out: dict[date, list[str]] = defaultdict(list)
    for m in q.order_by(MarqueurJour.jour, MarqueurJour.id):
        if m.type in MARQUEURS:
            out[m.jour].append(m.type)
    return dict(out)


def jours_exclus(marqueurs: dict[date, list[str]]) -> set[date]:
    """Jours à ne pas compter dans la référence de récupération."""
    return {j for j, types in marqueurs.items() if any(MARQUEURS[t][2] for t in types if t in MARQUEURS)}


def basculer_marqueur(db: Session, user_id: int, jour: date, type_: str, actif: bool) -> list[str]:
    existant = db.query(MarqueurJour).filter(MarqueurJour.utilisateur_id == user_id, MarqueurJour.jour == jour,
                                             MarqueurJour.type == type_).first()
    if actif and not existant:
        db.add(MarqueurJour(utilisateur_id=user_id, jour=jour, type=type_))
    elif not actif and existant:
        db.delete(existant)
    db.flush()
    return marqueurs_par_jour(db, user_id, jour).get(jour, [])


# ---------------------------------------------------------------------------
# Ressenti du matin
# ---------------------------------------------------------------------------

def serialiser_ressenti(r: Optional[RessentiMatin]) -> Optional[dict]:
    if not r:
        return None
    vals = [getattr(r, k) for k, _ in RESSENTIS if getattr(r, k) is not None]
    return {"jour": r.jour.isoformat(), **{k: getattr(r, k) for k, _ in RESSENTIS},
            "moyenne": round(sum(vals) / len(vals), 1) if vals else None}


def ressenti_du(db: Session, user_id: int, jour: date) -> Optional[dict]:
    return serialiser_ressenti(db.query(RessentiMatin).filter(RessentiMatin.utilisateur_id == user_id,
                                                              RessentiMatin.jour == jour).first())


def noter_ressenti(db: Session, user_id: int, jour: date, valeurs: dict) -> Optional[dict]:
    r = db.query(RessentiMatin).filter(RessentiMatin.utilisateur_id == user_id, RessentiMatin.jour == jour).first()
    if not r:
        r = RessentiMatin(utilisateur_id=user_id, jour=jour)
        db.add(r)
    for k, _ in RESSENTIS:
        if k in valeurs:
            setattr(r, k, valeurs[k])
    db.flush()
    return serialiser_ressenti(r)


def ressentis(db: Session, user_id: int, depuis: date) -> list[dict]:
    return [serialiser_ressenti(r) for r in db.query(RessentiMatin)
            .filter(RessentiMatin.utilisateur_id == user_id, RessentiMatin.jour >= depuis).order_by(RessentiMatin.jour)]


# ---------------------------------------------------------------------------
# Journal des douleurs
# ---------------------------------------------------------------------------

def libelle_zone(zone: str, cote: Optional[str]) -> str:
    nom = ZONES.get(zone, (zone, False))[0]
    return f"{nom} {cote}" if cote in ("gauche", "droite") else nom


def _charges(db: Session, user_id: int) -> dict[date, float]:
    par_jour: dict[date, float] = defaultdict(float)
    for a in db.query(Activite).filter(Activite.utilisateur_id == user_id):
        par_jour[a.debut.date()] += cs.charge(a)
    return par_jour


def _charge_avant(charges: dict[date, float], debut: date) -> Optional[dict]:
    """Charge des 14 jours avant le début de la douleur, comparée aux 14 jours habituels
    (moyenne des 8 semaines d'avant) : une hausse brutale est le premier suspect."""
    def somme(a: date, b: date) -> float:
        return sum(v for d, v in charges.items() if a <= d < b)
    avant = somme(debut - timedelta(days=14), debut)
    base = somme(debut - timedelta(days=70), debut - timedelta(days=14)) / 4
    if base <= 0 and avant <= 0:
        return None
    ratio = round(avant / base, 2) if base > 0 else None
    if ratio is None:
        texte = "Reprise après une période sans entraînement dans les 2 semaines précédentes."
    elif ratio >= 1.3:
        texte = f"Charge des 2 semaines précédentes {round((ratio - 1) * 100)} % au-dessus de ton habitude : hausse à surveiller."
    elif ratio <= 0.7:
        texte = "Charge des 2 semaines précédentes plus basse que d'habitude : la charge n'est sans doute pas en cause."
    else:
        texte = "Charge des 2 semaines précédentes dans ton habitude."
    return {"charge_14j": round(avant), "habituelle_14j": round(base), "ratio": ratio,
            "hausse": bool(ratio and ratio >= 1.3), "texte": texte}


def serialiser_douleur(d: Douleur, releves: list[ReleveDouleur], charges: Optional[dict], auj: date) -> dict:
    releves = sorted(releves, key=lambda r: r.jour)
    dernier = releves[-1] if releves else None
    return {
        "id": d.id, "zone": d.zone, "cote": d.cote, "label": libelle_zone(d.zone, d.cote),
        "debut": d.debut.isoformat(), "fin": d.fin.isoformat() if d.fin else None, "en_cours": d.fin is None,
        "notes": d.notes,
        "releves": [{"jour": r.jour.isoformat(), "intensite": r.intensite, "note": r.note} for r in releves],
        "intensite": dernier.intensite if dernier else None,
        "intensite_max": max((r.intensite for r in releves), default=None),
        "dernier_releve": dernier.jour.isoformat() if dernier else None,
        "duree_jours": max(1, ((d.fin or auj) - d.debut).days + 1),
        "charge": _charge_avant(charges, d.debut) if charges is not None else None,
    }


def lister_douleurs(db: Session, user_id: int, auj: date) -> list[dict]:
    douleurs = db.query(Douleur).filter(Douleur.utilisateur_id == user_id).all()
    if not douleurs:
        return []
    releves: dict[int, list[ReleveDouleur]] = defaultdict(list)
    for r in db.query(ReleveDouleur).filter(ReleveDouleur.douleur_id.in_([d.id for d in douleurs])):
        releves[r.douleur_id].append(r)
    charges = _charges(db, user_id)
    out = [serialiser_douleur(d, releves[d.id], charges, auj) for d in douleurs]
    en_cours = sorted((x for x in out if x["en_cours"]), key=lambda x: x["debut"], reverse=True)
    finies = sorted((x for x in out if not x["en_cours"]), key=lambda x: x["fin"], reverse=True)
    return en_cours + finies


def noter_releve(db: Session, d: Douleur, jour: date, intensite: int, note: Optional[str]) -> None:
    r = db.query(ReleveDouleur).filter(ReleveDouleur.douleur_id == d.id, ReleveDouleur.jour == jour).first()
    if not r:
        r = ReleveDouleur(douleur_id=d.id, jour=jour, intensite=intensite)
        db.add(r)
    r.intensite = intensite
    r.note = (note or "").strip()[:500] or None
    db.flush()


def signalements_seance(db: Session, user_id: int, auj: date, jours: int = 30) -> list[dict]:
    """Ressentis des séances guidées qui parlent d'une douleur : versés au journal."""
    out = []
    for p in (db.query(SeancePrevue).filter(SeancePrevue.utilisateur_id == user_id, SeancePrevue.deroule.isnot(None),
                                            SeancePrevue.jour >= auj - timedelta(days=jours))
              .order_by(SeancePrevue.jour.desc())):
        for e in (cs.lire_deroule(p) or {}).get("exercices") or []:
            if not isinstance(e, dict):
                continue
            texte = str(e.get("ressenti") or "").strip()
            if texte and _RE_DOULEUR.search(texte):
                out.append({"jour": p.jour.isoformat(), "seance": p.titre, "exercice": str(e.get("nom") or ""),
                            "ressenti": texte[:300], "difficulte": e.get("difficulte")})
    return out[:12]


def journal(db: Session, user_id: int, auj: date) -> dict:
    return {
        "jour": auj.isoformat(),
        "douleurs": lister_douleurs(db, user_id, auj),
        "zones": [{"zone": z, "label": v[0], "cote": v[1]} for z, v in ZONES.items()],
        "signalements": signalements_seance(db, user_id, auj),
    }


# ---------------------------------------------------------------------------
# Adaptation du plan (par règles ; le plan du dimanche reste la référence)
# ---------------------------------------------------------------------------

REPRISE_JOURS = 4   # jours de reprise progressive après le dernier jour « malade »


def proposition_adaptation(seances: list[SeancePrevue], auj: date, statut: Optional[str], malade: bool,
                           marqueurs: dict[date, list[str]], intensite) -> Optional[dict]:
    """Séances à alléger, décaler ou sauter aujourd'hui (et les jours suivants en cas de maladie)."""
    dernier_malade = max((j for j, t in marqueurs.items() if "malade" in t and j < auj), default=None)
    reprise = not malade and dernier_malade is not None and (auj - dernier_malade).days <= REPRISE_JOURS
    if malade:
        horizon, seuil, raison = 2, 0, "malade"
        titre = "Malade : le plan se met en pause"
        texte = "Repos tant que les symptômes sont là. Saute ou décale les séances des prochains jours ; rien n'est perdu en trois jours."
    elif reprise:
        horizon, seuil, raison = REPRISE_JOURS - (auj - dernier_malade).days, 5.5, "reprise"
        titre = "Reprise après maladie : en douceur"
        texte = ("Compte autant de jours faciles que de jours malades : pas d'intensité pour l'instant, "
                 "et stop si la FC de repos remonte.")
    elif statut == "rouge":
        horizon, seuil, raison = 0, 4.5, "fatigue"
        titre = "Forme en berne : allège aujourd'hui"
        texte = "Une séance dure faite fatigué coûte plus qu'elle ne rapporte. Allège-la ou décale-la d'un jour."
    else:
        return None
    cibles = [p for p in seances if auj <= p.jour <= auj + timedelta(days=horizon) and intensite(p) >= seuil
              and not (p.titre or "").endswith("(allégée)")]
    if not cibles:
        return None
    actions = ["sauter", "decaler"] if malade else ["alleger", "decaler", "sauter"]
    return {"raison": raison, "titre": titre, "texte": texte,
            "seances": [{"id": p.id, "titre": p.titre, "sport": p.sport, "jour": p.jour.isoformat(),
                         "duree_min": p.duree_min, "rpe_cible": p.rpe_cible, "actions": actions} for p in cibles]}


_JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]


def adapter_seance(db: Session, p: SeancePrevue, action: str, auj: date) -> str:
    """Applique une adaptation à une séance prévue ; renvoie le message de confirmation."""
    def note(t: str) -> str:
        return " — ".join(x for x in [p.commentaire, t] if x)[:2000]
    if action == "sauter":
        p.statut = "sautee"
        p.commentaire = note(f"Sautée le {auj.strftime('%d/%m')} (forme du matin)")
        return "Séance sautée."
    if action == "decaler":
        depart = max(auj, p.jour)
        pris = {j for (j,) in db.query(SeancePrevue.jour).filter(
            SeancePrevue.utilisateur_id == p.utilisateur_id, SeancePrevue.id != p.id, SeancePrevue.statut != "sautee",
            SeancePrevue.jour > depart, SeancePrevue.jour <= depart + timedelta(days=8))}
        cible = next((depart + timedelta(days=k) for k in range(1, 8) if depart + timedelta(days=k) not in pris),
                     depart + timedelta(days=1))
        ancien, p.jour = p.jour, cible
        p.commentaire = note(f"Décalée du {ancien.strftime('%d/%m')} au {cible.strftime('%d/%m')} (forme du matin)")
        return f"Séance décalée à {_JOURS[cible.weekday()]} {cible.day}."
    # alléger : plus court, sans intensité ; la séance d'origine reste lisible dans la description
    if p.duree_min:
        p.duree_min = max(15, round(p.duree_min * 0.6 / 5) * 5)
    if p.distance_km:
        p.distance_km = round(p.distance_km * 0.6, 1)
    if p.dplus_m:
        p.dplus_m = round(p.dplus_m * 0.6)
    p.rpe_cible = min(p.rpe_cible or 3, 3)
    p.structure = None  # la description réécrite ne correspond plus aux blocs
    origine = (p.description or "").strip()
    if not origine.startswith("Version allégée"):
        p.description = ("Version allégée : effort facile du début à la fin, aucune intensité, on s'arrête au moindre doute."
                         + (f"\n\nSéance d'origine : {origine}" if origine else ""))
    if not (p.titre or "").endswith("(allégée)"):
        p.titre = f"{p.titre} (allégée)"[:200]
    p.commentaire = note(f"Allégée le {auj.strftime('%d/%m')} (forme du matin)")
    return "Séance allégée : plus courte et sans intensité."


# ---------------------------------------------------------------------------
# Export pour le plan hebdomadaire
# ---------------------------------------------------------------------------

def export(db: Session, user_id: int, auj: Optional[date] = None) -> dict:
    auj = auj or date.today()
    limite = (auj - timedelta(days=60)).isoformat()
    return {
        "marqueurs": [{"jour": j.isoformat(), "types": [MARQUEURS[t][0] for t in types]}
                      for j, types in sorted(marqueurs_par_jour(db, user_id, auj - timedelta(days=28)).items())],
        "ressentis": ressentis(db, user_id, auj - timedelta(days=14)),
        "douleurs": [d for d in lister_douleurs(db, user_id, auj) if d["en_cours"] or d["fin"] >= limite],
        "signalements": signalements_seance(db, user_id, auj, 14),
        "composition": export_composition(db, user_id, auj),
    }


def markdown(c: Optional[dict]) -> list[str]:
    if not c or not any(c.get(k) for k in ("marqueurs", "ressentis", "douleurs", "signalements", "composition")):
        return []
    l = ["## Corps : contexte, ressenti, douleurs", ""]
    if c.get("composition"):
        l.append("**Composition corporelle** : " + " · ".join(c["composition"]))
        l.append("")
    if c["marqueurs"]:
        l.append("**Jours marqués (28 j)** : " + " ; ".join(f"{m['jour']} {', '.join(m['types']).lower()}" for m in c["marqueurs"]))
        l.append("")
    if c["ressentis"]:
        l += ["**Ressenti du matin (1 à 5)**", "", "| Jour | Énergie | Jambes | Humeur | Motivation |", "|---|---|---|---|---|"]
        l += [f"| {r['jour']} | {r['energie'] or ''} | {r['jambes'] or ''} | {r['humeur'] or ''} | {r['motivation'] or ''} |"
              for r in c["ressentis"]]
        l.append("")
    if c["douleurs"]:
        l += ["**Douleurs** (à prendre en compte dans le plan : pas de charge sur une zone douloureuse)", ""]
        for d in c["douleurs"]:
            etat = "en cours" if d["en_cours"] else f"terminée le {d['fin']}"
            ligne = f"- **{d['label']}** — depuis le {d['debut']} ({etat})"
            if d["releves"]:
                ligne += " · intensité " + " → ".join(f"{r['intensite']}/10 ({r['jour'][5:]})" for r in d["releves"][-6:])
            if d.get("charge"):
                ligne += f" · {d['charge']['texte']}"
            l.append(ligne)
            if d["notes"]:
                l.append("  - Notes : " + re.sub(r"\s+", " ", d["notes"]).strip())
        l.append("")
    if c["signalements"]:
        l.append("**Signalé en séance guidée** : " + " ; ".join(
            f"{s['jour']} {s['exercice']} : « {s['ressenti']} »" for s in c["signalements"]))
        l.append("")
    return l


# ---------------------------------------------------------------------------
# Composition corporelle : masse grasse et mensurations
# ---------------------------------------------------------------------------

MENSURATIONS = {   # type : (libellé, unité, minimum, maximum, où mesurer)
    "masse_grasse": ("Masse grasse", "%", 3, 60, "Balance à impédance ou pince à plis, toujours dans les mêmes conditions."),
    "tour_taille": ("Tour de taille", "cm", 40, 200, "À mi-chemin entre la dernière côte et le haut du bassin, en fin d'expiration."),
    "tour_hanches": ("Tour de hanches", "cm", 50, 200, "Au plus large des fesses."),
    "tour_poitrine": ("Tour de poitrine", "cm", 50, 200, "Sous les aisselles, au plus large."),
    "tour_cuisse": ("Tour de cuisse", "cm", 25, 120, "À mi-cuisse, jambe relâchée, toujours la même."),
    "tour_bras": ("Tour de bras", "cm", 15, 80, "À mi-bras, relâché, toujours le même."),
}
TYPES_MENSURATIONS = [{"type": t, "label": v[0], "unite": v[1], "min": v[2], "max": v[3], "aide": v[4]}
                      for t, v in MENSURATIONS.items()]


def enregistrer_mensurations(db: Session, user_id: int, jour: date, valeurs: dict, source: str = "manuel") -> int:
    """Pose, remplace ou retire (valeur None) les mesures d'un jour. Une valeur venue d'une balance
    ne remplace jamais une saisie manuelle du même jour."""
    from models import Mensuration
    n = 0
    for t, v in valeurs.items():
        if t not in MENSURATIONS:
            continue
        m = db.query(Mensuration).filter(Mensuration.utilisateur_id == user_id, Mensuration.type == t,
                                         Mensuration.jour == jour).first()
        if v is None:
            if m and source == "manuel":
                db.delete(m)
                n += 1
            continue
        _, _, mini, maxi, _ = MENSURATIONS[t]
        if not (mini <= v <= maxi):
            raise ValueError(f"{MENSURATIONS[t][0]} : valeur attendue entre {mini} et {maxi} {MENSURATIONS[t][1]}")
        if m:
            if source != "manuel" and m.source == "manuel":
                continue
            if m.valeur != round(v, 1) or m.source != source:
                m.valeur, m.source = round(v, 1), source
                n += 1
        else:
            db.add(Mensuration(utilisateur_id=user_id, type=t, jour=jour, valeur=round(v, 1), source=source))
            n += 1
    db.flush()
    return n


def _poids_au(pesees: list[tuple[date, float]], jour: date, tolerance: int = 21) -> Optional[float]:
    proches = [(abs((j - jour).days), p) for j, p in pesees if abs((j - jour).days) <= tolerance]
    return min(proches)[1] if proches else None


def composition(db: Session, user: Utilisateur, auj: date) -> dict:
    from models import Mensuration, PoidsUtilisateur
    series: dict[str, list[dict]] = {t: [] for t in MENSURATIONS}
    for m in (db.query(Mensuration).filter(Mensuration.utilisateur_id == user.id)
              .order_by(Mensuration.jour, Mensuration.id)):
        if m.type in series:
            series[m.type].append({"jour": m.jour.isoformat(), "valeur": m.valeur, "source": m.source})
    pesees = [(p.enregistre_le.date(), p.poids_kg) for p in db.query(PoidsUtilisateur).filter(
        PoidsUtilisateur.utilisateur_id == user.id).order_by(PoidsUtilisateur.enregistre_le) if p.enregistre_le]
    # Masse grasse et masse maigre en kg, avec la pesée la plus proche (3 semaines au plus)
    for p in series["masse_grasse"]:
        poids = _poids_au(pesees, date.fromisoformat(p["jour"]))
        if poids:
            p["grasse_kg"] = round(poids * p["valeur"] / 100, 1)
            p["maigre_kg"] = round(poids - p["grasse_kg"], 1)
    derniers = {}
    for t, pts in series.items():
        if not pts:
            continue
        d = pts[-1]
        # Comparaison : la mesure la plus proche d'il y a 3 mois, à défaut la première
        cible = date.fromisoformat(d["jour"]) - timedelta(days=90)
        avant = min(pts[:-1], key=lambda p: abs((date.fromisoformat(p["jour"]) - cible).days), default=None)
        derniers[t] = {**d, "ecart": round(d["valeur"] - avant["valeur"], 1) if avant else None,
                       "depuis": avant["jour"] if avant else None}
    derives = {}
    mg = derniers.get("masse_grasse")
    if mg and mg.get("maigre_kg") is not None:
        derives["masse_maigre_kg"], derives["masse_grasse_kg"] = mg["maigre_kg"], mg["grasse_kg"]
        avant = next((p for p in series["masse_grasse"] if p["jour"] == mg["depuis"]), None) if mg["depuis"] else None
        if avant and avant.get("maigre_kg") is not None:
            derives["masse_maigre_ecart"] = round(mg["maigre_kg"] - avant["maigre_kg"], 1)
            derives["masse_grasse_ecart"] = round(mg["grasse_kg"] - avant["grasse_kg"], 1)
    tt = derniers.get("tour_taille")
    if tt and user.taille_cm:
        ratio = tt["valeur"] / user.taille_cm
        derives["taille_stature"] = round(ratio, 2)
        derives["taille_stature_ok"] = ratio < 0.5
    th = derniers.get("tour_hanches")
    if tt and th:
        derives["taille_hanches"] = round(tt["valeur"] / th["valeur"], 2)
    return {"types": TYPES_MENSURATIONS, "series": series, "derniers": derniers, "derives": derives,
            "aujourdhui": auj.isoformat(), "taille_cm": user.taille_cm}


def export_composition(db: Session, user_id: int, auj: date) -> list[str]:
    from models import Mensuration
    out, vus = [], set()
    for m in (db.query(Mensuration).filter(Mensuration.utilisateur_id == user_id,
                                           Mensuration.jour >= auj - timedelta(days=180))
              .order_by(Mensuration.jour.desc(), Mensuration.id.desc())):
        if m.type in vus or m.type not in MENSURATIONS:
            continue
        vus.add(m.type)
        label, unite = MENSURATIONS[m.type][:2]
        out.append(f"{label.lower()} {str(m.valeur).replace('.', ',')} {unite} ({m.jour.isoformat()})")
    return out
