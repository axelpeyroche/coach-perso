"""Routes du domaine admin : seed/reset de données, migration de compte."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import obtenir_session
from models import (
    BiometrieUtilisateur,
    JournalEvaluationSeance,
    JournalSeance,
    Macrocycle,
    ObjectifCourse,
    Utilisateur,
)
from deps import get_current_user, verifier_admin_token, _supprimer_ancien_programme

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/api/admin/seed-seances", summary="Génère toutes les séances des 16 semaines EPC (2 macrocycles)")
def seed_seances_route(db: Session = Depends(obtenir_session), _admin: None = Depends(verifier_admin_token)):
    from seed_seances import seed_module1, seed_module2, seed_module3
    try:
        seed_module1()
        seed_module2()
        seed_module3()
    except Exception:
        logger.exception("Erreur seed séances")
        raise HTTPException(status_code=500, detail="Erreur lors du seed des séances")
    return {"message": "Seed terminé."}


@router.post("/api/admin/init-macrocycles", summary="Crée les 2 macrocycles si absents (pour utilisateurs existants)")
def init_macrocycles(utilisateur_id: int = Query(1), db: Session = Depends(obtenir_session), _admin: None = Depends(verifier_admin_token)):
    from models import Utilisateur, SemaineEntrainement
    from periodization_rules import BLUEPRINT_MACROCYCLE, generer_dates_semaines

    user = db.query(Utilisateur).filter(Utilisateur.id == utilisateur_id).first()
    if not user:
        return {"erreur": f"Utilisateur {utilisateur_id} introuvable"}

    existants = {mc.numero_cycle for mc in db.query(Macrocycle).filter(Macrocycle.utilisateur_id == utilisateur_id).all()}
    crees = []
    debut_mc1 = date.today()
    debuts = {1: debut_mc1, 2: debut_mc1 + timedelta(weeks=8), 3: debut_mc1 + timedelta(weeks=16)}

    for numero_cycle in [1, 2, 3]:
        if numero_cycle in existants:
            continue
        debut = debuts[numero_cycle]
        mc = Macrocycle(
            utilisateur_id=user.id,
            numero_cycle=numero_cycle,
            date_debut=debut,
            date_fin=debut + timedelta(weeks=8),
        )
        db.add(mc)
        db.flush()
        for regle, date_sem in zip(BLUEPRINT_MACROCYCLE, generer_dates_semaines(debut)):
            db.add(SemaineEntrainement(
                macrocycle_id=mc.id,
                numero_semaine=regle.numero,
                macrophase=regle.macrophase,
                date_debut=date_sem,
                multiplicateur_volume=regle.multiplicateur_volume,
                objectif_km_course=regle.objectif_km_course,
                objectif_amrap_min=regle.objectif_amrap_min,
            ))
        crees.append(numero_cycle)

    db.commit()
    return {"macrocycles_crees": crees, "deja_existants": list(existants)}


@router.post("/api/admin/reseed", summary="Réinsère les exercices par défaut")
def reseed(db: Session = Depends(obtenir_session), _admin: None = Depends(verifier_admin_token)):
    from models import VariationExercice
    from periodization_rules import EXERCICES_DEFAUT
    existants = {e.slug for e in db.query(VariationExercice).all()}
    nouveaux = 0
    for data in EXERCICES_DEFAUT:
        if data["slug"] in existants:
            continue
        e = VariationExercice(
            nom=data["nom"], slug=data["slug"],
            categorie_musculaire=data["categorie_musculaire"],
            niveau_progression=data["niveau_progression"],
            tempo=data.get("tempo"),
            pause_isometrique_sec=data.get("pause_isometrique_sec"),
            muscles_principaux=data.get("muscles_principaux"),
            est_mouvement_evaluation=data.get("est_mouvement_evaluation", False),
        )
        db.add(e)
        nouveaux += 1
    db.commit()
    total = db.query(VariationExercice).count()
    return {"inseres": nouveaux, "total_en_base": total}


@router.post("/api/admin/reset-macrocycles", summary="Recrée les 3 macrocycles depuis la date indiquée")
def reset_macrocycles(
    utilisateur_id: int = Query(1),
    date_debut: Optional[str] = Query(None, description="Date début au format jj/mm/aaaa (défaut : lundi prochain)"),
    db: Session = Depends(obtenir_session),
    _admin: None = Depends(verifier_admin_token),
):
    from models import SemaineEntrainement
    from periodization_rules import BLUEPRINT_MACROCYCLE, generer_dates_semaines

    user = db.query(Utilisateur).filter(Utilisateur.id == utilisateur_id).first()
    if not user:
        raise HTTPException(404, f"Utilisateur {utilisateur_id} introuvable")

    # Calcul du lundi prochain si pas de date fournie
    if date_debut:
        try:
            debut_mc1 = datetime.strptime(date_debut, "%d/%m/%Y").date()
        except ValueError:
            raise HTTPException(400, "Format de date invalide — attendu jj/mm/aaaa")
    else:
        today = date.today()
        jours = (7 - today.weekday()) % 7 or 7  # lundi prochain
        debut_mc1 = today + timedelta(days=jours)

    # Suppression des macrocycles existants (journaux d'abord pour éviter FK)
    _supprimer_ancien_programme(db, user)

    debuts = {1: debut_mc1, 2: debut_mc1 + timedelta(weeks=8), 3: debut_mc1 + timedelta(weeks=16)}
    crees = []
    for numero_cycle in [1, 2, 3]:
        debut = debuts[numero_cycle]
        mc = Macrocycle(
            utilisateur_id=user.id,
            numero_cycle=numero_cycle,
            date_debut=debut,
            date_fin=debut + timedelta(weeks=8),
        )
        db.add(mc)
        db.flush()
        for regle, date_sem in zip(BLUEPRINT_MACROCYCLE, generer_dates_semaines(debut)):
            db.add(SemaineEntrainement(
                macrocycle_id=mc.id,
                numero_semaine=regle.numero,
                macrophase=regle.macrophase,
                date_debut=date_sem,
                multiplicateur_volume=regle.multiplicateur_volume,
                objectif_km_course=regle.objectif_km_course,
                objectif_amrap_min=regle.objectif_amrap_min,
            ))
        crees.append({"numero_cycle": numero_cycle, "debut": debut.strftime("%d/%m/%Y")})

    db.commit()
    return {
        "message": "Macrocycles recréés. Lance maintenant /api/admin/seed-seances.",
        "macrocycles": crees,
    }


# ---------------------------------------------------------------------------
# Migration données historiques → nouveau compte
# ---------------------------------------------------------------------------

class MigrationSchema(BaseModel):
    ancien_user_id: int = 1

@router.post("/api/admin/migrer-donnees", summary="Réaffecte les données d'un ancien compte vers le compte connecté")
def migrer_donnees(
    payload: MigrationSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    ancien_id = payload.ancien_user_id
    nouveau_id = current_user.id

    if ancien_id == nouveau_id:
        raise HTTPException(400, "Les deux utilisateurs sont identiques")

    ancien = db.get(Utilisateur, ancien_id)
    if not ancien:
        raise HTTPException(404, f"Utilisateur source {ancien_id} introuvable")

    stats = {}

    # Macrocycles (cascade : SemaineEntrainement → SeanceEntrainement)
    mcs = db.query(Macrocycle).filter(Macrocycle.utilisateur_id == ancien_id).all()
    for mc in mcs:
        mc.utilisateur_id = nouveau_id
    stats["macrocycles"] = len(mcs)

    # JournalSeance
    journaux = db.query(JournalSeance).filter(JournalSeance.utilisateur_id == ancien_id).all()
    for j in journaux:
        j.utilisateur_id = nouveau_id
    stats["journaux_seances"] = len(journaux)

    # JournalEvaluationSeance
    evals = db.query(JournalEvaluationSeance).filter(JournalEvaluationSeance.utilisateur_id == ancien_id).all()
    for ev in evals:
        ev.utilisateur_id = nouveau_id
    stats["evaluations"] = len(evals)

    # BiometrieUtilisateur
    bios = db.query(BiometrieUtilisateur).filter(BiometrieUtilisateur.utilisateur_id == ancien_id).all()
    for b in bios:
        b.utilisateur_id = nouveau_id
    stats["biometries"] = len(bios)

    # ObjectifCourse
    objs = db.query(ObjectifCourse).filter(ObjectifCourse.utilisateur_id == ancien_id).all()
    for o in objs:
        o.utilisateur_id = nouveau_id
    stats["objectifs_course"] = len(objs)

    # Copier fc_max / fc_repos / poids_kg si le nouveau compte n'en a pas
    if not current_user.fc_max and ancien.fc_max:
        current_user.fc_max = ancien.fc_max
    if not current_user.fc_repos and ancien.fc_repos:
        current_user.fc_repos = ancien.fc_repos
    if not current_user.poids_kg and ancien.poids_kg:
        current_user.poids_kg = ancien.poids_kg

    db.commit()
    return {"ok": True, "migre": stats, "vers": nouveau_id}
