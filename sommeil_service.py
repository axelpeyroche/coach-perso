"""Nuits de sommeil reconstituées à partir des phases Apple Santé (raccourci iOS).

Apple ne partage pas son score de sommeil avec les autres applications : le carnet le
recalcule avec la même méthode publiée (durée /50, régularité du coucher /30, réveils /20).
"""
from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime, timedelta
from statistics import median
from typing import Iterable, Optional

from sqlalchemy.orm import Session

import carnet_service as cs
from models import NuitSommeil

STADES = ("profond", "paradoxal", "essentiel")
ENDORMI = set(STADES) | {"endormi"}
ECART_SESSION = timedelta(minutes=90)  # au-delà, deux tranches n'appartiennent plus à la même nuit
NUIT_MIN = 120  # minutes de sommeil en dessous desquelles c'est une sieste
REVEIL_LONG = 5  # minutes : réveil qui compte dans le score
REGULARITE_NUITS = 13  # comme Apple : heure d'endormissement des 13 nuits précédentes

# Valeurs brutes HealthKit (HKCategoryValueSleepAnalysis)
_CODES = {0: "lit", 1: "endormi", 2: "eveil", 3: "essentiel", 4: "profond", 5: "paradoxal"}
# Libellés de Raccourcis (français ou anglais), testés dans cet ordre
_MOTS = [
    ("paradoxal", ("paradox", "rem")),
    ("profond", ("profond", "deep")),
    ("essentiel", ("essentiel", "core", "leger", "light")),
    ("eveil", ("eveil", "awake", "reveil")),
    ("lit", ("au lit", "in bed", "inbed", "couche")),
    ("endormi", ("endormi", "asleep", "sommeil", "sleep", "unspecified")),
]
# Identifiants de l'export Santé (export.xml) : HKCategoryValueSleepAnalysis<suffixe>
_HK = {"inbed": "lit", "asleep": "endormi", "asleepunspecified": "endormi", "awake": "eveil",
       "asleepcore": "essentiel", "asleepdeep": "profond", "asleeprem": "paradoxal"}
LABELS_SCORE = [(96, "Très élevé"), (81, "Élevé"), (61, "OK"), (41, "Bas"), (0, "Très bas")]


def _sans_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def normaliser_phase(v) -> Optional[str]:
    s = _sans_accents(str(v or "")).lower().strip()
    if re.fullmatch(r"\d", s):
        return _CODES.get(int(s))
    if s.startswith("hkcategoryvaluesleepanalysis"):
        return _HK.get(s.removeprefix("hkcategoryvaluesleepanalysis"))
    for phase, mots in _MOTS:
        if any(re.search(rf"\b{m}", s) for m in mots):
            return phase
    return None


def _union(tranches: Iterable[tuple[datetime, datetime]]) -> list[tuple[datetime, datetime]]:
    res: list[list[datetime]] = []
    for d, f in sorted(tranches):
        if res and d <= res[-1][1]:
            res[-1][1] = max(res[-1][1], f)
        else:
            res.append([d, f])
    return [(d, f) for d, f in res]


def _minutes(tranches) -> float:
    return sum((f - d).total_seconds() for d, f in tranches) / 60


def _coupe(tranches, debut: datetime, fin: datetime):
    return [(max(d, debut), min(f, fin)) for d, f in tranches if f > debut and d < fin]


def _interp(x: float, points: list[tuple[float, float]]) -> float:
    if x <= points[0][0]:
        return points[0][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return points[-1][1]


def points_duree(heures: float) -> float:
    """/50 : plein à partir de 8 h de sommeil effectif."""
    return _interp(heures, [(0, 0), (4, 10), (5, 22), (6, 33), (7, 43), (7.5, 47), (8, 50)])


def minutes_coucher(endormissement: datetime) -> float:
    """Heure d'endormissement en minutes depuis 18 h (minuit = 360), pour comparer 23 h 30 et 0 h 30."""
    m = endormissement.hour * 60 + endormissement.minute
    return m - 18 * 60 if m >= 18 * 60 else m + 6 * 60


def points_regularite(endormissement: datetime, precedents: list[datetime]) -> Optional[float]:
    """/30 : écart à l'heure d'endormissement habituelle (médiane des nuits précédentes).
    Plein jusqu'à 30 min d'écart, nul à 3 h."""
    if not precedents:
        return None
    ecart = abs(minutes_coucher(endormissement) - median(minutes_coucher(p) for p in precedents))
    return _interp(ecart, [(30, 30), (180, 0)])


def points_interruptions(eveil_min: float, reveils_longs: int) -> float:
    """/20 : temps éveillé au-delà de 5 min et réveils de plus de 5 min."""
    return max(0.0, 20 - max(0.0, eveil_min - 5) * 0.3 - reveils_longs * 2)


def label_score(score: Optional[int]) -> Optional[str]:
    if score is None:
        return None
    return next(l for seuil, l in LABELS_SCORE if score >= seuil)


def _sessions(tranches: list[tuple[str, datetime, datetime]]) -> list[list[tuple[str, datetime, datetime]]]:
    """Regroupe les tranches (hors « au lit ») en sessions continues de sommeil."""
    sessions: list[list] = []
    fin = None
    for t in sorted((t for t in tranches if t[0] != "lit"), key=lambda t: t[1]):
        if not sessions or t[1] > fin + ECART_SESSION:
            sessions.append([])
            fin = t[2]
        sessions[-1].append(t)
        fin = max(fin, t[2])
    return sessions


def _analyser(session) -> Optional[dict]:
    # Avec des phases (montre), un « endormi » générique d'une autre source (iPhone, appli) les recouvrirait
    a_phases = any(p in STADES for p, _, _ in session)
    endormi = _union((d, f) for p, d, f in session if p in (STADES if a_phases else ENDORMI))
    if not endormi:
        return None
    debut, fin = endormi[0][0], endormi[-1][1]
    eveils = _union(_coupe([(d, f) for p, d, f in session if p == "eveil"], debut, fin))
    if not eveils:  # pas de tranche « éveillé » : les trous entre deux tranches de sommeil
        eveils = [(f0, d1) for (_, f0), (d1, _) in zip(endormi, endormi[1:])]
    stades = {s: _minutes(_union((d, f) for p, d, f in session if p == s)) for s in STADES}
    a_stades = any(stades.values())
    episodes = [_minutes([e]) for e in eveils]
    return {
        "endormissement": debut, "reveil": fin, "endormi_min": _minutes(endormi),
        **{f"{s}_min": (round(m, 1) if a_stades else None) for s, m in stades.items()},
        "eveil_min": round(sum(episodes), 1),
        "reveils": sum(1 for m in episodes if m >= 1),
        "reveils_longs": sum(1 for m in episodes if m >= REVEIL_LONG),
    }


def _jour_nuit(reveil: datetime) -> date:
    """La nuit compte pour le jour du réveil (une session finie après 18 h compte pour le lendemain)."""
    return reveil.date() if reveil.hour < 18 else reveil.date() + timedelta(days=1)


def enregistrer_phases(db: Session, user_id: int, tranches: list[tuple[str, datetime, datetime]]) -> dict:
    """tranches : (libellé reçu, début, fin) en heure locale. Reconstitue chaque nuit, calcule son
    score, met à jour la durée et le score journaliers (mesures « sommeil » et « score_sommeil »)."""
    reconnues, inconnus = [], set()
    for libelle, d, f in tranches:
        p = normaliser_phase(libelle)
        if p is None:
            inconnus.add(str(libelle)[:30])
        elif f > d:
            reconnues.append((p, d, f))
    nuits: dict[date, dict] = {}
    for s in _sessions(reconnues):
        n = _analyser(s)
        if not n or n["endormi_min"] < NUIT_MIN:
            continue
        j = _jour_nuit(n["reveil"])
        if j not in nuits or n["endormi_min"] > nuits[j]["endormi_min"]:
            nuits[j] = n
    enregistrees = []
    existantes = {r.jour: r for r in db.query(NuitSommeil).filter(
        NuitSommeil.utilisateur_id == user_id,
        NuitSommeil.jour >= min(nuits, default=date.today()) - timedelta(days=REGULARITE_NUITS))}
    for j in sorted(nuits):
        n = nuits[j]
        precedents = [r.endormissement for jr, r in existantes.items()
                      if j - timedelta(days=REGULARITE_NUITS) <= jr < j]
        duree = points_duree(n["endormi_min"] / 60)
        regul = points_regularite(n["endormissement"], precedents)
        inter = points_interruptions(n["eveil_min"], n.pop("reveils_longs"))
        # Sans historique, la régularité est remplacée par la moyenne des deux autres critères
        total = duree + inter + (regul if regul is not None else 30 * (duree + inter) / 70)
        row = existantes.get(j)
        if not row:
            row = existantes[j] = NuitSommeil(utilisateur_id=user_id, jour=j)
            db.add(row)
        for k, v in n.items():
            setattr(row, k, round(v, 1) if isinstance(v, float) else v)
        row.score = int(round(total))
        row.score_duree, row.score_interruptions = round(duree, 1), round(inter, 1)
        row.score_regularite = round(regul, 1) if regul is not None else None
        enregistrees.append(row)
    db.flush()
    cs.importer_mesures(db, user_id, [m for r in enregistrees for m in (
        ("sommeil", r.jour, r.endormi_min / 60), ("score_sommeil", r.jour, float(r.score)))])
    return {"nuits": enregistrees, "inconnus": sorted(inconnus), "recues": len(tranches),
            "stades": any(r.profond_min for r in enregistrees)}


def resume(res: dict) -> str:
    """Phrase affichée par le raccourci après l'envoi."""
    nuits = res["nuits"]
    hm = lambda m: f"{int(m // 60)} h {int(round(m % 60)):02d}"
    if not nuits:
        msg = f"{res['recues']} tranche(s) de sommeil reçue(s), aucune nuit reconstituée"
        if res["inconnus"]:
            msg += " : libellés non reconnus « " + " », « ".join(res["inconnus"][:6]) + " »"
        return msg
    d = nuits[-1]
    msg = f"{len(nuits)} nuit(s) · dernière : {hm(d.endormi_min)} de sommeil, score {d.score}/100"
    if d.profond_min is not None:
        msg += f" (profond {hm(d.profond_min)}, paradoxal {hm(d.paradoxal_min)})"
    else:
        msg += " (pas de phases détaillées)"
    if res["inconnus"]:
        msg += " · libellés ignorés : « " + " », « ".join(res["inconnus"][:4]) + " »"
    return msg


def nuits_recentes(db: Session, user_id: int, depuis: date) -> list[dict]:
    rows = (db.query(NuitSommeil).filter(NuitSommeil.utilisateur_id == user_id, NuitSommeil.jour >= depuis)
            .order_by(NuitSommeil.jour).all())
    return [{
        "jour": r.jour.isoformat(),
        "endormissement": r.endormissement.isoformat(timespec="minutes"),
        "reveil": r.reveil.isoformat(timespec="minutes"),
        "endormi_min": r.endormi_min, "profond_min": r.profond_min, "paradoxal_min": r.paradoxal_min,
        "essentiel_min": r.essentiel_min, "eveil_min": r.eveil_min, "reveils": r.reveils,
        "score": r.score, "label": label_score(r.score), "score_duree": r.score_duree,
        "score_regularite": r.score_regularite, "score_interruptions": r.score_interruptions,
    } for r in rows]
