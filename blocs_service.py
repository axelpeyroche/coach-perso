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
_JETONS = re.compile(r"\b\d+(?:[.,]\d+)?\s*(?:h|m|s|km|mtr|min|mn|sec|mi|w|rpm|bpm)\b|\b[zZ]\d\b|\d+\s*%|\b\d+\s*[x×]\b|\b(?:hr|lthr|pace|ftp|ramp|freeride)\b",
                    re.IGNORECASE)
# Mots qui n'ont plus de sens une fois leur chiffre retiré (« allure 10 km » → « allure »)
_PENDANTS = re.compile(r"(?:^|\s+)(?:allure|à|a|de|du|d['’]|en|sous|sur|vers|environ|fc|rpe|et|ou|avec|entre|puis)$", re.IGNORECASE)
_BORDS = " ,;:·+/-–—'’′\""


def _consigne(texte: str) -> str:
    """Consigne affichée sur la montre : des mots seulement. Tout ce qui porte un chiffre est retiré
    (Intervals.icu prend la première durée qu'il trouve dans la ligne : 1'30, 5', 10 km…)."""
    t = _JETONS.sub(" ", texte or "")
    t = re.sub(r"\S*\d\S*", " ", t)
    t = re.sub(r"[()\[\]]", " ", t)
    t = re.sub(r"\s+", " ", t).strip(_BORDS)
    while _PENDANTS.search(t):
        t = _PENDANTS.sub("", t).strip(_BORDS)
    return t[:60].strip()


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
        # L'allure ne vise que l'effort ; une zone écrite pour l'échauffement ou le retour est gardée
        if genre in ("corps", "bloc"):
            cible = _cible(e.get("zone"), e.get("allure_min"), e.get("allure_max"), sport)
        else:
            cible = _cible(e.get("zone"), None, None, sport)
        travail = _ligne(e.get("texte", ""), e.get("duree_s"), e.get("distance_m"), cible)
        if not travail:
            continue
        n = int(e.get("repetitions") or 1)
        if n > 1:
            lignes = [f"{titre} {n}x", travail]
            if e.get("recup_s") or e.get("recup_m"):
                # La récupération n'a jamais de cible : l'allure de l'effort ne s'y applique pas
                lignes.append(_ligne(e.get("recup_texte") or "Récup", e.get("recup_s"), e.get("recup_m"), "") or "")
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
_RE_ZONE = re.compile(r"\bZ([1-5])\b")
_RE_ALLURE = re.compile(r"(\d{1,2})[:'’′](\d{2})\s*(?:(?:[-–—]|à)\s*(\d{1,2})[:'’′](\d{2}))?\s*/\s*km")
_RE_RPE = re.compile(r"\bRPE\s*(\d{1,2}(?:[.,]\d)?)", re.IGNORECASE)
_RE_FC_PLAGE = re.compile(r"\bFC\b[^\d,.;·()]{0,25}?(\d{2,3})\s*(?:[-–—]|à)\s*(\d{2,3})(?!\s*%)", re.IGNORECASE)
_RE_FC_SOUS = re.compile(r"\bFC\b\s*(?:max(?:imale)?\s*)?(?:sous|inférieure à|en dessous de|<|≤|jusqu['’]à|max\.?)\s*(?:les\s+)?(\d{2,3})(?!\s*%)",
                         re.IGNORECASE)
# Une durée ou une distance écrite à la française : 20', 1'30, 30'', 20 min, 45 s, 1 h 15, 400 m, 2 km.
# Jamais une allure (4'55/km), une plage (165-175) ni la fin d'un nombre.
_MES = re.compile(r"""
    (?<![\d:'’′.,/–-])
    (?:
        (?P<h>\d{1,2})\s*h\s*(?P<hm>[0-5]\d)?(?![a-zà-ÿ\d])
      | (?P<m>\d{1,3})\s*(?:['′’](?!['′’])\s?|(?:min(?:utes?)?|mn)\b\s*)
            (?:(?P<ms>[0-5]\d)(?!\s*(?:km|m\b|h\b|%|bpm|[x×]))(?:\s*(?:''|’’|"|″|”|s\b|sec\b))?)?
      | (?P<s>\d{1,3})\s*(?:''|’’|"|″|”|s\b|sec(?:ondes?)?\b)
      | (?P<km>\d{1,3}(?:[.,]\d+)?)\s*km\b
      | (?P<mt>\d{2,5})\s*m(?:ètres?)?\b
    )
    (?!\d)(?!\s*/)(?!\s*[-–]\s*\d)
""", re.VERBOSE | re.IGNORECASE)
_RE_FOIS = re.compile(r"^(\d{1,2})\s*[×x*]\s*", re.IGNORECASE)
# « 4 lignes droites de 80 m », « 6 côtes de 30'' » : des répétitions sans le signe ×
_RE_NOMBRE = re.compile(r"^(\d{1,2})\s+((?:lignes?\s+droites?|accélérations?|côtes?|sprints?|montées?)(?:\s+progressives?)?)\s*"
                        r"(?:de\s+|d['’]\s*|sur\s+)?", re.IGNORECASE)
_RE_ARTICLE = re.compile(r"^\s*(?:de\s+|d['’]\s*|en\s+)", re.IGNORECASE)
_RE_ENTRE = re.compile(r"\bentre\s+(?:chaque|chacune?s?|les|deux)\b[^,.;·+]*", re.IGNORECASE)
_RE_RECUP = re.compile(r"\br[ée]cup(?:[ée]ration)?s?\b", re.IGNORECASE)
_RE_RETOUR = re.compile(r"\bretour\s+(?:en\s+march\w+|march\w+|au\s+trot|en\s+trottinant|trottin\w+|au\s+pas)", re.IGNORECASE)
_SEPARATEURS = ",.;·+"


def _genre(libelle: str) -> str:
    l = libelle.lower()
    if l.startswith("échauffement"):
        return "echauffement"
    if l.startswith("retour"):
        return "retour"
    if l.startswith("récup"):
        return "recup"
    return "bloc" if l.startswith("bloc") else "corps"


def _valeur(m: re.Match) -> tuple[Optional[int], Optional[int]]:
    """(durée en secondes, distance en mètres) d'une mesure reconnue par _MES."""
    g = m.groupdict()
    if g["h"]:
        return int(g["h"]) * 3600 + int(g["hm"] or 0) * 60, None
    if g["m"]:
        return int(g["m"]) * 60 + int(g["ms"] or 0), None
    if g["s"]:
        return int(g["s"]), None
    if g["km"]:
        return None, round(float(g["km"].replace(",", ".")) * 1000)
    return None, int(g["mt"])


def _clause(texte: str) -> str:
    """Premier membre de phrase, sans parenthèses : ce qui décrit l'étape, pas la suite."""
    t = re.sub(r"\([^)]*\)", " ", texte or "")
    t = re.split(r"[.;·,]|\s\+(?:\s|$)|\s[-–—]\s|\bpuis\b|\bensuite\b", t.strip(" .;·,+"), maxsplit=1)[0]
    t = re.sub(r"\s+", " ", t).strip(_BORDS)
    while _PENDANTS.search(t) and not re.search(r"\d", t):
        t = _PENDANTS.sub("", t).strip(_BORDS)
    return t


def _bornes(texte: str, debut: int, fin: int) -> tuple[int, int]:
    """Élargit [debut, fin] au membre de phrase qui le contient (entre deux séparateurs)."""
    a = max(texte.rfind(c, 0, debut) for c in _SEPARATEURS) + 1
    suivants = [i for i in (texte.find(c, fin) for c in _SEPARATEURS) if i >= 0]
    return a, (min(suivants) if suivants else len(texte))


def _recuperation(reste: str) -> tuple[Optional[int], Optional[int], str, str]:
    """Récupération entre les répétitions : (secondes, mètres, texte, reste sans elle).
    Lit « récup 2' en trottinant », « 2' de récup », « 1'30 de trot très lent entre chaque »,
    « retour en marchant 1' »."""
    for motif in (_RE_ENTRE, _RE_RECUP, _RE_RETOUR):
        for trouve in motif.finditer(reste):
            a, b = _bornes(reste, trouve.start(), trouve.end())
            membre = reste[a:b]
            mes = _MES.search(membre)
            if not mes:
                continue
            duree, dist = _valeur(mes)
            if motif is _RE_RETOUR:
                mots = trouve.group(0)
            else:
                mots = membre[:mes.start()] + " " + membre[mes.end():]
                mots = _RE_ENTRE.sub(" ", _RE_RECUP.sub(" ", mots))
            mots = _RE_ARTICLE.sub("", re.sub(r"\s+", " ", mots).strip(" :,-–—"))
            suite = (reste[:a].rstrip(" ,·;+") + " " + reste[b:].lstrip(" ,·;+")).strip()
            return duree, dist, _clause(mots), suite
    return None, None, "", reste


def _tete(texte: str) -> Optional[tuple]:
    """Début d'une étape : (répétitions, secondes, mètres, nom, forme « N lignes droites », suite)."""
    t = texte.lstrip(" :,-–—")
    n, nom, nomme = 1, "", False
    f = _RE_FOIS.match(t)
    if f:
        n, t = int(f.group(1)), t[f.end():]
    else:
        f = _RE_NOMBRE.match(t)
        if f:
            n, nom, nomme, t = int(f.group(1)), re.sub(r"s\b", "", f.group(2).lower()), True, t[f.end():]
    mes = _MES.match(t)
    if not mes:
        return None
    duree, dist = _valeur(mes)
    if not duree and not dist:
        return None
    return max(1, min(n, 60)), duree, dist, nom, nomme, _RE_ARTICLE.sub("", t[mes.end():])


_RE_SUITE = re.compile(r"\s\+\s*|[,.;·]?\s*\b(?:puis|ensuite|suivie?s?\s+de|et\s+enfin)\b\s*", re.IGNORECASE)


def _sans_allure(texte: str) -> str:
    """Allures et parenthèses retirées avant de chercher les durées : 4'55/km n'est pas 4 min 55."""
    return re.sub(r"\([^)]*\)", " ", _RE_ALLURE.sub(" ", texte))


def _parties(contenu: str) -> list[str]:
    """« 10' de trot + 5' de marche », « 15' en EF, puis 4 × 30'' vite » : une partie par étape minutée."""
    coupes = [0]
    for m in _RE_SUITE.finditer(contenu):
        if _tete(_sans_allure(contenu[m.end():])):
            coupes.append(m.end())
    return [contenu[a:b] for a, b in zip(coupes, coupes[1:] + [len(contenu)])]


def _cibles(texte: str) -> dict:
    zone, allure, rpe = _RE_ZONE.search(texte), _RE_ALLURE.search(texte), _RE_RPE.search(texte)
    plage, sous = _RE_FC_PLAGE.search(texte), _RE_FC_SOUS.search(texte)
    fc_min = fc_max = None
    if plage and 60 <= int(plage.group(1)) < int(plage.group(2)) <= 230:
        fc_min, fc_max = int(plage.group(1)), int(plage.group(2))
    elif sous and 60 <= int(sous.group(1)) <= 230:
        fc_max = int(sous.group(1))
    effort = float(rpe.group(1).replace(",", ".")) if rpe else None
    return {
        "zone": int(zone.group(1)) if zone else None,
        "allure_min": f"{allure.group(1)}:{allure.group(2)}" if allure else None,
        "allure_max": f"{allure.group(3)}:{allure.group(4)}" if allure and allure.group(3) else None,
        "rpe": effort if effort and 1 <= effort <= 10 else None,
        "fc_min": fc_min, "fc_max": fc_max,
    }


def etapes_depuis_description(description: str) -> list[dict]:
    """Phases minutées d'une description classique ; liste vide si rien n'est guidable.

    Une ligne « Phase : … » peut donner plusieurs étapes (« 10' de trot + 5' de marche »).
    Les répétitions portent leur récupération, quelle que soit la façon de l'écrire ; l'allure,
    la zone, la FC et l'effort visés sont lus à part et ne restent jamais dans la consigne."""
    etapes = []
    for ligne in (description or "").splitlines():
        m = _RE_PHASE.match(ligne.strip())
        if not m or not m.group(2).strip():
            continue
        genre = _genre(m.group(1))
        avant = len(etapes)
        for partie in _parties(m.group(2).strip()):
            t = _tete(_sans_allure(partie))
            if not t:
                continue
            n, duree, dist, nom, nomme, reste = t
            recup_s = recup_m = None
            recup_texte = ""
            if n > 1:
                recup_s, recup_m, recup_texte, reste = _recuperation(reste)
                if nomme and not (recup_s or recup_m):
                    continue  # des lignes droites sans récupération dite : rien à minuter
            etapes.append({
                "genre": genre, "repetitions": n, "duree_s": duree, "distance_m": dist,
                "texte": " ".join(x for x in (nom, _clause(reste)) if x),
                **_cibles(partie), "recup_s": recup_s, "recup_m": recup_m, "recup_texte": recup_texte,
                "brut": partie.strip(),
            })
        contenu = m.group(2).strip()
        if genre == "retour" and len(etapes) == avant and _RE_LIBRE.search(contenu):
            # « trot facile jusqu’à la fin de la séance » : pas de durée, l’étape prend ce qui reste
            etapes.append({
                "genre": genre, "repetitions": 1, "duree_s": None, "distance_m": None, "libre": True,
                "texte": contenu.rstrip(" ."), **_cibles(contenu),
                "recup_s": None, "recup_m": None, "recup_texte": "", "brut": contenu,
            })
    return _sans_marche_finale(etapes)


_RE_LIBRE = re.compile(r"jusqu|\breste\b|fin de (?:la )?s[ée]ance|\blibre\b", re.IGNORECASE)
_RE_MARCHE = re.compile(r"\bmarch\w*", re.IGNORECASE)


def _sans_marche_finale(etapes: list) -> list:
    """Pas de marche après le trot du retour au calme : l’endurance suffit pour redescendre.
    Un retour au calme fait seulement de marche (séance course/marche) est gardé."""
    def marche(e):
        return e["genre"] == "retour" and bool(_RE_MARCHE.search(e.get("brut") or e.get("texte") or ""))
    if any(e["genre"] == "retour" and not marche(e) for e in etapes):
        etapes = [e for e in etapes if not marche(e)]
    return etapes if len([e for e in etapes if e.get("duree_s") or e.get("distance_m")]) >= 2 else []


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
