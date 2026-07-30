"""Routes d'authentification : register / login / me / reset-onboarding / onboarding."""

from __future__ import annotations

from datetime import datetime, date, timedelta
from typing import Optional
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import obtenir_session
from models import BiometrieUtilisateur, JournalSeance, Macrocycle, ObjectifCourse, Utilisateur
from deps import (
    get_current_user,
    _hash_password,
    _verify_password,
    _create_token,
    _supprimer_ancien_programme,
    _calculer_volume_pic,
    _injecter_seances_velo,
    _generer_macrocycles_standard,
)

logger = logging.getLogger(__name__)
router = APIRouter()

class RegisterSchema(BaseModel):
    email: str
    password: str
    prenom: str
    nom: str
    sexe: Optional[str] = None
    date_naissance: Optional[str] = None  # "YYYY-MM-DD"
    poids_kg: Optional[float] = None

class LoginSchema(BaseModel):
    email: str
    password: str

class OnboardingSchema(BaseModel):
    type_programme: str           # "course" | "muscu" | "hybride"
    seances_semaine: int
    seances_course_semaine: Optional[int] = None
    seances_muscu_semaine: Optional[int] = None
    frequence_tests_semaines: int = 8
    objectif_type: str            # "course" | "muscu" | "aucun"
    date_debut_programme: str     # "DD/MM/YYYY"
    historique_perf: Optional[dict] = None
    type_course: Optional[str] = None   # "route" | "trail"
    type_muscu: Optional[str] = None    # "poids_corps" | "salle"
    programme_auto: bool = True         # False = l'utilisateur crée ses propres séances

@router.post("/api/auth/register", summary="Crée un nouveau compte")
def register(payload: RegisterSchema, db: Session = Depends(obtenir_session)):
    if db.query(Utilisateur).filter(Utilisateur.email == payload.email).first():
        raise HTTPException(400, "Un compte existe déjà avec cet email")
    dn = None
    if payload.date_naissance:
        try:
            dn = date.fromisoformat(payload.date_naissance)
        except ValueError:
            raise HTTPException(400, "Format date_naissance invalide — attendu YYYY-MM-DD")
    try:
        password_hash = _hash_password(payload.password)
    except Exception:
        logger.exception("Erreur hachage mot de passe")
        raise HTTPException(500, "Erreur lors de la création du compte")
    try:
        user = Utilisateur(
            email=payload.email,
            password_hash=password_hash,
            prenom=payload.prenom,
            nom=payload.nom,
            sexe=payload.sexe,
            date_naissance=dn,
            poids_kg=payload.poids_kg,
            onboarding_complet=False,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    except Exception:
        db.rollback()
        logger.exception("Erreur base de données lors de la création du compte")
        raise HTTPException(500, "Erreur lors de la création du compte")
    token = _create_token(user.id)
    return {"access_token": token, "token_type": "bearer", "user_id": user.id, "onboarding_complet": False}


@router.post("/api/auth/login", summary="Authentifie et retourne un token JWT")
def login(payload: LoginSchema, db: Session = Depends(obtenir_session)):
    user = db.query(Utilisateur).filter(Utilisateur.email == payload.email).first()
    if not user or not user.password_hash or not _verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Email ou mot de passe incorrect")
    token = _create_token(user.id)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": user.id,
        "onboarding_complet": bool(user.onboarding_complet),
    }


@router.get("/api/auth/me", summary="Retourne le profil de l'utilisateur connecté")
def me(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    dn = current_user.date_naissance
    age = None
    if dn:
        today = date.today()
        age = today.year - dn.year - ((today.month, today.day) < (dn.month, dn.day))
    derniere_bio = (
        db.query(BiometrieUtilisateur)
        .filter(BiometrieUtilisateur.utilisateur_id == current_user.id)
        .order_by(BiometrieUtilisateur.enregistre_le.desc())
        .first()
    )
    return {
        "id": current_user.id,
        "email": current_user.email,
        "prenom": current_user.prenom,
        "nom": current_user.nom,
        "sexe": current_user.sexe,
        "date_naissance": str(dn) if dn else None,
        "age": age,
        "poids_kg": current_user.poids_kg,
        "photo_url": current_user.photo_url,
        "fuseau_horaire": current_user.fuseau_horaire,
        "fc_max": current_user.fc_max,
        "fc_repos": current_user.fc_repos,
        "vma_kmh": round(derniere_bio.vma_kmh, 1) if derniere_bio else None,
        "onboarding_complet": bool(current_user.onboarding_complet),
        "type_programme": current_user.type_programme,
        "seances_semaine": current_user.seances_semaine,
        "seances_course_semaine": current_user.seances_course_semaine,
        "seances_muscu_semaine": current_user.seances_muscu_semaine,
        "seances_velo_semaine": current_user.seances_velo_semaine,
        "frequence_tests_semaines": current_user.frequence_tests_semaines,
        "objectif_type": current_user.objectif_type,
        "programme_auto": bool(current_user.programme_auto),
    }


@router.post("/api/auth/reset-onboarding", summary="Réinitialise l'onboarding et supprime le programme")
def reset_onboarding(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    # Récupérer les IDs des séances liées aux macrocycles de cet utilisateur
    seance_ids = [
        s.id
        for mc in db.query(Macrocycle).filter(Macrocycle.utilisateur_id == current_user.id).all()
        for sem in mc.semaines
        for s in sem.seances
    ]
    # Supprimer les journaux d'abord (FK bloque sinon la cascade ORM)
    if seance_ids:
        db.query(JournalSeance).filter(JournalSeance.seance_id.in_(seance_ids)).delete(synchronize_session=False)
    # Supprimer les macrocycles (cascade ORM → semaines → séances → exercices)
    for mc in db.query(Macrocycle).filter(Macrocycle.utilisateur_id == current_user.id).all():
        db.delete(mc)
    current_user.onboarding_complet = False
    db.commit()
    db.refresh(current_user)
    dn = current_user.date_naissance
    age = None
    if dn:
        today = date.today()
        age = today.year - dn.year - ((today.month, today.day) < (dn.month, dn.day))
    return {
        "id": current_user.id,
        "email": current_user.email,
        "prenom": current_user.prenom,
        "nom": current_user.nom,
        "sexe": current_user.sexe,
        "date_naissance": str(dn) if dn else None,
        "age": age,
        "poids_kg": current_user.poids_kg,
        "photo_url": current_user.photo_url,
        "fuseau_horaire": current_user.fuseau_horaire,
        "fc_max": current_user.fc_max,
        "fc_repos": current_user.fc_repos,
        "onboarding_complet": False,
        "type_programme": current_user.type_programme,
        "seances_semaine": current_user.seances_semaine,
        "seances_course_semaine": current_user.seances_course_semaine,
        "seances_muscu_semaine": current_user.seances_muscu_semaine,
        "seances_velo_semaine": current_user.seances_velo_semaine,
        "frequence_tests_semaines": current_user.frequence_tests_semaines,
        "objectif_type": current_user.objectif_type,
        "programme_auto": bool(current_user.programme_auto),
    }
@router.post("/api/auth/onboarding", summary="Complète l'onboarding et génère le programme")
def onboarding(
    payload: OnboardingSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    import json as _json
    from models import SemaineEntrainement
    from periodization_rules import BLUEPRINT_MACROCYCLE, generer_dates_semaines, generer_blueprint_course
    from seed_seances import MODULE1, _POOL_SURCHARGE, _semaine_course, _semaine_taper_course, _inserer_seances_en_session, calibrer_module, adapter_contenu_muscu, adapter_contenu_gym, adapter_contenu_course, enrichir_paces_vma

    # Sauvegarder préférences
    current_user.type_programme = payload.type_programme
    current_user.seances_semaine = payload.seances_semaine
    current_user.seances_course_semaine = payload.seances_course_semaine
    current_user.seances_muscu_semaine = payload.seances_muscu_semaine
    current_user.frequence_tests_semaines = payload.frequence_tests_semaines
    current_user.objectif_type = payload.objectif_type
    current_user.programme_auto = payload.programme_auto
    current_user.onboarding_complet = True
    if payload.type_course:
        current_user.type_course = payload.type_course
    if payload.type_muscu:
        current_user.type_muscu = payload.type_muscu

    # Calibration intelligente depuis l'historique + profil complet
    from intelligence_programme import (
        construire_profil, calibration_v2, generer_blueprint_course_v2,
        semaines_assimilation, appliquer_profil_au_contenu,
    )
    hist = payload.historique_perf or {}
    if payload.historique_perf:
        current_user.historique_perf = _json.dumps(payload.historique_perf, ensure_ascii=False)

        # Pre-fill FC max
        if hist.get("fc_max") and not current_user.fc_max:
            try:
                current_user.fc_max = int(hist["fc_max"])
            except (TypeError, ValueError):
                pass

        # Pre-fill biométrie depuis VMA connue (équivaut à un test demi-Cooper virtuel)
        if hist.get("vma_estimee"):
            try:
                vma = float(hist["vma_estimee"])
                if 5.0 <= vma <= 30.0:
                    # distance_metres = vma * 100 → depuis_demi_cooper recalcule vma = dist/100 = vma
                    biometrie = BiometrieUtilisateur.depuis_demi_cooper(
                        utilisateur_id=current_user.id,
                        distance_metres=vma * 100,
                        fc_max=current_user.fc_max,
                    )
                    db.add(biometrie)
            except (TypeError, ValueError):
                pass

    try:
        debut = datetime.strptime(payload.date_debut_programme, "%d/%m/%Y").date()
    except ValueError:
        raise HTTPException(400, "Format date_debut_programme invalide — attendu jj/mm/aaaa")
    if debut.weekday() != 0:
        debut = debut + timedelta(days=(7 - debut.weekday()) % 7)

    # Supprimer ancien programme si existant (journaux d'abord pour éviter FK)
    _supprimer_ancien_programme(db, current_user)

    # ── MODE MANUEL : pas de génération auto ────────────────────────────────
    # On crée une structure de semaines vides (macrocycle sans séances) que
    # l'utilisateur remplira lui-même. Les stats se nourriront des séances
    # qu'il crée et journalise (même chemin : Journal → Séance → Semaine → MC).
    if not payload.programme_auto:
        from models import TypeMacrophase
        import math

        # Nombre de semaines = jusqu'à la date d'objectif si elle existe,
        # sinon 12 semaines par défaut. Borné entre 1 et 52.
        obj_manuel = db.query(ObjectifCourse).filter(
            ObjectifCourse.utilisateur_id == current_user.id
        ).order_by(ObjectifCourse.id.desc()).first()
        if obj_manuel and obj_manuel.date_course:
            jours = (obj_manuel.date_course - debut).days
            n_semaines = math.ceil(jours / 7) if jours > 0 else 1
        else:
            n_semaines = 12
        n_semaines = max(1, min(52, n_semaines))

        eval_freq = current_user.frequence_tests_semaines or 8

        mc = Macrocycle(
            utilisateur_id=current_user.id, numero_cycle=1,
            date_debut=debut, date_fin=debut + timedelta(weeks=n_semaines),
        )
        db.add(mc); db.flush()
        for i in range(n_semaines):
            numero = i + 1
            # Semaine d'évaluation tous les `eval_freq` semaines
            est_eval = eval_freq > 0 and numero % eval_freq == 0
            db.add(SemaineEntrainement(
                macrocycle_id=mc.id, numero_semaine=numero,
                macrophase=TypeMacrophase.EVALUATION if est_eval else TypeMacrophase.SURCHARGE,
                date_debut=debut + timedelta(weeks=i),
                multiplicateur_volume=1.0,
            ))
        db.commit()
        return {"ok": True, "message": "Onboarding terminé, mode manuel activé."}

    # Récupérer objectif course si existant
    obj_course = db.query(ObjectifCourse).filter(
        ObjectifCourse.utilisateur_id == current_user.id
    ).order_by(ObjectifCourse.id.desc()).first()

    # Profil consolidé + calibration v2 (âge, VMA, force pull/push, progression)
    profil = construire_profil(current_user, db, hist)
    calib = calibration_v2(hist, profil)

    kf = calib["km_factor"]
    af = calib["amrap_factor"]
    rf = calib["reps_factor"]
    vma_for_paces = profil.get("vma")  # bio récente sinon estimation questionnaire

    if payload.type_programme == "velo":
        # Programme vélo PUR : 2 macrocycles de 8 semaines périodisées (surcharge/décharge/
        # évaluation) SANS contenu course/muscu. L'injection vélo plus bas remplit chaque
        # semaine avec les séances PMA / sweet spot / endurance / sortie longue.
        from models import TypeMacrophase
        for numero_cycle in (1, 2):
            debut_mc = debut + timedelta(weeks=8 * (numero_cycle - 1))
            mc = Macrocycle(utilisateur_id=current_user.id, numero_cycle=numero_cycle,
                            date_debut=debut_mc, date_fin=debut_mc + timedelta(weeks=8))
            db.add(mc); db.flush()
            for regle, ds in zip(BLUEPRINT_MACROCYCLE, generer_dates_semaines(debut_mc)):
                db.add(SemaineEntrainement(macrocycle_id=mc.id, numero_semaine=regle.numero,
                    macrophase=regle.macrophase, date_debut=ds,
                    multiplicateur_volume=regle.multiplicateur_volume))
            db.flush()
    elif obj_course and payload.objectif_type in ("course", "hybride"):
        from models import TypeMacrophase
        n_semaines = max(4, (obj_course.date_course - debut).days // 7)
        n_surcharge = n_semaines - 3
        eval_freq = current_user.frequence_tests_semaines or 8

        # Blueprint v2 (mésocycles 3:1, progression individualisée) + semaines d'évaluation
        blueprint = generer_blueprint_course_v2(n_semaines, calib)
        for regle in blueprint:
            if regle.numero <= n_surcharge and regle.numero % eval_freq == 0:
                regle.macrophase = TypeMacrophase.EVALUATION
                regle.objectif_amrap_min = None
                regle.objectif_km_course = None

        mc = Macrocycle(utilisateur_id=current_user.id, numero_cycle=1,
                        date_debut=debut, date_fin=debut + timedelta(weeks=n_semaines))
        db.add(mc); db.flush()
        for regle, ds in zip(blueprint, [debut + timedelta(weeks=i) for i in range(n_semaines)]):
            km = round(regle.objectif_km_course * kf, 1) if regle.objectif_km_course else None
            amrap = round(regle.objectif_amrap_min * af) if regle.objectif_amrap_min else None
            db.add(SemaineEntrainement(macrocycle_id=mc.id, numero_semaine=regle.numero,
                macrophase=regle.macrophase, date_debut=ds,
                multiplicateur_volume=regle.multiplicateur_volume,
                objectif_km_course=km, objectif_amrap_min=amrap))
        db.flush()

        # Contenu des séances : surcharge progressive + semaines d'évaluation
        # Volume progressif : facteur km augmente de kf (niveau actuel) vers f_pic (volume objectif)
        vol_pic = _calculer_volume_pic(obj_course.distance_km)
        BASELINE_VOL = 35.0
        f_pic = min(vol_pic / BASELINE_VOL, kf * calib.get("plafond_pic", 2.2))
        assim = semaines_assimilation(n_surcharge)
        progress_map = {}

        n_build_weeks = sum(1 for i in range(1, n_surcharge + 1) if i % eval_freq != 0)
        m1_cal = calibrer_module(MODULE1, kf, af, rf)
        content = {}
        pool_idx = 1
        build_count = 0
        for i in range(1, n_surcharge + 1):
            if i % eval_freq == 0:
                content[i] = MODULE1[8]  # tests standardisés — non calibrés
            else:
                # km_factor croît progressivement de kf à f_pic
                progress = build_count / max(1, n_build_weeks - 1) if n_build_weeks > 1 else 1.0
                week_kf = kf + (f_pic - kf) * (progress ** calib.get("exp_progression", 0.75))
                if i in assim:
                    week_kf *= 0.75  # semaine d'assimilation : le corps absorbe la charge
                pool_key = min(pool_idx, 15)
                week_content = calibrer_module({1: _POOL_SURCHARGE[pool_key]}, week_kf, af, rf)[1]
                content[i] = week_content
                progress_map[i] = progress
                pool_idx += 1
                build_count += 1
        content[n_surcharge + 1] = m1_cal.get(6, MODULE1[6])  # décharge calibrée
        content[n_surcharge + 2] = _semaine_taper_course()     # taper pré-course (pas de prépa tests)
        content[n_semaines] = _semaine_course(obj_course.date_course, obj_course.nom)

        # Adaptation au profil : allures selon distance, sortie longue, variantes, terrain
        content = appliquer_profil_au_contenu(content, profil, calib, progress_map)

        # Enrichissement des descriptions avec allures réelles
        if vma_for_paces and vma_for_paces >= 5.0:
            content = enrichir_paces_vma(content, vma_for_paces)

        n_muscu = current_user.seances_muscu_semaine or 2
        seances_total = current_user.seances_semaine or 5
        n_course = current_user.seances_course_semaine if current_user.seances_course_semaine is not None else max(1, seances_total - n_muscu)
        n_course = min(n_course, max(1, seances_total - n_muscu))
        muscu_adapter = adapter_contenu_gym if current_user.type_muscu == "salle" else adapter_contenu_muscu
        adapted = adapter_contenu_course(muscu_adapter(content, n_muscu, current_user.sexe), n_course)
        _inserer_seances_en_session(db, mc, adapted)
    else:
        # Programme standard 2 macrocycles avec sessions calibrées
        n_muscu = current_user.seances_muscu_semaine or 2
        n_course = current_user.seances_course_semaine or 3
        muscu_adapter = adapter_contenu_gym if current_user.type_muscu == "salle" else adapter_contenu_muscu
        _generer_macrocycles_standard(
            db, current_user, debut, 2, kf, af, rf, profil, calib, vma_for_paces,
            muscu_adapter, n_muscu, n_course,
        )

    # ── Séances vélo de route (si la discipline est pratiquée) ──────────────
    semaines_all = (
        db.query(SemaineEntrainement)
        .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
        .filter(Macrocycle.utilisateur_id == current_user.id)
        .all()
    )
    _injecter_seances_velo(db, current_user, payload.type_programme, semaines_all)

    db.commit()
    return {"ok": True, "message": "Onboarding terminé, programme généré."}
