"""
Pictogrammes des exercices de muscu, affichés sous la barre d'avancement de la
séance guidée.

Un pictogramme = une liste de tracés SVG (attribut `d`) dans un carré 24 × 24,
dessinés au trait (épaisseur 1,8, bouts arrondis). Le catalogue de base ci-dessous
couvre les exercices déjà programmés ; le plan hebdomadaire ajoute ceux des
nouveaux exercices en même temps que les séances (table `pictogrammes`).

Un exercice reçoit le pictogramme dont tous les mots de la clé figurent dans son
nom (« Squat bulgare lesté, 2 haltères » → « squat bulgare leste ») ; la clé la plus
précise l'emporte, et celles de l'utilisateur passent devant le catalogue de base.
"""

from __future__ import annotations

import json
import re
import unicodedata

from sqlalchemy.orm import Session

from models import Pictogramme

# Une ligne « 1. Nom : séries × reps… » d'une description de séance muscu (comme seance.js)
RE_EXERCICE = re.compile(r"^\s*(\d+)[.)]\s+(.+?)\s+:\s+(.+)$")
RE_TRACE = re.compile(r"^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$")
MAX_TRACES = 14
MAX_LONGUEUR = 400
# Précisions de matériel ou de position qui ne changent pas le dessin du mouvement
PRECISIONS = {"haltere", "halteres", "barre", "barres", "paralleles", "sol", "marche", "chaise", "box", "bras", "jambe",
              "jambes", "cote", "allonge", "debout", "tete", "corps", "poids", "hold", "triceps", "biceps", "supination",
              "pronation", "main", "mains", "lent", "lente", "tempo"}
MOTS_VIDES = {"de", "du", "des", "la", "le", "les", "l", "d", "a", "au", "aux", "en", "sur", "sous", "et", "un", "une", "avec"}


def mots(nom: str) -> list[str]:
    """« Tractions prise serrée supination en EMOM » → [tractions, prise, serree, supination]"""
    t = unicodedata.normalize("NFKD", nom.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"\bemom\b", " ", t)
    return [m for m in re.findall(r"[a-z0-9]+", t) if m not in MOTS_VIDES]


def cle(nom: str) -> str:
    return " ".join(mots(nom))


def _tete(x: float, y: float, r: float = 1.8) -> str:
    return f"M{x - r:g} {y:g}a{r:g} {r:g} 0 1 0 {2 * r:g} 0a{r:g} {r:g} 0 1 0 {-2 * r:g} 0"


SOL = "M2 20.5h20"
DEBOUT = "M12 15l-1.6 6M12 15l1.6 6"  # jambes d'une silhouette debout (bassin en 12, 15)

BASE: dict[str, list[str]] = {
    # Tirage
    "tractions prise large": ["M2 3h20", "M4.5 3l3 4.5 3.5 1.5M19.5 3l-3 4.5-3.5 1.5", _tete(12, 6.6), "M12 8.4V15", DEBOUT],
    "tractions prise serree": ["M3 9h18", "M10.8 9l-2.3 3.5 3.5-1M13.2 9l2.3 3.5-3.5-1", _tete(12, 5.4), "M12 7.2V16", "M12 16l-1.4 5M12 16l1.4 5"],
    "tractions strictes": ["M2 3h20", "M8 3l3 6M16 3l-3 6", _tete(12, 6.6), "M12 8.4V15", DEBOUT],
    "negatives tractions": ["M2 3h17", "M6 3l3 6M14 3l-3 6", _tete(10, 6.6), "M10 8.4V15", "M10 15l-1.6 6M10 15l1.6 6", "M19.5 9v9M17.5 16l2 2 2-2"],
    "australiennes": ["M9 6h13", "M2 20.5h7", "M4 19.5L16 12.5", "M16 12.5L14 6", _tete(18.2, 11.3)],
    "rowing haltere": ["M15 11.5L7.5 10", _tete(5.3, 9.6), "M15 11.5l-1 9M15 11.5l2.5 9", "M7.5 10.2V16M5 16h5", "M9.5 10.5L12 6.5l.5 4.5", "M11 11h3"],
    "curl marteau": [_tete(11, 4), "M11 5.8V15", "M11 15l-1.6 6M11 15l1.6 6", "M11 7.5l1 4.5 3.5-3", "M15.5 7v4M14.5 7h2M14.5 11h2"],
    # Poussée
    "dips": [_tete(12, 4), "M12 5.8V13", "M12 7.5l-3 4.5M12 7.5l3 4.5", "M12 13l-2 4 3 3", "M4 12h16M6 12v9M18 12v9"],
    "pompes": [_tete(5, 11.1), "M7 12L21 18", "M7.5 12.2v6.3", "M2 20.5h20"],
    "developpe militaire": [_tete(12, 5.2), "M12 7V15", DEBOUT, "M12 8.3l-4-.8-1-4.5M12 8.3l4-.8 1-4.5", "M5.5 3h3M15.5 3h3"],
    "developpe militaire assis": [_tete(12, 5.2), "M12 7v7h5v6.5", "M12 8.3l1.5-3L13 2.5", "M11.5 2.5h3", "M9.5 8.5v12.5M9.5 15h7M16.5 15v6"],
    "elevations laterales": [_tete(12, 4), "M12 5.8V15", DEBOUT, "M4.5 8h15", "M4.5 6.5v3M19.5 6.5v3"],
    "extension triceps dessus": [_tete(10.8, 7.3), "M11 9.1V15", "M11 15l-1.6 6M11 15l1.6 6", "M11.6 10.3L13.5 3 9 4.3", "M8.6 2.8v3"],
    "extension triceps couche": [_tete(4, 17.4), "M6 18h15", "M7.5 18l1-7-3.5 1.5", "M4.5 11v3", SOL],
    "kickback": ["M15 11.5L7.5 10", _tete(5.3, 9.6), "M15 11.5l-1 9M15 11.5l2.5 9", "M7.5 10.2V16M5 16h5", "M9 10.5L19.5 13", "M19.5 11.5v3"],
    # Jambes, kiné
    "squat bulgare": [_tete(11, 4.3), "M11 6.1v6.4", "M11 12.5L7 15l.5 5.5", "M11 12.5l2.5 4.5 4 -1.5", "M16 16h5.5v4.5", "M3 20.5h13"],
    "squat bulgare leste": [_tete(11, 4.3), "M11 6.1v6.4", "M11 12.5L7 15l.5 5.5", "M11 12.5l2.5 4.5 4 -1.5", "M16 16h5.5v4.5", "M3 20.5h13", "M11 7.5l-1.5 4.5", "M9.5 10.5v3"],
    "pistol box": [_tete(10.8, 6), "M10.4 7.8L8 14", "M8 14l4 1-1.5 5.5", "M8 14l11-1.5", "M10 9.5h7", "M3 15h5.5v5.5", "M2 20.5h20"],
    "mollets excentriques": [_tete(16, 3.8), "M16 5.6V12", "M16 12l-1 4.3", "M13.5 17.3l3.5-1.5", "M15 16h7v5", "M9 9v7M7 14l2 2 2-2"],
    "mollets genoux flechis": [_tete(14.5, 3.8), "M14.5 5.6l.5 6", "M15 11.6l2.5 2.4-2 2.3", "M13.5 17.3l3.5-1.5", "M15 16h7v5", "M14.7 7.5l-3 3"],
    "soleaire": [_tete(14.5, 3.8), "M14.5 5.6l.5 6", "M15 11.6l2.5 2.4-2 2.3", "M13.5 17.3l3.5-1.5", "M15 16h7v5", "M14.7 7.5l-3 3"],
    "pont fessier": [_tete(3.8, 18.4), "M5.6 18.6L12 13.5", "M12 13.5l4.5.5.5 6.5", "M12 13.5l9-3.5", SOL],
    "abduction hanche": [_tete(3.8, 17.4), "M5.6 18H14", "M14 18h7.5", "M14 18l7-6", SOL],
    "short foot": ["M5 20.5h3q4.5-3 9 0h3.5c.5-2.5-2-3.5-5-4.5L11 13V4H7v11c-1.5 1-2.5 3.5-2 5.5z"],
    # Gainage, abdos
    "planche": [_tete(4.9, 14), "M7 14.5L21 17.5", "M7.5 14.6v5.9h3", SOL],
    "planche laterale": [_tete(5.5, 11.5), "M7.5 12.5L21 19", "M7.5 12.5v8H5", "M7.5 12.5l3-7", SOL],
    "hollow": [_tete(4.8, 11.6), "M6.5 12.8Q12.5 20 21 12", SOL],
    "sit ups": [_tete(6.8, 9.9), "M7.5 12L10 19.5", "M10 19.5L15 14l4 5.5", "M8 13.5l5 1", SOL],
}

# Exercice sans pictogramme connu (ni dans le catalogue, ni envoyé avec le plan)
GENERIQUE = ["M6 8.5v7M18 8.5v7", "M3.5 10.5v3M20.5 10.5v3", "M6 12h12"]


def valider(traces) -> list[str]:
    if not isinstance(traces, list) or not 1 <= len(traces) <= MAX_TRACES:
        raise ValueError(f"de 1 à {MAX_TRACES} tracés attendus")
    for t in traces:
        if not isinstance(t, str) or len(t) > MAX_LONGUEUR or not RE_TRACE.match(t):
            raise ValueError("tracé SVG invalide (commandes de chemin et nombres seulement)")
    return traces


def catalogue(db: Session, utilisateur_id: int) -> dict[str, list[str]]:
    """Catalogue de base + pictogrammes de l'utilisateur (prioritaires)."""
    res = dict(BASE)
    for p in db.query(Pictogramme).filter(Pictogramme.utilisateur_id == utilisateur_id).all():
        res[p.cle] = json.loads(p.traces)
    return res


def trouver(nom: str, cat: dict[str, list[str]]) -> str | None:
    """Clé du pictogramme d'un exercice : tous ses mots dans le nom, la plus précise gagne."""
    m = set(mots(nom))
    meilleure = None
    for k in cat:
        km = k.split()
        if km and set(km) <= m and (meilleure is None or len(km) > len(meilleure.split())):
            meilleure = k
    return meilleure


def enregistrer(db: Session, utilisateur_id: int, pictos: dict[str, list[str]]) -> int:
    n = 0
    for nom, traces in pictos.items():
        k = cle(nom)
        if not k:
            continue
        try:
            valider(traces)
        except ValueError as e:
            raise ValueError(f"Pictogramme « {nom} » : {e}") from None
        p = db.query(Pictogramme).filter(Pictogramme.utilisateur_id == utilisateur_id, Pictogramme.cle == k).first()
        if p:
            p.traces = json.dumps(traces)
        else:
            db.add(Pictogramme(utilisateur_id=utilisateur_id, cle=k, nom=nom[:200], traces=json.dumps(traces)))
        n += 1
    db.flush()
    return n


def exercices(description: str | None) -> list[str]:
    return [m.group(2).strip() for l in (description or "").splitlines() if (m := RE_EXERCICE.match(l))]


def a_verifier(db: Session, utilisateur_id: int, descriptions: list[str | None]) -> tuple[list[str], list[dict]]:
    """
    Exercices des séances envoyées sans pictogramme, et ceux qui empruntent celui d'un
    exercice voisin (« Pompes diamant » → « pompes ») : à dessiner si le mouvement diffère.
    """
    cat = catalogue(db, utilisateur_id)
    vus, manquants, approchants = set(), [], []
    for d in descriptions:
        for nom in exercices(d):
            k = cle(nom)
            if not k or k in vus:
                continue
            vus.add(k)
            trouve = trouver(nom, cat)
            # Nom sans ses précisions : « Squat bulgare lesté (2 haltères), descente 3 s » → squat bulgare leste
            essentiel = set(mots(re.split(r"\s*[,(—–:]", nom, maxsplit=1)[0]))
            if not trouve:
                manquants.append(nom)
            elif essentiel - set(trouve.split()) - PRECISIONS:
                approchants.append({"nom": nom, "pictogramme": trouve})
    return manquants, approchants
