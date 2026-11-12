"""
Administration de la bêta fermée : codes d'invitation.

Réservé à l'administrateur (deps.est_admin). Aucune route ici ne lit les données
sportives des autres comptes.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import obtenir_session
from deps import get_admin
from models import Invitation, Utilisateur

router = APIRouter()

# Sans 0/O, 1/I/L : un code se dicte ou se recopie sans erreur
_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
MAX_ACTIVES = 50


class NouvelleInvitationSchema(BaseModel):
    note: Optional[str] = Field(None, max_length=80)
    jours: int = Field(14, ge=1, le=90)


def _code() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(8))


def _affiche(code: str) -> str:
    return f"{code[:4]}-{code[4:]}"


def _statut(inv: Invitation) -> str:
    if inv.utilisee_le:
        return "utilisee"
    if inv.revoquee:
        return "revoquee"
    if inv.expire_le < datetime.utcnow():
        return "expiree"
    return "active"


def _json(inv: Invitation, prenoms: dict[int, str]) -> dict:
    return {
        "id": inv.id,
        "code": _affiche(inv.code),
        "note": inv.note,
        "statut": _statut(inv),
        "cree_le": inv.cree_le.isoformat() + "Z",
        "expire_le": inv.expire_le.isoformat() + "Z",
        "utilisee_le": inv.utilisee_le.isoformat() + "Z" if inv.utilisee_le else None,
        # Seul le prénom du compte créé est montré : de quoi savoir qui a rejoint, rien de plus
        "utilisee_par": prenoms.get(inv.utilisee_par_id) if inv.utilisee_par_id else None,
    }


@router.get("/api/admin/invitations", summary="Liste des invitations (administrateur)")
def lister(admin: Utilisateur = Depends(get_admin), db: Session = Depends(obtenir_session)):
    invs = db.query(Invitation).order_by(Invitation.cree_le.desc()).limit(200).all()
    ids = {i.utilisee_par_id for i in invs if i.utilisee_par_id}
    prenoms = {u.id: u.prenom or "—" for u in db.query(Utilisateur).filter(Utilisateur.id.in_(ids))} if ids else {}
    return {"invitations": [_json(i, prenoms) for i in invs],
            "comptes": db.query(Utilisateur.id).count()}


@router.post("/api/admin/invitations", summary="Crée un code d'invitation à usage unique (administrateur)")
def creer(payload: NouvelleInvitationSchema, admin: Utilisateur = Depends(get_admin),
          db: Session = Depends(obtenir_session)):
    maintenant = datetime.utcnow()
    actives = db.query(Invitation).filter(Invitation.utilisee_le.is_(None), Invitation.revoquee.is_(False),
                                          Invitation.expire_le > maintenant).count()
    if actives >= MAX_ACTIVES:
        raise HTTPException(409, f"Déjà {MAX_ACTIVES} invitations en attente : révoque celles qui ne servent plus")
    code = _code()
    while db.query(Invitation.id).filter(Invitation.code == code).first():
        code = _code()
    inv = Invitation(code=code, note=(payload.note or "").strip() or None, cree_par_id=admin.id,
                     cree_le=maintenant, expire_le=maintenant + timedelta(days=payload.jours))
    db.add(inv)
    db.commit()
    return _json(inv, {})


@router.post("/api/admin/invitations/{invitation_id}/revoquer", summary="Révoque une invitation non utilisée (administrateur)")
def revoquer(invitation_id: int, admin: Utilisateur = Depends(get_admin), db: Session = Depends(obtenir_session)):
    inv = db.get(Invitation, invitation_id)
    if not inv:
        raise HTTPException(404, "Invitation introuvable")
    if inv.utilisee_le:
        raise HTTPException(409, "Invitation déjà utilisée")
    inv.revoquee = True
    db.commit()
    return _json(inv, {})
