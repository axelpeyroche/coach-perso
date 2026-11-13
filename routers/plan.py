"""
Plan d'entraînement : séances prévues.

- Routes authentifiées (JWT) pour le dashboard : consulter le plan, créer ou modifier
  une séance (texte ou blocs, répétée chaque semaine), la sauter, la relier à une activité,
  commenter, supprimer, l'envoyer sur la montre (calendrier Intervals.icu), « Mes modèles ».
- Routes « Claude » (en-tête `X-Carnet-Token`) pour le script `outils/carnet.py` :
  lire l'export complet, lire et envoyer le plan.
"""

from __future__ import annotations

import json
import secrets as _secrets
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field, StrictInt
from sqlalchemy.orm import Session

import animations as an
import blocs_service as bl
import carnet_service as cs
import deps
import intervals_service as iv
import periodes_service as pe
import pictogrammes as pg
from database import obtenir_session
from deps import get_current_user
from models import Activite, ModeleSeance, Objectif, SeancePrevue, Utilisateur
from routers.carnet import _reponse_export

router = APIRouter()


# ---------------------------------------------------------------------------
# Schémas
# ---------------------------------------------------------------------------

class SeancePrevueSchema(BaseModel):
    # Rattache la séance à sa semaine (n'importe quel jour de la semaine) ; l'athlète
    # choisit lui-même le jour. Absent : semaine en cours.
    jour: Optional[date] = None
    sport: str
    titre: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    duree_min: Optional[int] = Field(None, ge=0, le=1440)
    distance_km: Optional[float] = Field(None, ge=0)
    dplus_m: Optional[int] = Field(None, ge=0)
    rpe_cible: Optional[float] = Field(None, ge=1, le=10)
    ordre: int = 0
    id_externe: Optional[str] = Field(None, max_length=100)
    objectif_id: Optional[int] = None
    # Séance construite par blocs dans l'éditeur (voir blocs_service) ; la description reste la référence lisible
    structure: Optional[dict] = None


class RepetitionSchema(BaseModel):
    toutes: int = Field(1, ge=1, le=2)   # toutes les semaines ou une semaine sur deux
    fois: int = Field(..., ge=2, le=26)  # nombre total de séances, la première comprise


class CreationPrevueSchema(SeancePrevueSchema):
    repetition: Optional[RepetitionSchema] = None


class PeriodeSchema(BaseModel):
    depuis: date
    jusqu_a: date


class EnvoiPlanSchema(BaseModel):
    seances: list[SeancePrevueSchema]
    remplacer: Optional[PeriodeSchema] = None
    # Nom d'exercice → tracés SVG (24 × 24) de son pictogramme, pour les nouveaux exercices
    pictogrammes: dict[str, list[str]] = Field(default_factory=dict, max_length=60)
    # Nom d'exercice → animation 3D du mannequin (voir animations.py), pour les nouveaux exercices
    animations: dict[str, dict] = Field(default_factory=dict, max_length=60)


class ImportPlanSchema(BaseModel):
    seances: list[SeancePrevueSchema] = Field(..., min_length=1, max_length=100)
    # supprime les séances non faites des semaines importées qui ne figurent plus dans le plan collé
    remplacer_semaines: bool = False


class MajPrevueSchema(BaseModel):
    statut: Optional[str] = Field(None, pattern="^(prevue|sautee)$")
    commentaire: Optional[str] = None
    activite_id: Optional[int] = None
    delier: bool = False
    # Séance guidée terminée (mode « séance en cours ») ; null l'efface
    deroule: Optional[dict] = None
    # Déplacement dans le calendrier
    jour: Optional[date] = None
    # Modification du contenu (séance pas encore faite)
    sport: Optional[str] = Field(None, max_length=30)
    titre: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = Field(None, max_length=20_000)
    duree_min: Optional[int] = Field(None, ge=0, le=1440)
    distance_km: Optional[float] = Field(None, ge=0, le=1000)
    dplus_m: Optional[int] = Field(None, ge=0, le=20_000)
    rpe_cible: Optional[float] = Field(None, ge=1, le=10)
    structure: Optional[dict] = None


CHAMPS_CONTENU = ("sport", "titre", "description", "duree_min", "distance_km", "dplus_m", "rpe_cible", "structure")


class EnvoiMontreSchema(BaseModel):
    jour: date


class ModeleSchema(BaseModel):
    nom: str = Field(..., min_length=1, max_length=100)
    sport: str = Field(..., max_length=30)
    titre: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=20_000)
    duree_min: Optional[int] = Field(None, ge=0, le=1440)
    distance_km: Optional[float] = Field(None, ge=0, le=1000)
    dplus_m: Optional[int] = Field(None, ge=0, le=20_000)
    rpe_cible: Optional[float] = Field(None, ge=1, le=10)
    structure: Optional[dict] = None


MAX_MODELES = 100


def _items(db: Session, user: Utilisateur, seances: list[SeancePrevueSchema]) -> list[dict]:
    objectifs = {o for (o,) in db.query(Objectif.id).filter(Objectif.utilisateur_id == user.id).all()}
    items = []
    for s in seances:
        if s.objectif_id is not None and s.objectif_id not in objectifs:
            raise HTTPException(400, f"Objectif inconnu : {s.objectif_id}")
        d = s.model_dump(exclude={"repetition"})
        d["sport"] = cs.normaliser_sport(s.sport)
        try:
            d["structure"] = bl.valider_structure(s.structure)
        except ValueError as e:
            raise HTTPException(400, str(e))
        if d["structure"] is None:
            d.pop("structure")  # un plan envoyé sans blocs n'efface pas ceux d'une séance existante
        items.append(d)
    return items


def _periode(depuis: Optional[date], jusqu_a: Optional[date]) -> tuple[date, date]:
    auj = date.today()
    lundi = auj - timedelta(days=auj.weekday())
    return depuis or lundi - timedelta(days=7), jusqu_a or lundi + timedelta(days=27)


def _prevue(db: Session, user: Utilisateur, prevue_id: int) -> SeancePrevue:
    p = db.query(SeancePrevue).filter(SeancePrevue.id == prevue_id, SeancePrevue.utilisateur_id == user.id).first()
    if not p:
        raise HTTPException(404, "Séance prévue introuvable")
    return p


def _realisee(p: SeancePrevue) -> bool:
    return bool(p.activite_id or (cs.lire_deroule(p) or {}).get("fin"))


def _retirer_de_la_montre(user: Utilisateur, p: SeancePrevue) -> None:
    """Retire la séance du calendrier Intervals.icu, au mieux (injoignable : elle y reste)."""
    e = bl.lire_structure(p.envoi_montre) or {}
    if e.get("event_id") and user.intervals_cle:
        try:
            iv.retirer_seance(user, e["event_id"])
        except iv.IntervalsErreur:
            pass
    p.envoi_montre = None


def _une(db: Session, p: SeancePrevue) -> dict:
    a = db.get(Activite, p.activite_id) if p.activite_id else None
    return cs.serialiser_prevue(p, a)


# ---------------------------------------------------------------------------
# Dashboard (JWT)
# ---------------------------------------------------------------------------

@router.get("/api/plan", summary="Séances prévues d'une période (rapprochement automatique avec les activités)")
def lister_plan(
    depuis: Optional[date] = None,
    jusqu_a: Optional[date] = None,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    d, f = _periode(depuis, jusqu_a)
    res = cs.lister_plan(db, current_user.id, d, f)
    db.commit()  # conserve les rapprochements calculés
    return {"depuis": d.isoformat(), "jusqu_a": f.isoformat(), "seances": res}


@router.post("/api/plan", summary="Ajoute une séance prévue à la main (éventuellement répétée chaque semaine)")
def creer_prevue(
    payload: CreationPrevueSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    item = _items(db, current_user, [payload])[0]
    if not item["jour"]:
        auj = date.today()
        item["jour"] = auj - timedelta(days=auj.weekday())
    rep = payload.repetition
    if rep:
        # Série rec-<série>-<k> : une séance toutes les 1 ou 2 semaines, jamais remplacée par un plan envoyé
        serie = _secrets.token_hex(5)
        items = [{**item, "id_externe": f"rec-{serie}-{k}", "jour": item["jour"] + timedelta(weeks=k * rep.toutes)}
                 for k in range(rep.fois)]
    else:
        item["id_externe"] = item["id_externe"] or f"manuel-{_secrets.token_hex(6)}"
        items = [item]
    cs.enregistrer_plan(db, current_user.id, items)
    db.commit()
    p = db.query(SeancePrevue).filter(SeancePrevue.utilisateur_id == current_user.id,
                                      SeancePrevue.id_externe == items[0]["id_externe"]).first()
    return {**_une(db, p), "crees": len(items)}


class TestPlanifie(BaseModel):
    cle: str = Field(..., max_length=30)
    jour: date


@router.post("/api/plan/tests", summary="Planifie un test guidé (demi-Cooper, seuil, allure critique, dérive, tractions)")
def planifier_test(
    payload: TestPlanifie,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    import tests_service
    auj = date.today()
    if not auj <= payload.jour <= auj + timedelta(days=366):
        raise HTTPException(422, "Choisis une date entre aujourd'hui et dans un an.")
    item = tests_service.seance(payload.cle, payload.jour)
    if not item:
        raise HTTPException(404, "Test inconnu")
    cs.enregistrer_plan(db, current_user.id, [item])
    db.commit()
    p = db.query(SeancePrevue).filter(SeancePrevue.utilisateur_id == current_user.id,
                                      SeancePrevue.id_externe == item["id_externe"]).first()
    return _une(db, p)


@router.post("/api/plan/import", summary="Importe un plan collé depuis n'importe quelle IA (ChatGPT, Gemini, Claude…)")
def importer_plan(
    payload: ImportPlanSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    items = _items(db, current_user, payload.seances)
    auj = date.today()
    lundi_courant = auj - timedelta(days=auj.weekday())
    vus: dict[tuple, int] = {}
    for rang, x in enumerate(items):
        x["jour"] = x["jour"] or lundi_courant
        x["ordre"] = x["ordre"] or rang
        if not x["id_externe"]:
            # clé stable : recoller le même plan met à jour les séances au lieu de les dupliquer
            cle = (x["jour"] - timedelta(days=x["jour"].weekday()), x["sport"])
            vus[cle] = vus.get(cle, 0) + 1
            x["id_externe"] = f"ia-{cle[0].isoformat()}-{cle[1]}-{vus[cle]}"
    remplacer = None
    if payload.remplacer_semaines:
        lundis = [x["jour"] - timedelta(days=x["jour"].weekday()) for x in items]
        remplacer = (min(lundis), max(lundis) + timedelta(days=6))
    try:
        bilan = cs.enregistrer_plan(db, current_user.id, items, remplacer=remplacer)
    except ValueError as e:
        raise HTTPException(400, str(e))
    db.commit()
    return {"ok": True, **bilan}


class AdapterSchema(BaseModel):
    action: str = Field(..., pattern="^(alleger|decaler|sauter)$")


@router.post("/api/plan/{prevue_id}/adapter", summary="Allège, décale ou saute une séance (forme du matin)")
def adapter_prevue(
    prevue_id: int,
    payload: AdapterSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    import corps_service as co
    import suivi_service as sv
    p = _prevue(db, current_user, prevue_id)
    if p.activite_id or (cs.lire_deroule(p) or {}).get("fin"):
        raise HTTPException(400, "Séance déjà réalisée")
    message = co.adapter_seance(db, p, payload.action, sv.aujourdhui(current_user))
    db.commit()
    db.refresh(p)
    return {"message": message, "seance": _une(db, p)}


@router.patch("/api/plan/{prevue_id}", summary="Statut (sautée), commentaire ou rattachement à une activité")
def modifier_prevue(
    prevue_id: int,
    payload: MajPrevueSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    p = _prevue(db, current_user, prevue_id)
    champs = payload.model_fields_set
    contenu = champs & set(CHAMPS_CONTENU)
    if contenu:
        if _realisee(p):
            raise HTTPException(400, "Une séance déjà réalisée ne se modifie plus")
        if "titre" in contenu and not (payload.titre or "").strip():
            raise HTTPException(400, "Le titre est obligatoire")
        structure = None
        if "structure" in contenu:
            try:
                structure = bl.valider_structure(payload.structure)
            except ValueError as e:
                raise HTTPException(400, str(e))
        if "sport" in contenu and payload.sport:
            sport = cs.normaliser_sport(payload.sport)
            if cs.famille_sport(sport) != cs.famille_sport(p.sport) and p.activite_id and not p.lien_manuel:
                p.activite_id = None  # rapprochement automatique fait pour l'ancien sport
            p.sport = sport
        for k in ("titre", "description", "duree_min", "distance_km", "dplus_m", "rpe_cible"):
            if k in contenu:
                v = getattr(payload, k)
                if isinstance(v, str):
                    v = v.strip() or None
                if k == "titre":
                    v = v[:200]
                if k == "description" and v != p.description and "structure" not in contenu:
                    p.structure = None  # texte réécrit à la main : les blocs ne le décrivent plus
                setattr(p, k, v)
        if "structure" in contenu:
            p.structure = structure
    if "statut" in champs and payload.statut:
        p.statut = payload.statut
    if "commentaire" in champs:
        p.commentaire = (payload.commentaire or "").strip() or None
    if payload.jour:
        try:
            pe.deplacer_prevue(db, current_user, p, payload.jour)
        except ValueError as e:
            raise HTTPException(400, str(e))
    if "deroule" in champs:
        brut = json.dumps(payload.deroule, ensure_ascii=False) if payload.deroule else None
        if brut and len(brut) > 50_000:
            raise HTTPException(400, "Déroulé de séance trop long")
        p.deroule = brut
    if payload.delier:
        p.activite_id, p.lien_manuel = None, True
    elif payload.activite_id is not None:
        a = db.query(Activite).filter(Activite.id == payload.activite_id,
                                      Activite.utilisateur_id == current_user.id).first()
        if not a:
            raise HTTPException(400, "Activité inconnue")
        db.query(SeancePrevue).filter(SeancePrevue.utilisateur_id == current_user.id,
                                      SeancePrevue.activite_id == a.id,
                                      SeancePrevue.id != p.id).update({SeancePrevue.activite_id: None})
        p.activite_id, p.lien_manuel, p.statut = a.id, True, "prevue"
        if (p.titre or "").strip():
            a.titre = p.titre.strip()  # le carnet reprend le nom de la séance prévue
        if cs.famille_sport(a.sport) != cs.famille_sport(p.sport):
            a.sport = p.sport  # et son sport (ex. « Autre » rattachée à une séance de muscu)
    db.commit()
    db.refresh(p)
    return _une(db, p)


@router.get("/api/plan/{prevue_id}/activites", summary="Activités de la semaine de la séance, pour un rattachement manuel")
def activites_proches(
    prevue_id: int,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    p = _prevue(db, current_user, prevue_id)
    lundi = p.jour - timedelta(days=p.jour.weekday())
    debut = datetime.combine(lundi, datetime.min.time())
    fin = datetime.combine(lundi + timedelta(days=7), datetime.min.time())
    acts = (db.query(Activite)
            .filter(Activite.utilisateur_id == current_user.id, Activite.debut >= debut, Activite.debut < fin)
            .order_by(Activite.debut).all())
    fam = cs.famille_sport(p.sport)
    acts.sort(key=lambda a: (cs.famille_sport(a.sport) != fam, a.debut))
    return [cs.serialiser_activite(a) for a in acts]


@router.get("/api/pictogrammes", summary="Pictogrammes des exercices de muscu (séance guidée)")
def lister_pictogrammes(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    return {"pictogrammes": pg.catalogue(db, current_user.id), "generique": pg.GENERIQUE}


@router.get("/api/animations", summary="Animations 3D des exercices de muscu (séance guidée)")
def lister_animations(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    return an.catalogue(db, current_user.id)


@router.delete("/api/plan/{prevue_id}", summary="Supprime une séance prévue")
def supprimer_prevue(
    prevue_id: int,
    suite: bool = Query(False, description="Séance répétée : supprime aussi les suivantes de la série (pas encore faites)"),
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    p = _prevue(db, current_user, prevue_id)
    cibles = [p]
    ide = p.id_externe or ""
    if suite and ide.startswith("rec-") and ide.count("-") == 2:
        prefixe = ide.rsplit("-", 1)[0] + "-"
        cibles += [q for q in db.query(SeancePrevue).filter(
            SeancePrevue.utilisateur_id == current_user.id, SeancePrevue.id != p.id,
            SeancePrevue.id_externe.like(prefixe + "%"), SeancePrevue.jour > p.jour).all()
            if not _realisee(q) and not q.commentaire]
    for q in cibles:
        if q.envoi_montre:
            _retirer_de_la_montre(current_user, q)
        db.delete(q)
    db.commit()
    return {"ok": True, "supprimees": len(cibles)}


# ---------------------------------------------------------------------------
# Envoi sur la montre (calendrier Intervals.icu → Garmin, Coros, Suunto, Apple Watch…)
# ---------------------------------------------------------------------------

@router.post("/api/plan/{prevue_id}/montre", summary="Place la séance un jour donné et l'envoie sur la montre via Intervals.icu")
def envoyer_montre(
    prevue_id: int,
    payload: EnvoiMontreSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    import suivi_service as sv
    p = _prevue(db, current_user, prevue_id)
    if not current_user.intervals_cle:
        raise HTTPException(409, "Connecte d'abord Intervals.icu (Sources) pour envoyer des séances sur ta montre")
    if _realisee(p):
        raise HTTPException(400, "Séance déjà réalisée")
    auj = sv.aujourdhui(current_user)
    lundi = p.jour - timedelta(days=p.jour.weekday())
    if not (lundi <= payload.jour < lundi + timedelta(days=7)):
        raise HTTPException(400, "Choisis un jour de la semaine de la séance")
    if payload.jour < auj:
        raise HTTPException(400, "Choisis aujourd'hui ou un jour à venir")
    deps.limiter(f"montre:{current_user.id}", 30, 3600)
    ancien = bl.lire_structure(p.envoi_montre) or {}
    try:
        pe.deplacer_prevue(db, current_user, p, payload.jour)
        event_id = iv.envoyer_seance(current_user, bl.evenement(p, payload.jour, bl.lire_structure(p.structure)),
                                     ancien.get("event_id"))
    except ValueError as e:
        db.rollback()
        raise HTTPException(400, str(e))
    except iv.IntervalsErreur as e:
        db.rollback()
        raise HTTPException(502, str(e))
    p.envoi_montre = json.dumps({"event_id": event_id, "jour": payload.jour.isoformat(),
                                 "le": datetime.now().isoformat(timespec="seconds"), "empreinte": bl.empreinte(p)})
    db.commit()
    db.refresh(p)
    return _une(db, p)


@router.delete("/api/plan/{prevue_id}/montre", summary="Retire la séance de la montre (calendrier Intervals.icu)")
def retirer_montre(
    prevue_id: int,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    p = _prevue(db, current_user, prevue_id)
    e = bl.lire_structure(p.envoi_montre) or {}
    if e.get("event_id") and current_user.intervals_cle:
        try:
            iv.retirer_seance(current_user, e["event_id"])
        except iv.IntervalsErreur as err:
            raise HTTPException(502, str(err))
    p.envoi_montre = None
    db.commit()
    db.refresh(p)
    return _une(db, p)


# ---------------------------------------------------------------------------
# Mes modèles de séance
# ---------------------------------------------------------------------------

def _modele(m: ModeleSeance) -> dict:
    return {"id": m.id, "nom": m.nom, "sport": m.sport, "titre": m.titre, "description": m.description,
            "duree_min": m.duree_min, "distance_km": m.distance_km, "dplus_m": m.dplus_m,
            "rpe_cible": m.rpe_cible, "structure": bl.lire_structure(m.structure)}


@router.get("/api/modeles", summary="Mes modèles de séance")
def lister_modeles(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    ms = (db.query(ModeleSeance).filter(ModeleSeance.utilisateur_id == current_user.id)
          .order_by(ModeleSeance.nom, ModeleSeance.id).all())
    return [_modele(m) for m in ms]


@router.post("/api/modeles", summary="Enregistre une séance comme modèle")
def creer_modele(payload: ModeleSchema, current_user: Utilisateur = Depends(get_current_user),
                 db: Session = Depends(obtenir_session)):
    if db.query(ModeleSeance).filter(ModeleSeance.utilisateur_id == current_user.id).count() >= MAX_MODELES:
        raise HTTPException(400, f"{MAX_MODELES} modèles au maximum : supprimes-en un d'abord")
    try:
        structure = bl.valider_structure(payload.structure)
    except ValueError as e:
        raise HTTPException(400, str(e))
    d = payload.model_dump(exclude={"structure"})
    d["sport"] = cs.normaliser_sport(d["sport"])
    d["nom"], d["titre"] = d["nom"].strip(), d["titre"].strip()
    if not d["nom"] or not d["titre"]:
        raise HTTPException(400, "Nom et titre obligatoires")
    m = ModeleSeance(utilisateur_id=current_user.id, structure=structure, **d)
    db.add(m)
    db.commit()
    db.refresh(m)
    return _modele(m)


@router.delete("/api/modeles/{modele_id}", summary="Supprime un modèle de séance")
def supprimer_modele(modele_id: int, current_user: Utilisateur = Depends(get_current_user),
                     db: Session = Depends(obtenir_session)):
    m = db.query(ModeleSeance).filter(ModeleSeance.id == modele_id,
                                      ModeleSeance.utilisateur_id == current_user.id).first()
    if not m:
        raise HTTPException(404, "Modèle introuvable")
    db.delete(m)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Assistant « Mon IA crée mon plan » : les réponses de l'utilisateur
# ---------------------------------------------------------------------------

JOURS_IA = ("lun", "mar", "mer", "jeu", "ven", "sam", "dim")
IAS_ASSISTANT = ("claude", "chatgpt", "gemini", "lechat", "copilot", "autre")
REGLAGES_IA_DEFAUT = {"ia": "claude", "autre_ia": "", "objectif": "", "sports": [],
                      "dispos": {j: 0 for j in JOURS_IA}, "contraintes": "", "niveau": "semi"}


class ReglagesIaSchema(BaseModel):
    ia: str = Field("claude", pattern="^(claude|chatgpt|gemini|lechat|copilot|autre)$")
    autre_ia: str = Field("", max_length=40)
    objectif: str = Field("", max_length=600)
    sports: list[str] = Field(default_factory=list, max_length=12)
    dispos: dict[str, StrictInt] = Field(default_factory=dict)   # minutes disponibles par jour, 0 = pas de séance
    contraintes: str = Field("", max_length=1500)
    niveau: str = Field("semi", pattern="^(semi|auto)$")


def _reglages_ia(user: Utilisateur) -> dict:
    try:
        lu = json.loads(user.reglages_ia) if user.reglages_ia else {}
    except ValueError:
        lu = {}
    if not isinstance(lu, dict):
        lu = {}
    # relecture défensive : une valeur mal formée en base retombe sur le défaut, jamais sur une erreur
    res = dict(REGLAGES_IA_DEFAUT)
    for k in ("autre_ia", "objectif", "contraintes"):
        if isinstance(lu.get(k), str):
            res[k] = lu[k]
    if lu.get("ia") in IAS_ASSISTANT:
        res["ia"] = lu["ia"]
    if lu.get("niveau") in ("semi", "auto"):
        res["niveau"] = lu["niveau"]
    sports = lu.get("sports") if isinstance(lu.get("sports"), list) else []
    res["sports"] = [s for s in sports if isinstance(s, str) and s in cs.SPORTS]
    dispos = lu.get("dispos") if isinstance(lu.get("dispos"), dict) else {}
    res["dispos"] = {j: (v if type(v) is int and 0 <= v <= 600 else 0)
                     for j in JOURS_IA for v in [dispos.get(j)]}
    return {**res, "rempli": bool(user.reglages_ia)}


@router.get("/api/assistant-ia", summary="Réponses enregistrées de l'assistant « Mon IA crée mon plan »")
def lire_reglages_ia(current_user: Utilisateur = Depends(get_current_user)):
    return _reglages_ia(current_user)


@router.put("/api/assistant-ia", summary="Enregistre les réponses de l'assistant « Mon IA crée mon plan »")
def enregistrer_reglages_ia(
    payload: ReglagesIaSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    if any(j not in JOURS_IA for j in payload.dispos):
        raise HTTPException(400, "Jour inconnu dans les disponibilités")
    if any(not 0 <= m <= 600 for m in payload.dispos.values()):
        raise HTTPException(400, "Durée disponible hors limites (0 à 600 min)")
    sports = []
    for s in payload.sports:
        s = cs.normaliser_sport(s)
        if s not in sports:
            sports.append(s)
    current_user.reglages_ia = json.dumps({
        "ia": payload.ia, "autre_ia": payload.autre_ia.strip(), "objectif": payload.objectif.strip(),
        "sports": sports, "dispos": {j: payload.dispos.get(j, 0) for j in JOURS_IA},
        "contraintes": payload.contraintes.strip(), "niveau": payload.niveau,
    }, ensure_ascii=False)
    db.commit()
    return _reglages_ia(current_user)


@router.get("/api/claude/token", summary="Retourne (et génère si besoin) le token Claude")
def get_claude_token(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    if not current_user.claude_token:
        current_user.claude_token = _secrets.token_urlsafe(32)
        db.commit()
    return {"claude_token": current_user.claude_token}


@router.post("/api/claude/token/regenerer", summary="Régénère le token Claude (invalide l'ancien)")
def regenerer_claude_token(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    current_user.claude_token = _secrets.token_urlsafe(32)
    db.commit()
    return {"claude_token": current_user.claude_token}


# ---------------------------------------------------------------------------
# Claude (en-tête X-Carnet-Token)
# ---------------------------------------------------------------------------

def utilisateur_claude(
    x_carnet_token: Optional[str] = Header(None),
    db: Session = Depends(obtenir_session),
) -> Utilisateur:
    if not x_carnet_token or len(x_carnet_token) < 20:
        raise HTTPException(401, "Token Claude manquant")
    user = db.query(Utilisateur).filter(Utilisateur.claude_token == x_carnet_token).first()
    if not user:
        raise HTTPException(401, "Token Claude invalide")
    return user


@router.get("/api/claude/export", summary="Export complet du carnet (md | json | csv) — token Claude")
def claude_export(
    format: str = Query("md", pattern="^(md|json|csv)$"),
    user: Utilisateur = Depends(utilisateur_claude),
    db: Session = Depends(obtenir_session),
):
    res = _reponse_export(db, user, format)
    db.commit()
    return res


@router.get("/api/claude/plan", summary="Plan d'une période — token Claude")
def claude_plan(
    depuis: Optional[date] = None,
    jusqu_a: Optional[date] = None,
    user: Utilisateur = Depends(utilisateur_claude),
    db: Session = Depends(obtenir_session),
):
    d, f = _periode(depuis, jusqu_a)
    res = cs.lister_plan(db, user.id, d, f)
    db.commit()
    return {"depuis": d.isoformat(), "jusqu_a": f.isoformat(), "seances": res}


@router.post("/api/claude/plan", summary="Envoie des séances prévues (création / mise à jour par id_externe) — token Claude")
def claude_envoyer_plan(
    payload: EnvoiPlanSchema,
    user: Utilisateur = Depends(utilisateur_claude),
    db: Session = Depends(obtenir_session),
):
    if payload.remplacer and payload.remplacer.jusqu_a < payload.remplacer.depuis:
        raise HTTPException(400, "Période de remplacement invalide")
    try:
        pictos = pg.enregistrer(db, user.id, payload.pictogrammes)
        anims = an.enregistrer(db, user.id, payload.animations)
    except ValueError as e:
        raise HTTPException(400, str(e))
    try:
        bilan = cs.enregistrer_plan(
            db, user.id, _items(db, user, payload.seances),
            remplacer=(payload.remplacer.depuis, payload.remplacer.jusqu_a) if payload.remplacer else None,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    descriptions = [x.description for x in payload.seances]
    manquants, approchants = pg.a_verifier(db, user.id, descriptions)
    anims_manquantes, anims_approchantes = an.a_verifier(db, user.id, descriptions)
    db.commit()
    return {"ok": True, **bilan, "pictogrammes": pictos,
            "pictogrammes_manquants": manquants, "pictogrammes_approchants": approchants,
            "animations": anims, "animations_manquantes": anims_manquantes,
            "animations_approchantes": anims_approchantes}


@router.get("/api/claude/pictogrammes", summary="Catalogue des pictogrammes d'exercices — token Claude")
def claude_pictogrammes(user: Utilisateur = Depends(utilisateur_claude), db: Session = Depends(obtenir_session)):
    return pg.catalogue(db, user.id)


@router.get("/api/claude/animations", summary="Catalogue des animations 3D d'exercices — token Claude")
def claude_animations(user: Utilisateur = Depends(utilisateur_claude), db: Session = Depends(obtenir_session)):
    return an.catalogue(db, user.id)


@router.delete("/api/claude/plan/{id_externe}", summary="Supprime une séance prévue par id_externe — token Claude")
def claude_supprimer(
    id_externe: str,
    user: Utilisateur = Depends(utilisateur_claude),
    db: Session = Depends(obtenir_session),
):
    p = db.query(SeancePrevue).filter(SeancePrevue.utilisateur_id == user.id,
                                      SeancePrevue.id_externe == id_externe).first()
    if not p:
        raise HTTPException(404, "Séance prévue introuvable")
    if cs.est_protegee(p):
        # même règle que « remplacer » : le jeton ne retire ni l'historique ni ce que l'athlète a ajouté
        raise HTTPException(409, "Séance réalisée, sautée, commentée ou ajoutée par l'athlète : "
                                 "elle se retire depuis l'onglet Plan")
    db.delete(p)
    db.commit()
    return {"ok": True}
