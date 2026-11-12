"""
Séances construites par blocs (éditeur du Plan) et envoi sur la montre via Intervals.icu.

- `valider_structure` contrôle le JSON des blocs envoyé par l'éditeur (la description lisible
  est écrite par le navigateur, au format que lisent l'affichage et la séance guidée).
- `texte_intervals` écrit la description au format des séances structurées d'Intervals.icu
  (une étape par ligne « - 10m Z2 HR », répétitions « 5x »), à partir des blocs, ou à défaut
  en relisant une description classique (Échauffement : 15' … / Corps de séance : 3 × 10' …).
  La muscu part en texte libre : les montres l'affichent comme une note.
- `empreinte` résume le contenu envoyé, pour signaler une séance modifiée depuis l'envoi.

Aucune base ni réseau ici : tout est testable à part.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Literal, Optional, Union

from pydantic import BaseModel, Field, TypeAdapter, ValidationError

# ---------------------------------------------------------------------------
# Structure (JSON de l'éditeur)
# ---------------------------------------------------------------------------

_ALLURE = r"^\d{1,2}:[0-5]\d$"


class Etape(BaseModel):
    genre: Literal["echauffement", "corps", "bloc", "recup", "retour"]
    repetitions: int = Field(1, ge=1, le=60)
    duree_s: Optional[int] = Field(None, ge=0, le=36_000)
    distance_m: Optional[int] = Field(None, ge=0, le=300_000)
    texte: str = Field("", max_length=200)
    zone: Optional[int] = Field(None, ge=1, le=5)
    allure_min: Optional[str] = Field(None, pattern=_ALLURE)
    allure_max: Optional[str] = Field(None, pattern=_ALLURE)
    rpe: Optional[float] = Field(None, ge=1, le=10)
    recup_s: Optional[int] = Field(None, ge=0, le=3_600)
    recup_texte: str = Field("", max_length=100)


class Endurance(BaseModel):
    type: Literal["endurance"]
    etapes: list[Etape] = Field(..., min_length=1, max_length=30)
    consignes: str = Field("", max_length=2_000)


class Exercice(BaseModel):
    nom: str = Field(..., min_length=1, max_length=80)
    series: int = Field(1, ge=1, le=60)
    reps: str = Field("", max_length=30)
    unite: str = Field("", max_length=30)
    recup_s: Optional[int] = Field(None, ge=0, le=900)
    charge: str = Field("", max_length=40)
    notes: str = Field("", max_length=150)
    emom: bool = False


class Section(BaseModel):
    titre: str = Field("", max_length=60)
    mode: Literal["series", "amrap", "test"] = "series"
    duree_min: Optional[int] = Field(None, ge=1, le=180)
    exercices: list[Exercice] = Field(..., min_length=1, max_length=30)


class Muscu(BaseModel):
    type: Literal["muscu"]
    echauffement: str = Field("", max_length=300)
    sections: list[Section] = Field(..., min_length=1, max_length=12)
    consignes: str = Field("", max_length=2_000)


_STRUCTURE = TypeAdapter(Union[Endurance, Muscu])


def valider_structure(brut: Optional[dict]) -> Optional[str]:
    """JSON normalisé prêt à stocker (None si absent) ; ValueError avec un message lisible sinon."""
    if not brut:
        return None
    try:
        s = _STRUCTURE.validate_python(brut)
    except ValidationError as e:
        err = e.errors()[0]
        lieu = ".".join(str(x) for x in err.get("loc", ()) if not str(x).startswith(("Endurance", "Muscu")))
        raise ValueError(f"Séance par blocs invalide ({lieu or 'structure'}) : {err.get('msg')}") from e
    texte = s.model_dump_json(exclude_defaults=False)
    if len(texte) > 30_000:
        raise ValueError("Séance par blocs trop longue")
    return texte


def lire_structure(texte: Optional[str]) -> Optional[dict]:
    if not texte:
        return None
    try:
        return json.loads(texte)
    except (TypeError, ValueError):
        return None


def empreinte(p) -> str:
    """Résumé du contenu envoyé sur la montre (titre, sport, description, durée, distance)."""
    brut = json.dumps([p.sport, p.titre, p.description, p.duree_min, p.distance_km], ensure_ascii=False)
    return hashlib.sha1(brut.encode("utf-8")).hexdigest()[:12]


# ---------------------------------------------------------------------------
# Format Intervals.icu
# ---------------------------------------------------------------------------

TYPES_INTERVALS = {
    "course": "Run", "trail": "TrailRun", "velo": "Ride", "marche": "Walk", "randonnee": "Hike",
    "natation": "Swim", "muscu": "WeightTraining", "hiit": "HighIntensityIntervalTraining",
    "yoga": "Yoga", "autre": "Workout",
}
SPORTS_ALLURE = {"course", "trail", "marche", "randonnee"}  # allure en min/km

LIBELLES = {"echauffement": "Échauffement", "corps": "Corps de séance", "recup": "Récupération",
            "retour": "Retour au calme"}

# Ce qu'Intervals.icu lirait comme une durée, une distance, une zone ou une répétition dans une consigne
_JETONS = re.compile(r"\b\d+(?:[.,]\d+)?\s*(?:h|m|s|km|mtr|min|mi|w|rpm|bpm)\b|\b[zZ]\d\b|\d+\s*%|\b\d+\s*[x×]\b|\b(?:hr|lthr|pace|ftp|ramp|freeride)\b",
                    re.IGNORECASE)


def _consigne(texte: str) -> str:
    t = _JETONS.sub(" ", texte or "")
    t = re.sub(r"[()\[\]]", " ", t)
    return re.sub(r"\s+", " ", t).strip(" ,;:-–—")[:60]


def _duree(secondes: int) -> str:
    h, reste = divmod(int(secondes), 3600)
    m, s = divmod(reste, 60)
    return "".join(f"{v}{u}" for v, u in ((h, "h"), (m, "m"), (s, "s")) if v) or "0s"


def _distance(metres: int) -> str:
    return f"{metres / 1000:g}km" if metres >= 1000 and metres % 100 == 0 else f"{int(metres)}mtr"


def _cible(zone: Optional[int], allure_min: Optional[str], allure_max: Optional[str], sport: str) -> str:
    if allure_min and sport in SPORTS_ALLURE:
        haut = allure_max if allure_max and allure_max != allure_min else None
        # Intervals.icu attend la plage de la plus lente à la plus rapide indifféremment : on garde l'ordre saisi
        return f"{allure_min}/km-{haut}/km Pace" if haut else f"{allure_min}/km Pace"
    if zone:
        return f"Z{zone} HR"
    return ""


def _ligne(texte: str, duree_s: Optional[int], distance_m: Optional[int], cible: str) -> Optional[str]:
    if duree_s:
        mesure = _duree(duree_s)
    elif distance_m:
        mesure = _distance(distance_m)
    else:
        return None  # une étape sans durée ni distance ne se guide pas
    return " ".join(x for x in ("-", _consigne(texte), mesure, cible) if x)


def _etapes_intervals(etapes: list[dict], sport: str) -> list[str]:
    blocs: list[str] = []
    n_bloc = 0
    for e in etapes:
        genre = e.get("genre")
        if genre == "bloc":
            n_bloc += 1
            titre = f"Bloc {n_bloc}"
        else:
            titre = LIBELLES.get(genre, "Corps de séance")
        cible = _cible(e.get("zone"), e.get("allure_min"), e.get("allure_max"), sport) if genre in ("corps", "bloc") else ""
        travail = _ligne(e.get("texte", ""), e.get("duree_s"), e.get("distance_m"), cible)
        if not travail:
            continue
        n = int(e.get("repetitions") or 1)
        if n > 1:
            lignes = [f"{titre} {n}x", travail]
            if e.get("recup_s"):
                lignes.append(_ligne(e.get("recup_texte") or "Récup", e["recup_s"], None, "") or "")
            blocs.append("\n".join(x for x in lignes if x))
        else:
            blocs.append(f"{titre}\n{travail}")
    return blocs


def _texte_libre(texte: str) -> str:
    """Texte affiché tel quel : aucune ligne ne doit ressembler à une étape ou à une répétition."""
    sortie = []
    for ligne in (texte or "").splitlines():
        l = re.sub(r"^\s*[-–—]\s+", "• ", ligne)
        if re.match(r"^\s*\d+\s*[x×]\s*$", l):
            l = f"({l.strip()})"
        sortie.append(l)
    return "\n".join(sortie).strip()


# Lecture d'une description classique (celle du plan hebdo, des séances types, d'une IA)
_RE_PHASE = re.compile(r"^(échauffement|corps de séance|retour au calme|récupération|récup|puis|ensuite|bloc \d+)\b\s*:?\s*(.*)$",
                       re.IGNORECASE)
_RE_TETE = re.compile(r"^(?:(\d+)\s*[×x]\s*)?(\d+)\s*(?:['′’](\d{2})?|\s*min\b)\s*(?:de\s+|d['’]\s*)?", re.IGNORECASE)
_RE_RECUP = re.compile(r",?\s*r[ée]cup(?:[ée]ration)?\s*(?:de\s+)?(\d+)\s*(?:['′’]\s*(\d{2})?|\s*(min|s|sec)\b)([^,.;]*)",
                       re.IGNORECASE)
_RE_ZONE = re.compile(r"\bZ([1-5])\b")
_RE_ALLURE = re.compile(r"(\d{1,2})[:'’′](\d{2})\s*(?:(?:[-–—]|à)\s*(\d{1,2})[:'’′](\d{2}))?\s*/\s*km")


def _genre(libelle: str) -> str:
    l = libelle.lower()
    if l.startswith("échauffement"):
        return "echauffement"
    if l.startswith("retour"):
        return "retour"
    if l.startswith("récup"):
        return "recup"
    return "bloc" if l.startswith("bloc") else "corps"


def etapes_depuis_description(description: str) -> list[dict]:
    """Phases minutées d'une description classique ; liste vide si rien n'est guidable."""
    etapes = []
    for ligne in (description or "").splitlines():
        m = _RE_PHASE.match(ligne.strip())
        if not m or not m.group(2).strip():
            continue
        contenu = m.group(2).strip()
        t = _RE_TETE.match(contenu)
        if not t:
            continue
        n = int(t.group(1) or 1)
        duree = int(t.group(2)) * 60 + int(t.group(3) or 0)
        reste = contenu[t.end():]
        recup_s, recup_texte = None, ""
        r = _RE_RECUP.search(reste) if n > 1 else None
        if r:
            v = int(r.group(1))
            recup_s = v if (r.group(3) or "").lower() in ("s", "sec") else v * 60 + int(r.group(2) or 0)
            recup_texte = re.sub(r"^\s*(en|de)\s+", "", r.group(4).strip())
            reste = reste[:r.start()] + reste[r.end():]
        zone = _RE_ZONE.search(reste)
        allure = _RE_ALLURE.search(reste)
        etapes.append({
            "genre": _genre(m.group(1)), "repetitions": min(n, 60), "duree_s": duree,
            "texte": re.sub(r"\([^)]*\)", "", reste).strip(),
            "zone": int(zone.group(1)) if zone else None,
            "allure_min": f"{allure.group(1)}:{allure.group(2)}" if allure else None,
            "allure_max": f"{allure.group(3)}:{allure.group(4)}" if allure and allure.group(3) else None,
            "recup_s": recup_s, "recup_texte": recup_texte,
        })
    return etapes if len(etapes) >= 2 else []


def texte_intervals(sport: str, description: Optional[str], structure: Optional[dict]) -> tuple[str, bool]:
    """(texte pour Intervals.icu, étapes guidées oui/non)."""
    s = structure or {}
    if sport in ("muscu", "hiit", "yoga") or s.get("type") == "muscu":
        return _texte_libre(description or ""), False
    if s.get("type") == "endurance":
        etapes, consignes = s.get("etapes") or [], s.get("consignes") or ""
    else:
        etapes, consignes = etapes_depuis_description(description or ""), ""
    blocs = _etapes_intervals(etapes, sport)
    if not blocs:
        return _texte_libre(description or ""), False
    tete = _texte_libre(consignes)
    return ((tete + "\n\n") if tete else "") + "\n\n".join(blocs), True


def evenement(p, jour, structure: Optional[dict]) -> dict:
    """Corps de l'événement « séance prévue » d'Intervals.icu."""
    texte, _ = texte_intervals(p.sport, p.description, structure)
    corps = {
        "category": "WORKOUT",
        "start_date_local": f"{jour.isoformat()}T00:00:00",
        "type": TYPES_INTERVALS.get(p.sport, "Workout"),
        "name": (p.titre or "Séance")[:120],
        "description": texte[:10_000],
        "external_id": f"carnet-{p.id}",
    }
    if p.duree_min:
        corps["moving_time"] = int(p.duree_min) * 60
    if p.distance_km:
        corps["distance"] = round(float(p.distance_km) * 1000)
    return corps
