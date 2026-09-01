"""Routes du domaine chat coach : conversation avec l'agent Claude, outillé pour
lire/écrire directement dans le programme et le journal de l'utilisateur courant.

Toute action de l'agent passe par des outils (tool use) exécutés côté serveur et
strictement scopés à `current_user.id` — l'agent ne peut jamais lire ou modifier
les données d'un autre utilisateur.
"""

from __future__ import annotations

import logging
import os
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import obtenir_session
from deps import get_current_user, _obtenir_seance_utilisateur
from models import (
    JournalSeance,
    Macrocycle,
    MessageChatCoach,
    ObjectifCourse,
    SeanceEntrainement,
    SemaineEntrainement,
    TypeMacrophase,
    TypeSeance,
    Utilisateur,
    ZoneCourse,
)

logger = logging.getLogger(__name__)

router = APIRouter()

_ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
_MAX_TOOL_ITERATIONS = 8
_MAX_HISTORIQUE_MESSAGES = 40  # nombre de messages passés rechargés dans le contexte

_SYSTEM_PROMPT = """Tu es le coach d'entraînement personnel de l'utilisateur, spécialisé en préparation hybride course à pied / musculation au poids du corps (méthode EPC).

Tu l'aides à :
- planifier ses séances semaine par semaine (course, EMOM, AMRAP, décharge, repos...),
- enregistrer ses retours après une séance (ressenti RPE, performance réelle : distance, durée, dénivelé, fréquence cardiaque...),
- consulter et mettre à jour son objectif de course.

Règles :
- Utilise TOUJOURS les outils fournis pour lire ou modifier ses données — ne suppose jamais l'état de son programme sans le vérifier via l'outil de listing.
- Réponds en français, de façon concise et concrète.
- Quand tu proposes une séance, précise la date, le type et les cibles (durée/distance/dénivelé ou zone).
- Demande confirmation avant de supprimer une séance.
- La date du jour t'est donnée dans chaque message système d'outil si besoin ; sinon calcule à partir du contexte de la conversation.
"""


# ---------------------------------------------------------------------------
# Aide : trouver (ou créer à défaut) la semaine d'entraînement d'une date
# ---------------------------------------------------------------------------

def _lundi_de(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _trouver_ou_creer_semaine(db: Session, user: Utilisateur, date_cible: date) -> SemaineEntrainement:
    """Retourne la SemaineEntrainement couvrant `date_cible` pour cet utilisateur.
    Si aucun programme existant ne couvre cette date (ex. planification loin dans
    le futur), crée un macrocycle + une semaine ad-hoc pour l'accueillir."""
    semaine = (
        db.query(SemaineEntrainement)
        .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
        .filter(
            Macrocycle.utilisateur_id == user.id,
            SemaineEntrainement.date_debut <= date_cible,
            SemaineEntrainement.date_debut + timedelta(days=7) > date_cible,
        )
        .first()
    )
    if semaine:
        return semaine

    lundi = _lundi_de(date_cible)
    dernier_cycle = (
        db.query(Macrocycle)
        .filter(Macrocycle.utilisateur_id == user.id)
        .order_by(Macrocycle.numero_cycle.desc())
        .first()
    )
    numero_cycle = (dernier_cycle.numero_cycle + 1) if dernier_cycle else 1

    macrocycle = Macrocycle(
        utilisateur_id=user.id,
        numero_cycle=numero_cycle,
        date_debut=lundi,
        date_fin=lundi + timedelta(days=6),
        notes="Créé automatiquement par le coach IA (date hors programme existant).",
    )
    db.add(macrocycle)
    db.flush()

    semaine = SemaineEntrainement(
        macrocycle_id=macrocycle.id,
        numero_semaine=1,
        macrophase=TypeMacrophase.SURCHARGE,
        date_debut=lundi,
    )
    db.add(semaine)
    db.flush()
    return semaine


def _conseil_recuperation(rpe: float) -> dict:
    r = int(round(rpe))
    if r <= 4:
        return {"niveau": "facile", "conseil": "Belle séance légère ! Hydratation normale et 7-8h de sommeil suffisent."}
    elif r <= 6:
        return {"niveau": "modere", "conseil": "Étirements 10 min ce soir. Dors 8h et bois au moins 2L d'eau."}
    elif r <= 8:
        return {"niveau": "intense", "conseil": "Protéines dans les 30 min (20-30 g). Étirements + foam roller. Vise 8-9h de sommeil."}
    elif r == 9:
        return {"niveau": "tres_intense", "conseil": "Repos actif ou complet demain. Jambes surélevées 15 min. Minimum 9h de sommeil."}
    else:
        return {"niveau": "depassement", "conseil": "2 jours de repos minimum. Alimentation anti-inflammatoire. Consulte un médecin si douleurs persistantes."}


def _seance_en_dict(s: SeanceEntrainement) -> dict:
    j = s.journal
    return {
        "id": s.id,
        "date": str(s.date_seance),
        "date_planifiee": str(s.date_planifiee) if s.date_planifiee else None,
        "heure_planifiee": s.heure_planifiee,
        "type": s.type_seance.value,
        "titre": s.titre,
        "description": s.description,
        "zone_cible": s.zone_cible.value if s.zone_cible else None,
        "distance_cible_km": s.distance_cible_km,
        "duree_cible_min": s.duree_cible_min,
        "dplus_cible_m": s.dplus_cible_m,
        "temps_limite_min": s.temps_limite_min,
        "completee": bool(j and j.completee),
        "rpe": j.rpe if j else None,
        "notes_retour": j.notes if j else None,
        "distance_reelle_km": j.distance_reelle_km if j else None,
        "duree_reelle_min": j.duree_reelle_min if j else None,
        "dplus_reel_m": j.dplus_reel_m if j else None,
    }


# ---------------------------------------------------------------------------
# Définition des outils (tool use) exposés au modèle
# ---------------------------------------------------------------------------

_TOOLS = [
    {
        "name": "lister_seances",
        "description": "Liste les séances planifiées de l'utilisateur sur une plage de dates, avec leur statut (complétée ou non) et le retour éventuel (RPE, perfs réelles).",
        "input_schema": {
            "type": "object",
            "properties": {
                "date_debut": {"type": "string", "description": "Date de début, format YYYY-MM-DD"},
                "date_fin": {"type": "string", "description": "Date de fin (incluse), format YYYY-MM-DD"},
            },
            "required": ["date_debut", "date_fin"],
        },
    },
    {
        "name": "planifier_seance",
        "description": "Crée une nouvelle séance planifiée à une date donnée. Trouve automatiquement (ou crée) la semaine de programme correspondante.",
        "input_schema": {
            "type": "object",
            "properties": {
                "date_seance": {"type": "string", "description": "Date de la séance, format YYYY-MM-DD"},
                "type_seance": {"type": "string", "enum": [t.value for t in TypeSeance]},
                "titre": {"type": "string"},
                "description": {"type": "string"},
                "heure_planifiee": {"type": "string", "description": "Heure au format HH:MM (optionnel)"},
                "zone_cible": {"type": "string", "enum": [z.value for z in ZoneCourse], "description": "Zone d'intensité course (optionnel)"},
                "distance_cible_km": {"type": "number"},
                "duree_cible_min": {"type": "integer"},
                "dplus_cible_m": {"type": "integer"},
                "temps_limite_min": {"type": "integer", "description": "Durée limite pour un AMRAP/EMOM (minutes)"},
            },
            "required": ["date_seance", "type_seance", "titre"],
        },
    },
    {
        "name": "modifier_seance",
        "description": "Modifie une séance existante appartenant à l'utilisateur (tous les champs sont optionnels sauf seance_id).",
        "input_schema": {
            "type": "object",
            "properties": {
                "seance_id": {"type": "integer"},
                "date_seance": {"type": "string", "description": "Format YYYY-MM-DD"},
                "type_seance": {"type": "string", "enum": [t.value for t in TypeSeance]},
                "titre": {"type": "string"},
                "description": {"type": "string"},
                "heure_planifiee": {"type": "string"},
                "zone_cible": {"type": "string", "enum": [z.value for z in ZoneCourse]},
                "distance_cible_km": {"type": "number"},
                "duree_cible_min": {"type": "integer"},
                "dplus_cible_m": {"type": "integer"},
                "temps_limite_min": {"type": "integer"},
            },
            "required": ["seance_id"],
        },
    },
    {
        "name": "supprimer_seance",
        "description": "Supprime définitivement une séance (et son journal éventuel). Demande toujours confirmation à l'utilisateur avant d'appeler cet outil.",
        "input_schema": {
            "type": "object",
            "properties": {"seance_id": {"type": "integer"}},
            "required": ["seance_id"],
        },
    },
    {
        "name": "enregistrer_retour_seance",
        "description": "Enregistre le ressenti et la performance réelle d'une séance (RPE, distance/durée/dénivelé réels, FC...). Crée le journal s'il n'existe pas encore, sinon le met à jour. Marque la séance comme complétée.",
        "input_schema": {
            "type": "object",
            "properties": {
                "seance_id": {"type": "integer"},
                "rpe": {"type": "number", "description": "Effort perçu, échelle de Borg CR10, de 1 à 10"},
                "notes": {"type": "string", "description": "Ressenti libre de l'utilisateur"},
                "distance_reelle_km": {"type": "number"},
                "duree_reelle_min": {"type": "integer"},
                "dplus_reel_m": {"type": "integer"},
                "fc_moyenne_bpm": {"type": "integer"},
                "fc_max_bpm": {"type": "integer"},
                "tours_amrap_completes": {"type": "number", "description": "Ex. 2.9 = 2 tours complets + 9 reps dans le 3e"},
            },
            "required": ["seance_id"],
        },
    },
    {
        "name": "get_objectif_course",
        "description": "Récupère le prochain objectif de course de l'utilisateur (nom, date, distance, temps visé, allures cibles).",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "set_objectif_course",
        "description": "Enregistre ou remplace le prochain objectif de course de l'utilisateur.",
        "input_schema": {
            "type": "object",
            "properties": {
                "nom": {"type": "string"},
                "date_course": {"type": "string", "description": "Format YYYY-MM-DD"},
                "distance_km": {"type": "number"},
                "dplus_m": {"type": "integer"},
                "objectif_temps_min": {"type": "integer", "description": "Temps visé, en minutes"},
                "notes": {"type": "string"},
            },
            "required": ["nom", "date_course", "distance_km", "objectif_temps_min"],
        },
    },
]


# ---------------------------------------------------------------------------
# Exécution des outils — chaque fonction est scopée à (db, current_user)
# ---------------------------------------------------------------------------

def _exec_lister_seances(db: Session, user: Utilisateur, args: dict) -> dict:
    try:
        d1 = date.fromisoformat(args["date_debut"])
        d2 = date.fromisoformat(args["date_fin"])
    except (KeyError, ValueError):
        return {"erreur": "Dates invalides — attendu YYYY-MM-DD"}

    seances = (
        db.query(SeanceEntrainement)
        .join(SemaineEntrainement, SeanceEntrainement.semaine_id == SemaineEntrainement.id)
        .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
        .filter(
            Macrocycle.utilisateur_id == user.id,
            SeanceEntrainement.date_seance >= d1,
            SeanceEntrainement.date_seance <= d2,
        )
        .order_by(SeanceEntrainement.date_seance)
        .all()
    )
    return {"seances": [_seance_en_dict(s) for s in seances]}


def _exec_planifier_seance(db: Session, user: Utilisateur, args: dict) -> dict:
    try:
        date_seance = date.fromisoformat(args["date_seance"])
    except (KeyError, ValueError):
        return {"erreur": "date_seance invalide — attendu YYYY-MM-DD"}
    try:
        type_seance = TypeSeance(args["type_seance"])
    except (KeyError, ValueError):
        return {"erreur": f"type_seance invalide : {args.get('type_seance')}"}

    zone = None
    if args.get("zone_cible"):
        try:
            zone = ZoneCourse(args["zone_cible"])
        except ValueError:
            return {"erreur": f"zone_cible invalide : {args.get('zone_cible')}"}

    semaine = _trouver_ou_creer_semaine(db, user, date_seance)
    nb_existantes = db.query(SeanceEntrainement).filter(SeanceEntrainement.semaine_id == semaine.id).count()

    seance = SeanceEntrainement(
        semaine_id=semaine.id,
        date_seance=date_seance,
        type_seance=type_seance,
        titre=args.get("titre") or type_seance.value,
        description=args.get("description"),
        ordre_dans_semaine=nb_existantes + 1,
        zone_cible=zone,
        distance_cible_km=args.get("distance_cible_km"),
        duree_cible_min=args.get("duree_cible_min"),
        dplus_cible_m=args.get("dplus_cible_m"),
        temps_limite_min=args.get("temps_limite_min"),
        date_planifiee=date_seance,
        heure_planifiee=args.get("heure_planifiee") or None,
    )
    db.add(seance)
    db.commit()
    db.refresh(seance)
    return {"ok": True, "seance": _seance_en_dict(seance)}


def _exec_modifier_seance(db: Session, user: Utilisateur, args: dict) -> dict:
    try:
        seance = _obtenir_seance_utilisateur(db, int(args["seance_id"]), user)
    except HTTPException as exc:
        return {"erreur": exc.detail}
    except (KeyError, ValueError):
        return {"erreur": "seance_id manquant ou invalide"}

    if args.get("type_seance") is not None:
        try:
            seance.type_seance = TypeSeance(args["type_seance"])
        except ValueError:
            return {"erreur": f"type_seance invalide : {args['type_seance']}"}

    if args.get("date_seance") is not None:
        try:
            d = date.fromisoformat(args["date_seance"])
        except ValueError:
            return {"erreur": "date_seance invalide — attendu YYYY-MM-DD"}
        seance.date_seance = d
        seance.date_planifiee = d

    if args.get("zone_cible") is not None:
        try:
            seance.zone_cible = ZoneCourse(args["zone_cible"]) if args["zone_cible"] else None
        except ValueError:
            return {"erreur": f"zone_cible invalide : {args['zone_cible']}"}

    if args.get("titre") is not None: seance.titre = args["titre"]
    if args.get("description") is not None: seance.description = args["description"]
    if args.get("heure_planifiee") is not None: seance.heure_planifiee = args["heure_planifiee"] or None
    if args.get("distance_cible_km") is not None: seance.distance_cible_km = args["distance_cible_km"]
    if args.get("duree_cible_min") is not None: seance.duree_cible_min = args["duree_cible_min"]
    if args.get("dplus_cible_m") is not None: seance.dplus_cible_m = args["dplus_cible_m"]
    if args.get("temps_limite_min") is not None: seance.temps_limite_min = args["temps_limite_min"]

    db.commit()
    db.refresh(seance)
    return {"ok": True, "seance": _seance_en_dict(seance)}


def _exec_supprimer_seance(db: Session, user: Utilisateur, args: dict) -> dict:
    try:
        seance = _obtenir_seance_utilisateur(db, int(args["seance_id"]), user)
    except HTTPException as exc:
        return {"erreur": exc.detail}
    except (KeyError, ValueError):
        return {"erreur": "seance_id manquant ou invalide"}

    db.query(JournalSeance).filter(JournalSeance.seance_id == seance.id).delete(synchronize_session=False)
    db.delete(seance)
    db.commit()
    return {"ok": True}


def _exec_enregistrer_retour_seance(db: Session, user: Utilisateur, args: dict) -> dict:
    try:
        seance = _obtenir_seance_utilisateur(db, int(args["seance_id"]), user)
    except HTTPException as exc:
        return {"erreur": exc.detail}
    except (KeyError, ValueError):
        return {"erreur": "seance_id manquant ou invalide"}

    champs = (
        "rpe", "notes", "distance_reelle_km", "duree_reelle_min",
        "dplus_reel_m", "fc_moyenne_bpm", "fc_max_bpm", "tours_amrap_completes",
    )
    if seance.journal:
        j = seance.journal
        for c in champs:
            if args.get(c) is not None:
                setattr(j, c, args[c])
        j.completee = True
    else:
        j = JournalSeance(
            utilisateur_id=user.id,
            seance_id=seance.id,
            completee=True,
            **{c: args.get(c) for c in champs},
        )
        db.add(j)
    db.commit()

    conseil = _conseil_recuperation(j.rpe) if j.rpe else None
    return {"ok": True, "conseil_recuperation": conseil}


def _exec_get_objectif_course(db: Session, user: Utilisateur, args: dict) -> dict:
    obj = (
        db.query(ObjectifCourse)
        .filter(ObjectifCourse.utilisateur_id == user.id)
        .order_by(ObjectifCourse.cree_le.desc())
        .first()
    )
    if not obj:
        return {"objectif": None}
    return {
        "objectif": {
            "nom": obj.nom,
            "date_course": str(obj.date_course),
            "distance_km": obj.distance_km,
            "dplus_m": obj.dplus_m,
            "objectif_temps_min": obj.objectif_temps_min,
            "jours_restants": (obj.date_course - date.today()).days,
            "notes": obj.notes,
        }
    }


def _exec_set_objectif_course(db: Session, user: Utilisateur, args: dict) -> dict:
    try:
        date_course = date.fromisoformat(args["date_course"])
    except (KeyError, ValueError):
        return {"erreur": "date_course invalide — attendu YYYY-MM-DD"}

    db.query(ObjectifCourse).filter(ObjectifCourse.utilisateur_id == user.id).delete()
    obj = ObjectifCourse(
        utilisateur_id=user.id,
        nom=args["nom"],
        date_course=date_course,
        distance_km=args["distance_km"],
        dplus_m=args.get("dplus_m") or 0,
        objectif_temps_min=args["objectif_temps_min"],
        notes=args.get("notes"),
    )
    db.add(obj)
    db.commit()
    return {"ok": True}


_TOOL_HANDLERS = {
    "lister_seances": _exec_lister_seances,
    "planifier_seance": _exec_planifier_seance,
    "modifier_seance": _exec_modifier_seance,
    "supprimer_seance": _exec_supprimer_seance,
    "enregistrer_retour_seance": _exec_enregistrer_retour_seance,
    "get_objectif_course": _exec_get_objectif_course,
    "set_objectif_course": _exec_set_objectif_course,
}


def _executer_outil(db: Session, user: Utilisateur, nom: str, args: dict) -> dict:
    handler = _TOOL_HANDLERS.get(nom)
    if not handler:
        return {"erreur": f"Outil inconnu : {nom}"}
    try:
        return handler(db, user, args or {})
    except Exception:
        db.rollback()
        logger.exception("Erreur lors de l'exécution de l'outil %s", nom)
        return {"erreur": "Erreur serveur lors de l'exécution de l'outil"}


# ---------------------------------------------------------------------------
# Client Anthropic
# ---------------------------------------------------------------------------

def _client_anthropic():
    cle = os.getenv("ANTHROPIC_API_KEY")
    if not cle:
        raise HTTPException(
            503,
            "Le coach IA n'est pas configuré — ANTHROPIC_API_KEY est manquant côté serveur.",
        )
    import anthropic
    return anthropic.Anthropic(api_key=cle)


def _executer_conversation(db: Session, user: Utilisateur, messages: list[dict]) -> str:
    client = _client_anthropic()
    system = _SYSTEM_PROMPT + f"\n\nDate du jour : {date.today().isoformat()}."

    for _ in range(_MAX_TOOL_ITERATIONS):
        try:
            reponse = client.messages.create(
                model=_ANTHROPIC_MODEL,
                max_tokens=2048,
                system=system,
                tools=_TOOLS,
                messages=messages,
            )
        except Exception as exc:
            logger.exception("Erreur d'appel à l'API Anthropic")
            raise HTTPException(502, f"Erreur du coach IA : {exc}")

        if reponse.stop_reason != "tool_use":
            return "".join(bloc.text for bloc in reponse.content if bloc.type == "text").strip()

        messages.append({"role": "assistant", "content": reponse.content})

        resultats_outils = []
        for bloc in reponse.content:
            if bloc.type != "tool_use":
                continue
            resultat = _executer_outil(db, user, bloc.name, bloc.input)
            resultats_outils.append({
                "type": "tool_result",
                "tool_use_id": bloc.id,
                "content": json_dumps_safe(resultat),
            })
        messages.append({"role": "user", "content": resultats_outils})

    return "Désolé, je n'ai pas réussi à finaliser ma réponse — peux-tu reformuler ta demande ?"


def json_dumps_safe(obj: dict) -> str:
    import json
    return json.dumps(obj, ensure_ascii=False, default=str)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

class MessageChatSchema(BaseModel):
    message: str


@router.get("/api/chat/history", summary="Historique de conversation avec le coach IA")
def get_historique(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    messages = (
        db.query(MessageChatCoach)
        .filter(MessageChatCoach.utilisateur_id == current_user.id)
        .order_by(MessageChatCoach.cree_le)
        .all()
    )
    return {
        "messages": [
            {"id": m.id, "role": m.role, "contenu": m.contenu, "cree_le": str(m.cree_le)}
            for m in messages
        ]
    }


@router.post("/api/chat/message", summary="Envoie un message au coach IA et reçoit sa réponse")
def envoyer_message(
    payload: MessageChatSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    texte = payload.message.strip()
    if not texte:
        raise HTTPException(400, "Message vide")

    historique = (
        db.query(MessageChatCoach)
        .filter(MessageChatCoach.utilisateur_id == current_user.id)
        .order_by(MessageChatCoach.cree_le.desc())
        .limit(_MAX_HISTORIQUE_MESSAGES)
        .all()
    )
    historique.reverse()

    messages = [{"role": m.role, "content": m.contenu} for m in historique]
    messages.append({"role": "user", "content": texte})

    message_utilisateur = MessageChatCoach(utilisateur_id=current_user.id, role="user", contenu=texte)
    db.add(message_utilisateur)
    db.commit()

    reponse_texte = _executer_conversation(db, current_user, messages)

    message_assistant = MessageChatCoach(utilisateur_id=current_user.id, role="assistant", contenu=reponse_texte)
    db.add(message_assistant)
    db.commit()

    return {"reponse": reponse_texte}


@router.delete("/api/chat/history", summary="Efface l'historique de conversation avec le coach IA")
def supprimer_historique(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    db.query(MessageChatCoach).filter(MessageChatCoach.utilisateur_id == current_user.id).delete()
    db.commit()
    return {"ok": True}
