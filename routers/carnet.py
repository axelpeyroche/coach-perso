"""
Routes du carnet d'entraînement : activités (CRUD + imports), objectifs,
statistiques et export complet pour analyse par Claude.
"""

from __future__ import annotations

import logging
import re
import secrets as _secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional, Union
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

import carnet_service as cs
from database import obtenir_session
from deps import get_current_user
from models import Activite, Objectif, ObjectifCourse, Utilisateur

_log = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Utilitaires
# ---------------------------------------------------------------------------

def _parse_datetime(v: Any) -> datetime:
    """Accepte ISO 8601 (avec ou sans fuseau), 'jj/mm/aaaa hh:mm', epoch.
    Le fuseau est ignoré : on conserve l'heure locale telle qu'affichée."""
    if isinstance(v, datetime):
        return v.replace(tzinfo=None)
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v)
    s = str(v).strip()
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        pass
    d = cs._date_souple(s)
    if d:
        return d
    raise HTTPException(400, f"Date illisible : {s!r}")


def _activite_utilisateur(db: Session, user: Utilisateur, activite_id: int) -> Activite:
    a = db.query(Activite).filter(Activite.id == activite_id, Activite.utilisateur_id == user.id).first()
    if not a:
        raise HTTPException(404, "Activité introuvable")
    return a


def _activites(db: Session, user_id: int) -> list[Activite]:
    return db.query(Activite).filter(Activite.utilisateur_id == user_id).order_by(Activite.debut).all()


def _migrer_objectif_course(db: Session, user: Utilisateur) -> None:
    """Copie (une fois) l'ancien objectif de course unique dans la table objectifs."""
    if db.query(Objectif.id).filter(Objectif.utilisateur_id == user.id).first():
        return
    ancien = db.query(ObjectifCourse).filter(ObjectifCourse.utilisateur_id == user.id).first()
    if not ancien:
        return
    db.add(Objectif(
        utilisateur_id=user.id, type="course", titre=ancien.nom, sport="course",
        date_cible=ancien.date_course, distance_km=ancien.distance_km, dplus_m=ancien.dplus_m,
        temps_cible_sec=ancien.objectif_temps_min * 60 if ancien.objectif_temps_min else None,
        notes=ancien.notes, statut="actif" if ancien.date_course >= date.today() else "atteint",
    ))
    db.commit()


# ---------------------------------------------------------------------------
# Activités
# ---------------------------------------------------------------------------

class ActiviteSchema(BaseModel):
    sport: str
    titre: Optional[str] = None
    debut: str
    duree_sec: Optional[int] = Field(None, ge=0)
    distance_km: Optional[float] = Field(None, ge=0)
    dplus_m: Optional[int] = Field(None, ge=0)
    fc_moyenne_bpm: Optional[int] = Field(None, ge=30, le=250)
    fc_max_bpm: Optional[int] = Field(None, ge=30, le=250)
    calories: Optional[int] = Field(None, ge=0)
    rpe: Optional[float] = Field(None, ge=1, le=10)
    ressenti: Optional[int] = Field(None, ge=1, le=5)
    notes: Optional[str] = None
    est_competition: bool = False
    objectif_id: Optional[int] = None
    details: Optional[Any] = None


def _appliquer(a: Activite, p: ActiviteSchema, db: Session, user: Utilisateur) -> None:
    if p.objectif_id is not None and not db.query(Objectif.id).filter(
        Objectif.id == p.objectif_id, Objectif.utilisateur_id == user.id
    ).first():
        raise HTTPException(400, "Objectif inconnu")
    data = p.model_dump()
    data["sport"] = cs.normaliser_sport(p.sport)
    data["debut"] = _parse_datetime(p.debut)
    if isinstance(data.get("details"), dict) and p.rpe is not None:
        data["details"].pop("rpe_source", None)  # RPE confirmé par l'utilisateur
    if isinstance(data.get("details"), (dict, list)):
        import json
        data["details"] = json.dumps(data["details"], ensure_ascii=False)
    for k, v in data.items():
        setattr(a, k, v)


@router.get("/api/carnet/sports", summary="Liste des sports du carnet")
def lister_sports():
    return [{"code": k, **v} for k, v in cs.SPORTS.items()]


@router.get("/api/carnet/sports-presents", summary="Sports ayant au moins une activité (nombre par sport)")
def sports_presents(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    from sqlalchemy import func
    lignes = (db.query(Activite.sport, func.count(Activite.id))
              .filter(Activite.utilisateur_id == current_user.id)
              .group_by(Activite.sport).all())
    return {s: n for s, n in lignes if s}


@router.get("/api/activites", summary="Liste des activités (filtres sport/dates, pagination)")
def lister_activites(
    sport: Optional[str] = None,
    depuis: Optional[date] = None,
    jusqu_a: Optional[date] = None,
    q: Optional[str] = None,
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    req = db.query(Activite).filter(Activite.utilisateur_id == current_user.id)
    if sport:
        req = req.filter(Activite.sport == sport)
    if depuis:
        req = req.filter(Activite.debut >= datetime.combine(depuis, datetime.min.time()))
    if jusqu_a:
        req = req.filter(Activite.debut < datetime.combine(jusqu_a + timedelta(days=1), datetime.min.time()))
    if q:
        motif = f"%{q}%"
        req = req.filter((Activite.titre.ilike(motif)) | (Activite.notes.ilike(motif)))
    total = req.count()
    items = req.order_by(Activite.debut.desc()).offset(offset).limit(limit).all()
    return {"total": total, "activites": [cs.serialiser_activite(a) for a in items]}


@router.post("/api/activites", summary="Ajoute une activité manuellement")
def creer_activite(
    payload: ActiviteSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    a = Activite(utilisateur_id=current_user.id, source="manuel")
    _appliquer(a, payload, db, current_user)
    db.add(a)
    db.commit()
    db.refresh(a)
    return cs.serialiser_activite(a)


@router.get("/api/activites/{activite_id}", summary="Détail d'une activité")
def detail_activite(
    activite_id: int,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return cs.serialiser_activite(_activite_utilisateur(db, current_user, activite_id))


@router.put("/api/activites/{activite_id}", summary="Modifie une activité")
def modifier_activite(
    activite_id: int,
    payload: ActiviteSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    a = _activite_utilisateur(db, current_user, activite_id)
    _appliquer(a, payload, db, current_user)
    db.commit()
    db.refresh(a)
    return cs.serialiser_activite(a)


@router.delete("/api/activites/{activite_id}", summary="Supprime une activité")
def supprimer_activite(
    activite_id: int,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    a = _activite_utilisateur(db, current_user, activite_id)
    cs.memoriser_seance_ignoree(current_user, a)
    db.delete(a)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Imports
# ---------------------------------------------------------------------------

class ActiviteImportee(BaseModel):
    """Format souple accepté depuis un raccourci iOS (Apple Santé) ou un script.
    Les nombres peuvent arriver tels que iOS les écrit (« 10,2 km », « 690 kcal »,
    « 52 min ») et les dates au format ISO ou localisé (« 5 oct. 2026 à 07:30 »)."""
    id: Optional[str] = None
    type: Optional[str] = None           # "Running", "Course à pied", "Cycling"…
    sport: Optional[str] = None
    titre: Optional[str] = None
    debut: Union[str, float]
    fin: Optional[Union[str, float]] = None
    duree: Any = None                    # unité libre (« 52 min », « 1:02:03 », secondes)
    duree_sec: Any = None
    duree_min: Any = None
    distance: Any = None                 # unité libre (km par défaut, « 10 200 m », « 6,3 mi »)
    distance_km: Any = None
    distance_m: Any = None
    dplus_m: Any = None
    fc_moyenne: Any = None
    fc_moyenne_bpm: Any = None
    fc_max_bpm: Any = None
    calories: Any = None                 # kcal (« 690 kcal », « 2 890 kJ »)
    energie: Any = None
    rpe: Any = None
    notes: Optional[str] = None


class MesureImportee(BaseModel):
    type: str                            # fc_repos | vfc | vo2max (ou nom Apple)
    date: Union[str, float]
    valeur: Any


class ImportActivitesSchema(BaseModel):
    """En plus des listes ci-dessous, accepte à plat :
    - une séance (champs d'ActiviteImportee à la racine, dès que `debut` est fourni) ;
    - des mesures en listes parallèles `<type>_valeurs` / `<type>_dates`, sous forme de
      liste JSON ou de texte (une valeur par ligne, comme iOS insère une liste)."""
    model_config = ConfigDict(extra="allow")
    token: str
    source: str = "apple_sante"
    activites: Optional[list[ActiviteImportee]] = None
    activite: Optional[ActiviteImportee] = None
    mesures: Optional[list[MesureImportee]] = None


_RE_NOMBRE = re.compile(r"[-+]?(?:\d{1,3}(?:[   ]\d{3})+|\d+)(?:[.,]\d+)?")
_MOIS = [("jan", 1), ("fev", 2), ("feb", 2), ("mar", 3), ("avr", 4), ("apr", 4), ("mai", 5), ("may", 5),
         ("juin", 6), ("jun", 6), ("juil", 7), ("jul", 7), ("aou", 8), ("aug", 8), ("sep", 9), ("oct", 10),
         ("nov", 11), ("dec", 12)]


def _vide(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not v.strip())


def _nombre_unite(v: Any) -> tuple[Optional[float], str]:
    """« 10,2 km » → (10.2, "km") ; 42 → (42.0, "")."""
    if _vide(v) or isinstance(v, bool):
        return None, ""
    if isinstance(v, (int, float)):
        return float(v), ""
    s = str(v).strip()
    m = _RE_NOMBRE.search(s)
    if not m:
        return None, ""
    n = float(re.sub(r"[   ]", "", m.group()).replace(",", "."))
    return n, cs._sans_accents(s[m.end():]).strip().strip(".")


def _distance_km(v: Any) -> Optional[float]:
    n, u = _nombre_unite(v)
    if n is None or n <= 0:
        return None
    if u.startswith("km"):
        return n
    if u.startswith("mi"):
        return n * 1.609344
    if u.startswith("m") or (not u and n > 300):
        return n / 1000
    return n


def _duree_sec(v: Any, ecoule: Optional[float]) -> Optional[float]:
    """Durée exprimée librement. Un nombre nu est lu en secondes ou en minutes
    selon ce qui colle le mieux au temps écoulé entre début et fin."""
    if _vide(v):
        return None
    s = re.sub(r"(?<=\d)[   ](?=\d{3}\b)", "", cs._sans_accents(str(v)).strip())
    if re.fullmatch(r"\d+:\d{2}(:\d{2})?", s):
        p = [int(x) for x in s.split(":")]
        return p[0] * 3600 + p[1] * 60 + p[2] if len(p) == 3 else p[0] * 60 + p[1]
    morceaux = re.findall(r"(\d+(?:[.,]\d+)?)\s*(h|min|mn|m|s)", s)
    if morceaux:
        mult = {"h": 3600, "min": 60, "mn": 60, "m": 60, "s": 1}
        return sum(float(n.replace(",", ".")) * mult[u] for n, u in morceaux)
    n, _ = _nombre_unite(v)
    if n is None or n <= 0:
        return None
    if ecoule:
        return min((n, n * 60), key=lambda d: abs(d - ecoule) if d <= ecoule * 1.05 else float("inf"))
    return n if n > 300 else n * 60


def _calories(v: Any) -> Optional[float]:
    n, u = _nombre_unite(v)
    if n is None or n <= 0:
        return None
    return n / 4.184 if u.startswith("kj") else n


def _date_localisee(s: str) -> Optional[datetime]:
    """« 5 oct. 2026 à 07:30 », « 5 octobre 2026 à 7:30:12 », « Oct 5, 2026 at 7:30 AM », « hier à 18:04 »."""
    s = cs._sans_accents(s).strip()
    jour = None
    if s.startswith(("aujourd", "today")):
        jour = date.today()
    elif s.startswith(("hier", "yesterday")):
        jour = date.today() - timedelta(days=1)
    else:
        m = re.search(r"(\d{1,2})(?:er)?\s+([a-z]+)\.?,?\s+(\d{4})", s)
        j, mot, an = (m.group(1), m.group(2), m.group(3)) if m else (None, None, None)
        if not m:
            m = re.search(r"([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})", s)
            if m:
                mot, j, an = m.group(1), m.group(2), m.group(3)
        if not m:
            return None
        mois = next((n for p, n in _MOIS if mot.startswith(p)), None)
        if not mois:
            return None
        try:
            jour = date(int(an), mois, int(j))
        except ValueError:
            return None
        s = s[m.end():]
    t = re.search(r"(\d{1,2})[:h](\d{2})(?::(\d{2}))?\s*(am|pm)?", s)
    h, mi, se = (int(t.group(1)), int(t.group(2)), int(t.group(3) or 0)) if t else (0, 0, 0)
    if t and t.group(4):
        h = h % 12 + (12 if t.group(4) == "pm" else 0)
    try:
        return datetime.combine(jour, datetime.min.time()).replace(hour=h, minute=mi, second=se)
    except ValueError:
        return None


def _date_import(v: Any, tz: ZoneInfo) -> datetime:
    """Comme _parse_datetime, mais une date avec fuseau (ex. « …Z ») est ramenée à
    l'heure locale de l'utilisateur, et les formats localisés d'iOS sont acceptés."""
    if isinstance(v, str):
        s = v.strip()
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
            return d.astimezone(tz).replace(tzinfo=None) if d.tzinfo else d
        except ValueError:
            d = cs._date_souple(s) or _date_localisee(s)
            if d:
                return d
    return _parse_datetime(v)


def _fuseau(user: Utilisateur) -> ZoneInfo:
    try:
        return ZoneInfo(user.fuseau_horaire or "Europe/Paris")
    except Exception:
        return ZoneInfo("Europe/Paris")


def _convertir_import(x: ActiviteImportee, tz: ZoneInfo) -> tuple[str, dict]:
    debut = _date_import(x.debut, tz)
    ecoule = (_date_import(x.fin, tz) - debut).total_seconds() if not _vide(x.fin) else None
    if ecoule is not None and ecoule <= 0:
        ecoule = None
    duree = _nombre_unite(x.duree_sec)[0]
    if duree is None and _nombre_unite(x.duree_min)[0] is not None:
        duree = _nombre_unite(x.duree_min)[0] * 60
    if duree is None:
        duree = _duree_sec(x.duree, ecoule)
    if duree is None:
        duree = ecoule
    dist = _nombre_unite(x.distance_km)[0]
    if dist is None:
        m = _nombre_unite(x.distance_m)[0]
        dist = m / 1000 if m else _distance_km(x.distance)
    sport = cs.normaliser_sport(x.sport or x.type)
    entier = lambda v: int(round(v)) if v else None
    num = lambda v: _nombre_unite(v)[0]
    rpe = num(x.rpe)
    donnees = {
        # Le type Apple ne sert de titre que s'il n'a pas d'équivalent dans le carnet (« Danse »…)
        "sport": sport, "titre": x.titre or (x.type if x.type and not x.sport and sport == "autre" else None),
        "debut": debut, "duree_sec": entier(duree), "distance_km": round(dist, 3) if dist else None,
        "dplus_m": entier(num(x.dplus_m)), "fc_moyenne_bpm": entier(num(x.fc_moyenne_bpm) or num(x.fc_moyenne)),
        "fc_max_bpm": entier(num(x.fc_max_bpm)), "calories": entier(_calories(x.calories) or _calories(x.energie)),
        "rpe": rpe if rpe and 1 <= rpe <= 10 else None, "notes": x.notes,
    }
    id_ext = x.id or f"{sport}-{debut:%Y%m%dT%H%M}"
    return id_ext, donnees


def _liste(v: Any) -> list:
    if _vide(v):
        return []
    if isinstance(v, list):
        return v
    return [l for l in str(v).splitlines() if l.strip()]


def _serie(extra: dict, t: str, tz: ZoneInfo) -> list[tuple[datetime, float, str]]:
    """Listes parallèles `<t>_valeurs` / `<t>_dates` → [(date, valeur, unité)]."""
    points = []
    for v, d in zip(_liste(extra.get(f"{t}_valeurs")), _liste(extra.get(f"{t}_dates"))):
        n, unite = _nombre_unite(v)
        try:
            quand = _date_import(d, tz)
        except HTTPException:
            continue
        if n is not None:
            points.append((quand, n, unite))
    return points


def _mesures_a_plat(extra: dict, tz: ZoneInfo) -> list[tuple[str, date, float]]:
    """Séries quotidiennes (FC repos, VFC, VO2max) : moyenne du jour, dernière valeur pour la VO2max."""
    par_jour: dict[tuple[str, date], list[tuple[datetime, float]]] = {}
    for t in cs.MESURES:
        for quand, n, _ in _serie(extra, t, tz):
            par_jour.setdefault((t, quand.date()), []).append((quand, n))
    res = []
    for (t, j), pts in sorted(par_jour.items(), key=lambda x: x[0][1]):
        vs = [v for _, v in sorted(pts)]
        res.append((t, j, vs[-1] if t == "vo2max" else sum(vs) / len(vs)))
    return res


def _unite_echantillon(t: str, n: float, unite: str) -> Optional[float]:
    """Ramène un échantillon à l'unité du carnet (km/h, m, cm, ms)."""
    u = unite.lower().replace(" ", "")
    if t == "vitesse":
        if u in ("m/s", "ms") or (not u and n < 8):
            return n * 3.6
        if u in ("mi/h", "mph"):
            return n * 1.609344
        return n
    if t == "foulee":
        return n / 100 if u == "cm" or (not u and n > 3) else n
    if t == "oscillation":
        return n * 100 if u == "m" or (not u and n < 0.5) else (n / 10 if u == "mm" else n)
    if t == "contact_sol":
        return n * 1000 if u == "s" or (not u and n < 3) else n
    if t == "puissance" and u == "kw":
        return n * 1000
    if t in ("distance", "distance_velo"):
        return n / 1000 if u == "m" else (n * 1.609344 if u == "mi" else n)
    if t == "energie":
        return n / 4.184 if u == "kj" else n
    if t == "exercice":
        return n / 60 if u == "s" else (n * 60 if u == "h" else n)
    return n


def _echantillons(extra: dict, tz: ZoneInfo) -> dict[str, list[tuple[datetime, float]]]:
    ech = {}
    for t in cs.ECHANTILLONS:
        pts = [(q, _unite_echantillon(t, n, u)) for q, n, u in _serie(extra, t, tz)]
        if pts:
            ech[t] = pts
    return ech


@router.post("/api/activites/import", summary="Import d'activités (raccourci iOS / script) — auth par token d'import")
def importer_activites(payload: ImportActivitesSchema, db: Session = Depends(obtenir_session)):
    try:
        return _importer_activites(payload, db)
    except HTTPException as e:
        # Même chose pour un token invalide ou un envoi vide : le raccourci doit afficher la raison
        return {"ok": False, "message": str(e.detail)}
    except Exception as e:
        # Le raccourci iOS n'affiche qu'un « problème est survenu » sur une erreur 500 :
        # on renvoie la cause en clair pour qu'elle apparaisse dans la notification.
        db.rollback()
        _log.exception("Import raccourci en échec")
        return {"ok": False, "message": f"Erreur serveur ({type(e).__name__}) : {str(e)[:300]}"}


def _importer_activites(payload: ImportActivitesSchema, db: Session):
    token = (payload.token or "").strip()
    user = db.query(Utilisateur).filter(Utilisateur.import_token == token).first() if token else None
    if not user:
        raise HTTPException(401, f"Token invalide (reçu {len(token)} caractères, commençant par « {token[:3]} ») : "
                                 "recopie-le depuis la page Sources du carnet")
    tz = _fuseau(user)
    extra = payload.model_extra or {}
    lot = list(payload.activites or []) + ([payload.activite] if payload.activite else [])
    if not _vide(extra.get("debut")):
        lot.append(ActiviteImportee(**extra))
    items_mesures = [(m.type, _date_import(m.date, tz).date(), _nombre_unite(m.valeur)[0])
                     for m in payload.mesures or []] + _mesures_a_plat(extra, tz)
    ech = _echantillons(extra, tz)
    if not lot and not items_mesures and not ech:
        recus = ", ".join(f"{k} ({len(_liste(v))})" for k, v in extra.items()) or "aucun"
        exemple = next((str(_liste(v)[0])[:40] for k, v in extra.items() if k.endswith("_dates") and _liste(v)), None)
        raise HTTPException(400, "Aucune activité ni mesure exploitable. Champs reçus : " + recus
                            + (f". Exemple de date reçue : « {exemple} »" if exemple else ""))
    source = payload.source if payload.source in ("apple_sante", "fichier", "strava") else "apple_sante"
    bilan = {"cree": 0, "maj": 0, "fusion": 0, "inchange": 0}
    for x in lot:
        id_ext, donnees = _convertir_import(x, tz)
        act, statut = cs.importer_activite(db, user.id, source, donnees, id_externe=id_ext)
        bilan[statut] += 1
        if act is not None and not _vide(x.fin):
            # La fin réelle (pauses comprises) sert à rattacher les échantillons à la séance
            cs.fusionner_details(act, {"fin": _date_import(x.fin, tz).isoformat(timespec="seconds")})
    db.flush()
    mesures = cs.importer_mesures(db, user.id, items_mesures)
    recus = sum(len(p) for p in ech.values())
    ech = cs.stocker_echantillons(db, user.id, ech)  # + ceux envoyés par les autres raccourcis
    detectees = cs.detecter_seances(db, user, ech) if ech else 0
    completees = cs.enrichir_activites(db, user, ech) if ech else 0
    db.commit()
    morceaux = []
    if lot:
        morceaux.append(f"{len(lot)} séance(s) : {bilan['cree']} nouvelle(s), {bilan['maj'] + bilan['fusion']} déjà connue(s)")
    if items_mesures:
        morceaux.append(f"{mesures['cree'] + mesures['maj']} mesure(s) de forme"
                        + (f", {mesures['ignore']} ignorée(s)" if mesures["ignore"] else ""))
    if detectees:
        morceaux.append(f"{detectees} séance(s) détectée(s)")
    if ech:
        morceaux.append(f"{recus} échantillon(s) reçu(s)")
        morceaux.append(f"{completees} séance(s) complétée(s) (FC, puissance, effort…)")
    return {"ok": True, **bilan, "mesures": mesures, "seances_detectees": detectees,
            "seances_completees": completees,
            "message": " · ".join(morceaux)}


@router.post("/api/activites/import-fichier", summary="Import CSV (export Strava activities.csv ou CSV du carnet)")
async def importer_fichier(
    fichier: UploadFile = File(...),
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    brut = await fichier.read(20_000_000)
    try:
        contenu = brut.decode("utf-8-sig")
    except UnicodeDecodeError:
        contenu = brut.decode("latin-1")
    mesures = cs.parser_csv_mesures(contenu)
    if mesures is not None:
        bilan = cs.importer_mesures(db, current_user.id, mesures)
        db.commit()
        return {"ok": True, "source": "mesures", "lignes": len(mesures), **bilan, "fusion": 0, "inchange": bilan["ignore"]}
    source, lignes = cs.parser_csv(contenu)
    if not lignes:
        raise HTTPException(400, "Aucune activité reconnue dans ce fichier (colonnes de date introuvables ?)")
    if source == "strava":
        # Les dates de l'export Strava sont en UTC : on les ramène à l'heure locale
        try:
            tz = ZoneInfo(current_user.fuseau_horaire or "Europe/Paris")
        except Exception:
            tz = ZoneInfo("Europe/Paris")
        for _, donnees in lignes:
            donnees["debut"] = donnees["debut"].replace(tzinfo=timezone.utc).astimezone(tz).replace(tzinfo=None)
    bilan = {"cree": 0, "maj": 0, "fusion": 0, "inchange": 0}
    for id_ext, donnees in lignes:
        _, statut = cs.importer_activite(db, current_user.id, source, donnees, id_externe=id_ext)
        bilan[statut] += 1
    db.commit()
    return {"ok": True, "source": source, "lignes": len(lignes), **bilan}


# ---------------------------------------------------------------------------
# Objectifs
# ---------------------------------------------------------------------------

class ObjectifSchema(BaseModel):
    type: str = Field(..., pattern="^(course|perso)$")
    titre: str = Field(..., min_length=1, max_length=200)
    sport: Optional[str] = None
    date_cible: Optional[date] = None
    date_debut: Optional[date] = None
    distance_km: Optional[float] = Field(None, gt=0)
    dplus_m: Optional[int] = Field(None, ge=0)
    temps_cible_sec: Optional[int] = Field(None, gt=0)
    url: Optional[str] = None
    metrique: Optional[str] = Field(None, pattern="^(distance_km|duree_h|dplus_m|nb_seances|valeur_libre)$")
    valeur_cible: Optional[float] = None
    valeur_actuelle: Optional[float] = None
    unite: Optional[str] = None
    statut: str = Field("actif", pattern="^(actif|atteint|abandonne)$")
    resultat_temps_sec: Optional[int] = None
    notes: Optional[str] = None


def _objectif_utilisateur(db: Session, user: Utilisateur, objectif_id: int) -> Objectif:
    o = db.query(Objectif).filter(Objectif.id == objectif_id, Objectif.utilisateur_id == user.id).first()
    if not o:
        raise HTTPException(404, "Objectif introuvable")
    return o


@router.get("/api/objectifs", summary="Objectifs avec leur progression calculée")
def lister_objectifs(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    _migrer_objectif_course(db, current_user)
    acts = _activites(db, current_user.id)
    objectifs = db.query(Objectif).filter(Objectif.utilisateur_id == current_user.id).all()
    res = [cs.progression_objectif(o, acts) for o in objectifs]
    ordre = {"actif": 0, "atteint": 1, "abandonne": 2}
    res.sort(key=lambda o: (ordre.get(o["statut"], 3), o["date_cible"] or "9999"))
    return res


@router.post("/api/objectifs", summary="Crée un objectif")
def creer_objectif(
    payload: ObjectifSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    o = Objectif(utilisateur_id=current_user.id, **payload.model_dump())
    if o.type == "perso" and not o.date_debut:
        o.date_debut = date.today()
    db.add(o)
    db.commit()
    db.refresh(o)
    return cs.progression_objectif(o, _activites(db, current_user.id))


@router.put("/api/objectifs/{objectif_id}", summary="Modifie un objectif")
def modifier_objectif(
    objectif_id: int,
    payload: ObjectifSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    o = _objectif_utilisateur(db, current_user, objectif_id)
    # Le type (course officielle / objectif perso) se choisit à la création et ne change plus
    for k, v in payload.model_dump(exclude={"type"}).items():
        setattr(o, k, v)
    db.commit()
    db.refresh(o)
    return cs.progression_objectif(o, _activites(db, current_user.id))


@router.delete("/api/objectifs/{objectif_id}", summary="Supprime un objectif")
def supprimer_objectif(
    objectif_id: int,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    o = _objectif_utilisateur(db, current_user, objectif_id)
    db.query(Activite).filter(Activite.objectif_id == o.id).update({Activite.objectif_id: None})
    db.delete(o)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Statistiques
# ---------------------------------------------------------------------------

@router.get("/api/stats", summary="Statistiques complètes du carnet")
def stats(
    sport: Optional[str] = None,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return cs.calculer_stats(_activites(db, current_user.id), sport=sport)


@router.get("/api/mesures", summary="Mesures de forme (FC repos, VFC, VO2max) : séries et moyennes")
def mesures(
    jours: int = Query(365, ge=7, le=3650),
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return cs.series_mesures(db, current_user.id, jours=jours)


# ---------------------------------------------------------------------------
# Export / lien d'analyse pour Claude
# ---------------------------------------------------------------------------

@router.get("/api/analyse/token", summary="Retourne (et génère si besoin) le token du lien d'analyse")
def get_analyse_token(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    if not current_user.analyse_token:
        current_user.analyse_token = _secrets.token_urlsafe(24)
        db.commit()
    return {"analyse_token": current_user.analyse_token}


@router.post("/api/analyse/token/regenerer", summary="Régénère le lien d'analyse (invalide l'ancien)")
def regenerer_analyse_token(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    current_user.analyse_token = _secrets.token_urlsafe(24)
    db.commit()
    return {"analyse_token": current_user.analyse_token}


def _reponse_export(db: Session, user: Utilisateur, format: str):
    data = cs.construire_export(db, user)
    if format == "json":
        return data
    if format == "csv":
        return PlainTextResponse(cs.export_csv(data), media_type="text/csv; charset=utf-8",
                                 headers={"Content-Disposition": 'attachment; filename="carnet.csv"'})
    return PlainTextResponse(cs.export_markdown(data), media_type="text/markdown; charset=utf-8")


@router.get("/api/export/carnet", summary="Export complet du carnet (md | json | csv) — authentifié")
def export_carnet(
    format: str = Query("md", pattern="^(md|json|csv)$"),
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return _reponse_export(db, current_user, format)


@router.get("/api/analyse/{token}", summary="Lien secret en lecture seule — export complet pour Claude")
def analyse_publique(
    token: str,
    format: str = Query("md", pattern="^(md|json|csv)$"),
    db: Session = Depends(obtenir_session),
):
    if len(token) < 20:
        raise HTTPException(404, "Lien invalide")
    user = db.query(Utilisateur).filter(Utilisateur.analyse_token == token).first()
    if not user:
        raise HTTPException(404, "Lien invalide")
    return _reponse_export(db, user, format)
