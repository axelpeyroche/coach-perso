"""
API FastAPI â€” Coach d'EntraÃ®nement Hybride EPC.

Routes :
    POST /api/evaluations/              CrÃ©er une session d'Ã©valuation
    POST /api/evaluations/{id}/demi-cooper      Enregistrer un Demi-Cooper
    POST /api/evaluations/{id}/max-1min         Enregistrer les scores Max 1 min
    POST /api/evaluations/{id}/amrap-benchmark  Enregistrer le score AMRAP Benchmark
    GET  /api/analytics/tendances-physiologiques
    GET  /api/analytics/distribution-volume
    GET  /api/analytics/biometrie-recuperation
    GET  /api/macrocycles/{id}/semaines
    POST /api/seances/{id}/journal              Journaliser une sÃ©ance complÃ©tÃ©e
"""

from __future__ import annotations

from datetime import datetime, date, timedelta
from typing import Optional
import time as _time
import urllib.parse as _urlparse
import urllib.request as _urlrequest
import json as _json_mod

import io
import os
import re

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, Security, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from jose import JWTError, jwt

try:
    from apscheduler.schedulers.background import BackgroundScheduler
    from pywebpush import webpush, WebPushException
    import json as _json
    _PUSH_ENABLED = True
except ImportError:
    _PUSH_ENABLED = False

_VAPID_PRIVATE = os.getenv("VAPID_PRIVATE_KEY", "")
_VAPID_PUBLIC  = os.getenv("VAPID_PUBLIC_KEY", "")
_VAPID_EMAIL   = os.getenv("VAPID_EMAIL", "mailto:admin@example.com")

_scheduler: "BackgroundScheduler | None" = None

import analytics_service
from database import creer_tables, obtenir_session
from models import (
    BiometrieUtilisateur,
    ExerciceSeance,
    JournalEvaluationSeance,
    JournalSeance,
    Macrocycle,
    ObjectifCourse,
    PushSubscription,
    ResultatAMRAPBenchmark,
    ResultatDemiCooper,
    ResultatMax1Min,
    SeanceEntrainement,
    SemaineEntrainement,
    TypeSeance,
    Utilisateur,
    VariationExercice,
)

app = FastAPI(
    title="Coach EPC â€” API",
    description="API du coach d'entraÃ®nement hybride Course & Musculation au poids du corps.",
    version="1.0.0",
)

def _initialiser_donnees_demo():
    """CrÃ©e un utilisateur et 2 macrocycles (Module 1 + Module 2) si la base est vide."""
    from models import Utilisateur, SemaineEntrainement
    from periodization_rules import BLUEPRINT_MACROCYCLE, generer_dates_semaines
    db = next(obtenir_session())
    try:
        if db.query(Utilisateur).count() == 0:
            user = Utilisateur(email="coach@perso.fr", nom="AthlÃ¨te EPC")
            db.add(user)
            db.flush()

            debut_mc1 = date.today()
            debut_mc2 = debut_mc1 + timedelta(weeks=8)

            for numero_cycle, debut in ((1, debut_mc1), (2, debut_mc2)):
                mc = Macrocycle(
                    utilisateur_id=user.id,
                    numero_cycle=numero_cycle,
                    date_debut=debut,
                    date_fin=debut + timedelta(weeks=8),
                )
                db.add(mc)
                db.flush()
                dates = generer_dates_semaines(debut)
                for regle, date_sem in zip(BLUEPRINT_MACROCYCLE, dates):
                    sem = SemaineEntrainement(
                        macrocycle_id=mc.id,
                        numero_semaine=regle.numero,
                        macrophase=regle.macrophase,
                        date_debut=date_sem,
                        multiplicateur_volume=regle.multiplicateur_volume,
                        objectif_km_course=regle.objectif_km_course,
                        objectif_amrap_min=regle.objectif_amrap_min,
                    )
                    db.add(sem)
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


_ALLOWED_ORIGINS = [
    "https://coach-perso-frontend.onrender.com",
    "http://localhost:5173",
    "http://localhost:4173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Auth â€” JWT + bcrypt
# ---------------------------------------------------------------------------

SECRET_KEY = os.getenv("JWT_SECRET", "change-me-in-production-super-secret-key-32chars")
ALGORITHM  = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 30  # 30 jours

import hashlib, hmac as _hmac, os as _os, base64 as _b64

http_bearer = HTTPBearer(auto_error=False)


def _hash_password(password: str) -> str:
    salt = _os.urandom(16)
    key  = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 260_000)
    return _b64.b64encode(salt + key).decode()

def _verify_password(plain: str, hashed: str) -> bool:
    try:
        data = _b64.b64decode(hashed.encode())
        salt, key = data[:16], data[16:]
        new_key = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt, 260_000)
        return _hmac.compare_digest(key, new_key)
    except Exception:
        return False

def _create_token(user_id: int) -> str:
    return jwt.encode({"sub": str(user_id)}, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(http_bearer),
    db: Session = Depends(obtenir_session),
) -> Utilisateur:
    if not credentials:
        raise HTTPException(401, "Non authentifiÃ©")
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(401, "Token invalide")
    user = db.get(Utilisateur, user_id)
    if not user:
        raise HTTPException(401, "Utilisateur introuvable")
    return user


def _envoyer_push_seance(seance_id: int) -> None:
    """Envoi de la notification push pour une sÃ©ance planifiÃ©e (appelÃ© par APScheduler)."""
    if not _PUSH_ENABLED or not _VAPID_PRIVATE:
        return
    db = next(obtenir_session())
    try:
        seance = db.get(SeanceEntrainement, seance_id)
        if not seance or seance.journal and seance.journal.completee:
            return
        semaine = db.get(SemaineEntrainement, seance.semaine_id)
        if not semaine:
            return
        subs = db.query(PushSubscription).filter_by(utilisateur_id=semaine.macrocycle.utilisateur_id).all()
        payload = _json.dumps({
            "title": f"ðŸƒ SÃ©ance du jour : {seance.titre}",
            "body": f"C'est l'heure de ta sÃ©ance ! {seance.heure_planifiee or ''}".strip(),
            "tag": f"seance-{seance_id}",
            "url": "/programme",
        })
        for sub in subs:
            try:
                webpush(
                    subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                    data=payload,
                    vapid_private_key=_VAPID_PRIVATE,
                    vapid_claims={"sub": _VAPID_EMAIL},
                )
            except WebPushException:
                pass
    finally:
        db.close()


def _planifier_notification(seance_id: int, date_planifiee, heure_planifiee: str | None) -> None:
    """Ajoute ou supprime un job APScheduler pour la notification de la sÃ©ance."""
    if not _PUSH_ENABLED or _scheduler is None:
        return
    job_id = f"seance-{seance_id}"
    _scheduler.remove_job(job_id) if _scheduler.get_job(job_id) else None
    if not date_planifiee:
        return
    h, m = (int(x) for x in (heure_planifiee or "08:00").split(":"))
    from datetime import datetime as _dt
    run_at = _dt(date_planifiee.year, date_planifiee.month, date_planifiee.day, h, m)
    if run_at > _dt.now():
        _scheduler.add_job(
            _envoyer_push_seance, "date",
            run_date=run_at, args=[seance_id], id=job_id,
            misfire_grace_time=3600,
        )


@app.on_event("startup")
def demarrage():
    global _scheduler
    creer_tables()
    _initialiser_donnees_demo()
    if _PUSH_ENABLED:
        _scheduler = BackgroundScheduler()
        _scheduler.start()
        # Re-planifie les notifications pour toutes les sÃ©ances futures encore non validÃ©es
        db = next(obtenir_session())
        try:
            from datetime import datetime as _dt
            now = _dt.now()
            seances = db.query(SeanceEntrainement).filter(
                SeanceEntrainement.date_planifiee.isnot(None)
            ).all()
            for s in seances:
                if s.journal and s.journal.completee:
                    continue
                _planifier_notification(s.id, s.date_planifiee, s.heure_planifiee)
        finally:
            db.close()


# ---------------------------------------------------------------------------
# Auth â€” Register / Login / Me / Onboarding
# ---------------------------------------------------------------------------

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


@app.post("/api/auth/register", summary="CrÃ©e un nouveau compte")
def register(payload: RegisterSchema, db: Session = Depends(obtenir_session)):
    if db.query(Utilisateur).filter(Utilisateur.email == payload.email).first():
        raise HTTPException(400, "Un compte existe dÃ©jÃ  avec cet email")
    dn = None
    if payload.date_naissance:
        try:
            dn = date.fromisoformat(payload.date_naissance)
        except ValueError:
            raise HTTPException(400, "Format date_naissance invalide â€” attendu YYYY-MM-DD")
    try:
        password_hash = _hash_password(payload.password)
    except Exception as e:
        raise HTTPException(500, f"Erreur hachage mot de passe: {e}")
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
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Erreur base de donnÃ©es: {e}")
    token = _create_token(user.id)
    return {"access_token": token, "token_type": "bearer", "user_id": user.id, "onboarding_complet": False}


@app.post("/api/auth/login", summary="Authentifie et retourne un token JWT")
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


@app.get("/api/auth/me", summary="Retourne le profil de l'utilisateur connectÃ©")
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
        "fc_max": current_user.fc_max,
        "fc_repos": current_user.fc_repos,
        "vma_kmh": round(derniere_bio.vma_kmh, 1) if derniere_bio else None,
        "onboarding_complet": bool(current_user.onboarding_complet),
        "type_programme": current_user.type_programme,
        "seances_semaine": current_user.seances_semaine,
        "seances_course_semaine": current_user.seances_course_semaine,
        "seances_muscu_semaine": current_user.seances_muscu_semaine,
        "frequence_tests_semaines": current_user.frequence_tests_semaines,
        "objectif_type": current_user.objectif_type,
    }


@app.post("/api/auth/reset-onboarding", summary="RÃ©initialise l'onboarding et supprime le programme")
def reset_onboarding(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
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
        "fc_max": current_user.fc_max,
        "fc_repos": current_user.fc_repos,
        "onboarding_complet": False,
        "type_programme": current_user.type_programme,
        "seances_semaine": current_user.seances_semaine,
        "seances_course_semaine": current_user.seances_course_semaine,
        "seances_muscu_semaine": current_user.seances_muscu_semaine,
        "frequence_tests_semaines": current_user.frequence_tests_semaines,
        "objectif_type": current_user.objectif_type,
    }


def _pace_str(kmh: float) -> str:
    """Convertit une vitesse km/h en allure min:sec/km."""
    if not kmh or kmh <= 0:
        return "â€”"
    s = 3600 / kmh
    return f"{int(s // 60)}:{int(s % 60):02d}/km"


def _calculer_volume_pic(distance_km: float) -> float:
    """Volume hebdomadaire pic recommandÃ© (km/semaine) selon la distance cible."""
    if distance_km <= 5:
        return 35.0
    elif distance_km <= 12:
        return 45.0
    elif distance_km <= 22:
        return 60.0
    elif distance_km <= 45:
        return 75.0
    else:
        return 90.0


def _vma_requise(distance_km: float, objectif_temps_min: float) -> float:
    """VMA nÃ©cessaire (km/h) pour atteindre l'objectif temps sur la distance."""
    if not objectif_temps_min or objectif_temps_min <= 0:
        return 0.0
    allure_kmh = (distance_km / objectif_temps_min) * 60
    if distance_km <= 5:
        intensite = 0.97
    elif distance_km <= 12:
        intensite = 0.94
    elif distance_km <= 22:
        intensite = 0.85
    elif distance_km <= 45:
        intensite = 0.78
    else:
        intensite = 0.70
    return round(allure_kmh / intensite, 2)


def _calculer_calibration(historique: dict) -> dict:
    """Calcule km_factor et amrap_factor depuis l'historique de performance utilisateur."""
    niveau = historique.get("niveau", "intermediaire")
    niveau_map = {"debutant": 0.75, "intermediaire": 1.0, "confirme": 1.25}
    base_factor = niveau_map.get(niveau, 1.0)

    # km_factor â€” calÃ© sur le volume hebdomadaire actuel
    volume = historique.get("volume_km_semaine")
    try:
        vol = float(volume) if volume is not None else None
    except (TypeError, ValueError):
        vol = None
    if vol is not None:
        km_base = min(max(vol * 0.8, 8.0), 50.0)
        km_factor = km_base / 15.0
    else:
        km_factor = base_factor

    # amrap_factor â€” calÃ© sur les performances muscu
    max_pompes = historique.get("max_pompes")
    max_tractions = historique.get("max_tractions")
    try:
        pompes = float(max_pompes) if max_pompes is not None else None
        tractions = float(max_tractions) if max_tractions is not None else None
    except (TypeError, ValueError):
        pompes = tractions = None
    if pompes is not None and tractions is not None:
        score = (pompes / 20.0) + (tractions / 8.0)
        amrap_factor = max(0.55, min(1.6, 0.45 + score * 0.275))
    else:
        amrap_factor = base_factor

    return {
        "km_factor": round(km_factor, 3),
        "amrap_factor": round(amrap_factor, 3),
        "reps_factor": round(amrap_factor, 3),
    }


@app.post("/api/auth/onboarding", summary="ComplÃ¨te l'onboarding et gÃ©nÃ¨re le programme")
def onboarding(
    payload: OnboardingSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    import json as _json
    from models import SemaineEntrainement
    from periodization_rules import BLUEPRINT_MACROCYCLE, generer_dates_semaines, generer_blueprint_course
    from seed_seances import MODULE1, MODULE2, MODULE3, _POOL_SURCHARGE, _semaine_course, _semaine_taper_course, _inserer_seances_en_session, calibrer_module, adapter_contenu_muscu, adapter_contenu_gym, adapter_contenu_course, enrichir_paces_vma

    # Sauvegarder prÃ©fÃ©rences
    current_user.type_programme = payload.type_programme
    current_user.seances_semaine = payload.seances_semaine
    current_user.seances_course_semaine = payload.seances_course_semaine
    current_user.seances_muscu_semaine = payload.seances_muscu_semaine
    current_user.frequence_tests_semaines = payload.frequence_tests_semaines
    current_user.objectif_type = payload.objectif_type
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

        # Pre-fill biomÃ©trie depuis VMA connue (Ã©quivaut Ã  un test demi-Cooper virtuel)
        if hist.get("vma_estimee"):
            try:
                vma = float(hist["vma_estimee"])
                if 5.0 <= vma <= 30.0:
                    # distance_metres = vma * 100 â†’ depuis_demi_cooper recalcule vma = dist/100 = vma
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
        raise HTTPException(400, "Format date_debut_programme invalide â€” attendu jj/mm/aaaa")
    if debut.weekday() != 0:
        debut = debut + timedelta(days=(7 - debut.weekday()) % 7)

    # Supprimer ancien programme si existant
    for mc_old in db.query(Macrocycle).filter(Macrocycle.utilisateur_id == current_user.id).all():
        db.delete(mc_old)
    db.flush()

    # RÃ©cupÃ©rer objectif course si existant
    obj_course = db.query(ObjectifCourse).filter(
        ObjectifCourse.utilisateur_id == current_user.id
    ).order_by(ObjectifCourse.id.desc()).first()

    # Profil consolidÃ© + calibration v2 (Ã¢ge, VMA, force pull/push, progression)
    profil = construire_profil(current_user, db, hist)
    calib = calibration_v2(hist, profil)

    kf = calib["km_factor"]
    af = calib["amrap_factor"]
    rf = calib["reps_factor"]
    vma_for_paces = profil.get("vma")  # bio rÃ©cente sinon estimation questionnaire

    if obj_course and payload.objectif_type in ("course", "hybride"):
        from models import TypeMacrophase
        n_semaines = max(4, (obj_course.date_course - debut).days // 7)
        n_surcharge = n_semaines - 3
        eval_freq = current_user.frequence_tests_semaines or 8

        # Blueprint v2 (mÃ©socycles 3:1, progression individualisÃ©e) + semaines d'Ã©valuation
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

        # Contenu des sÃ©ances : surcharge progressive + semaines d'Ã©valuation
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
                content[i] = MODULE1[8]  # tests standardisÃ©s â€” non calibrÃ©s
            else:
                # km_factor croÃ®t progressivement de kf Ã  f_pic
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
        content[n_surcharge + 1] = m1_cal.get(6, MODULE1[6])  # dÃ©charge calibrÃ©e
        content[n_surcharge + 2] = _semaine_taper_course()     # taper prÃ©-course (pas de prÃ©pa tests)
        content[n_semaines] = _semaine_course(obj_course.date_course, obj_course.nom)

        # Adaptation au profil : allures selon distance, sortie longue, variantes, terrain
        content = appliquer_profil_au_contenu(content, profil, calib, progress_map)

        # Enrichissement des descriptions avec allures rÃ©elles
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
        # Programme standard 2 macrocycles avec sessions calibrÃ©es
        modules = {1: MODULE1, 2: MODULE2, 3: MODULE3}
        n_muscu = current_user.seances_muscu_semaine or 2
        n_course = current_user.seances_course_semaine or 3
        muscu_adapter = adapter_contenu_gym if current_user.type_muscu == "salle" else adapter_contenu_muscu
        for numero_cycle in (1, 2):
            debut_mc = debut + timedelta(weeks=8 * (numero_cycle - 1))
            mc = Macrocycle(utilisateur_id=current_user.id, numero_cycle=numero_cycle,
                            date_debut=debut_mc, date_fin=debut_mc + timedelta(weeks=8))
            db.add(mc); db.flush()
            for regle, ds in zip(BLUEPRINT_MACROCYCLE, generer_dates_semaines(debut_mc)):
                km = round(regle.objectif_km_course * kf, 1) if regle.objectif_km_course else None
                amrap = round(regle.objectif_amrap_min * af) if regle.objectif_amrap_min else None
                db.add(SemaineEntrainement(macrocycle_id=mc.id, numero_semaine=regle.numero,
                    macrophase=regle.macrophase, date_debut=ds,
                    multiplicateur_volume=regle.multiplicateur_volume,
                    objectif_km_course=km, objectif_amrap_min=amrap))
            db.flush()
            module_data = modules.get(numero_cycle, MODULE1)
            calibrated = calibrer_module(module_data, kf, af, rf)
            calibrated = appliquer_profil_au_contenu(calibrated, profil, calib)
            if vma_for_paces and vma_for_paces >= 5.0:
                calibrated = enrichir_paces_vma(calibrated, vma_for_paces)
            adapted = adapter_contenu_course(muscu_adapter(calibrated, n_muscu, current_user.sexe), n_course)
            _inserer_seances_en_session(db, mc, adapted)

    db.commit()
    return {"ok": True, "message": "Onboarding terminÃ©, programme gÃ©nÃ©rÃ©."}


# ---------------------------------------------------------------------------
# Mise Ã  jour des paramÃ¨tres programme + rÃ©gÃ©nÃ©ration des sÃ©ances Ã  venir
# ---------------------------------------------------------------------------

class UpdateProgrammeSchema(BaseModel):
    type_programme: Optional[str] = None  # "hybride" | "muscu" | "course"
    seances_semaine: Optional[int] = Field(None, ge=1, le=14)
    seances_muscu_semaine: Optional[int] = Field(None, ge=0, le=14)
    seances_course_semaine: Optional[int] = Field(None, ge=0, le=14)
    type_muscu: Optional[str] = None   # "poids_corps" | "salle"
    type_course: Optional[str] = None  # "route" | "trail"
    frequence_tests_semaines: Optional[int] = Field(None, ge=1, le=52)


@app.patch("/api/utilisateur/programme", summary="Modifier les paramÃ¨tres programme et rÃ©gÃ©nÃ©rer les sÃ©ances futures")
def update_programme(
    payload: UpdateProgrammeSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    from seed_seances import (
        MODULE1, MODULE2, MODULE3,
        _inserer_seances_en_session, calibrer_module,
        adapter_contenu_muscu, adapter_contenu_gym, adapter_contenu_course,
        enrichir_paces_vma,
    )
    import json as _json

    # 1. Mettre Ã  jour les prÃ©fÃ©rences utilisateur
    if payload.type_programme is not None:
        current_user.type_programme = payload.type_programme
    if payload.seances_semaine is not None:
        current_user.seances_semaine = payload.seances_semaine
    if payload.seances_muscu_semaine is not None:
        current_user.seances_muscu_semaine = payload.seances_muscu_semaine
    if payload.seances_course_semaine is not None:
        current_user.seances_course_semaine = payload.seances_course_semaine
    if payload.type_muscu is not None:
        current_user.type_muscu = payload.type_muscu
    if payload.type_course is not None:
        current_user.type_course = payload.type_course
    if payload.frequence_tests_semaines is not None:
        current_user.frequence_tests_semaines = payload.frequence_tests_semaines
    db.flush()

    # 2. Identifier les semaines non dÃ©marrÃ©es (aucune sÃ©ance avec journal)
    today = date.today()
    mcs = db.query(Macrocycle).filter(Macrocycle.utilisateur_id == current_user.id).all()

    n_muscu = current_user.seances_muscu_semaine or 2
    seances_total = current_user.seances_semaine or 5
    n_course = current_user.seances_course_semaine if current_user.seances_course_semaine is not None else max(1, seances_total - n_muscu)
    n_course = min(n_course, max(1, seances_total - n_muscu))
    muscu_adapter = adapter_contenu_gym if current_user.type_muscu == "salle" else adapter_contenu_muscu

    from intelligence_programme import (
        construire_profil as _cp_upd, calibration_v2 as _cv2_upd,
        appliquer_profil_au_contenu as _apc_upd,
    )
    hist_upd = {}
    if current_user.historique_perf:
        try:
            hist_upd = _json.loads(current_user.historique_perf)
        except Exception:
            hist_upd = {}
    profil_upd = _cp_upd(current_user, db, hist_upd)
    calib = _cv2_upd(hist_upd, profil_upd)
    kf, af, rf = calib["km_factor"], calib["amrap_factor"], calib["reps_factor"]

    # VMA actuelle pour enrichissement descriptions
    vma_for_paces = None
    derniere_bio = (
        db.query(BiometrieUtilisateur)
        .filter(BiometrieUtilisateur.utilisateur_id == current_user.id)
        .order_by(BiometrieUtilisateur.enregistre_le.desc())
        .first()
    )
    if derniere_bio and derniere_bio.vma_kmh >= 5.0:
        vma_for_paces = derniere_bio.vma_kmh

    modules = {1: MODULE1, 2: MODULE2, 3: MODULE3}

    exercices_map = {e.slug: e for e in db.query(VariationExercice).all()}

    for mc in mcs:
        sems = (
            db.query(SemaineEntrainement)
            .filter(SemaineEntrainement.macrocycle_id == mc.id)
            .order_by(SemaineEntrainement.date_debut)
            .all()
        )

        # NumÃ©ros des semaines futures non dÃ©marrÃ©es Ã  rÃ©gÃ©nÃ©rer
        nums_a_regenerer: set[int] = set()
        for sem in sems:
            if sem.date_debut < today:
                continue
            seances_sem = db.query(SeanceEntrainement).filter(SeanceEntrainement.semaine_id == sem.id).all()
            has_journal = any(
                db.query(JournalSeance).filter(JournalSeance.seance_id == s.id).first()
                for s in seances_sem
            )
            if has_journal:
                continue
            # Supprimer les sÃ©ances non validÃ©es de cette semaine
            ids_seances = [s.id for s in seances_sem]
            if ids_seances:
                db.query(ExerciceSeance).filter(ExerciceSeance.seance_id.in_(ids_seances)).delete(synchronize_session=False)
                db.query(SeanceEntrainement).filter(SeanceEntrainement.semaine_id == sem.id).delete(synchronize_session=False)
            nums_a_regenerer.add(sem.numero_semaine)

        db.flush()

        if not nums_a_regenerer:
            continue

        # PrÃ©parer le contenu calibrÃ© pour ce macrocycle
        module_data = modules.get(mc.numero_cycle, MODULE1)
        calibrated = calibrer_module(module_data, kf, af, rf)
        calibrated = _apc_upd(calibrated, profil_upd, calib)
        if vma_for_paces:
            calibrated = enrichir_paces_vma(calibrated, vma_for_paces)
        adapted = adapter_contenu_course(muscu_adapter(calibrated, n_muscu, current_user.sexe), n_course)

        # Injecter uniquement les semaines vidÃ©es (sans toucher aux semaines passÃ©es)
        semaines_map = {s.numero_semaine: s for s in sems}
        for num_sem, seances_data in adapted.items():
            if num_sem not in nums_a_regenerer:
                continue
            semaine = semaines_map.get(num_sem)
            if not semaine:
                continue
            for ordre, s in enumerate(seances_data, 1):
                seance = SeanceEntrainement(
                    semaine_id=semaine.id,
                    date_seance=semaine.date_debut + timedelta(days=s["jour"] - 1),
                    type_seance=s["type"],
                    titre=s["titre"],
                    description=s.get("description"),
                    ordre_dans_semaine=ordre,
                    zone_cible=s.get("zone"),
                    duree_cible_min=s.get("duree_min"),
                    dplus_cible_m=s.get("dplus_m"),
                    temps_limite_min=s.get("temps_limite"),
                )
                db.add(seance)
                db.flush()
                for pos, ex_data in enumerate(s.get("exercices", []), 1):
                    slug = ex_data.get("slug")
                    nom_libre = ex_data.get("nom")
                    exercice = exercices_map.get(slug) if slug else None
                    if not exercice and not nom_libre:
                        continue
                    db.add(ExerciceSeance(
                        seance_id=seance.id,
                        exercice_id=exercice.id if exercice else None,
                        nom_affichage=nom_libre if not exercice else None,
                        ordre=pos,
                        series=ex_data.get("series"),
                        repetitions=ex_data.get("reps"),
                        tempo_override=ex_data.get("tempo"),
                        pause_isometrique_override_sec=ex_data.get("pause_iso"),
                        duree_bloc_min=ex_data.get("duree_min"),
                    ))

    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# SchÃ©mas Pydantic
# ---------------------------------------------------------------------------

class ProfilFCSchema(BaseModel):
    fc_max: Optional[int] = Field(None, gt=0, lt=250)
    fc_repos: Optional[int] = Field(None, gt=0, lt=150)
    poids_kg: Optional[float] = Field(None, gt=0, lt=300)

@app.get("/api/utilisateur/profil-fc", summary="RÃ©cupÃ¨re fc_max, fc_repos et poids_kg de l'utilisateur")
def get_profil_fc(current_user: Utilisateur = Depends(get_current_user)):
    return {"fc_max": current_user.fc_max, "fc_repos": current_user.fc_repos, "poids_kg": current_user.poids_kg}

@app.patch("/api/utilisateur/profil-fc", summary="Met Ã  jour fc_max, fc_repos et/ou poids_kg")
def patch_profil_fc(payload: ProfilFCSchema, current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    if payload.fc_max is not None: current_user.fc_max = payload.fc_max
    if payload.fc_repos is not None: current_user.fc_repos = payload.fc_repos
    if payload.poids_kg is not None: current_user.poids_kg = payload.poids_kg
    db.commit()
    return {"fc_max": current_user.fc_max, "fc_repos": current_user.fc_repos, "poids_kg": current_user.poids_kg}


class PreferencesSchema(BaseModel):
    seances_muscu_semaine: Optional[int] = Field(None, ge=1, le=5)
    frequence_tests_semaines: Optional[int] = Field(None, ge=2, le=16)

@app.patch("/api/utilisateur/preferences", summary="Met Ã  jour les prÃ©fÃ©rences d'entraÃ®nement")
def patch_preferences(payload: PreferencesSchema, current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    if payload.seances_muscu_semaine is not None:
        current_user.seances_muscu_semaine = payload.seances_muscu_semaine
    if payload.frequence_tests_semaines is not None:
        current_user.frequence_tests_semaines = payload.frequence_tests_semaines
    db.commit()
    return {
        "seances_muscu_semaine": current_user.seances_muscu_semaine,
        "frequence_tests_semaines": current_user.frequence_tests_semaines,
    }

class ProfilInfosSchema(BaseModel):
    prenom: Optional[str] = None
    nom: Optional[str] = None
    email: Optional[str] = None
    sexe: Optional[str] = None
    date_naissance: Optional[str] = None  # "YYYY-MM-DD" ou null pour effacer
    poids_kg: Optional[float] = Field(None, gt=0, lt=300)

@app.patch("/api/utilisateur/infos", summary="Met Ã  jour les informations personnelles")
def patch_utilisateur_infos(
    payload: ProfilInfosSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    if payload.prenom is not None:
        current_user.prenom = payload.prenom
    if payload.nom is not None:
        current_user.nom = payload.nom
    if payload.email is not None:
        existing = db.query(Utilisateur).filter(
            Utilisateur.email == payload.email,
            Utilisateur.id != current_user.id,
        ).first()
        if existing:
            raise HTTPException(409, "Cet email est dÃ©jÃ  utilisÃ©")
        current_user.email = payload.email
    if payload.sexe is not None:
        current_user.sexe = payload.sexe
    if payload.poids_kg is not None:
        current_user.poids_kg = payload.poids_kg
    if "date_naissance" in payload.model_fields_set:
        if payload.date_naissance:
            try:
                current_user.date_naissance = date.fromisoformat(payload.date_naissance)
            except ValueError:
                raise HTTPException(400, "Format date invalide, attendu YYYY-MM-DD")
        else:
            current_user.date_naissance = None
    db.commit()
    return {"ok": True}


class PasswordChangeSchema(BaseModel):
    ancien_mot_de_passe: str
    nouveau_mot_de_passe: str = Field(min_length=8)

@app.patch("/api/utilisateur/password", summary="Change le mot de passe")
def patch_password(
    payload: PasswordChangeSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    if not _verify_password(payload.ancien_mot_de_passe, current_user.password_hash):
        raise HTTPException(400, "Mot de passe actuel incorrect")
    current_user.password_hash = _hash_password(payload.nouveau_mot_de_passe)
    db.commit()
    return {"ok": True}


@app.get("/api/utilisateur/preferences", summary="RÃ©cupÃ¨re les prÃ©fÃ©rences d'entraÃ®nement")
def get_preferences(current_user: Utilisateur = Depends(get_current_user)):
    return {
        "seances_muscu_semaine": current_user.seances_muscu_semaine or 2,
        "frequence_tests_semaines": current_user.frequence_tests_semaines or 8,
        "type_programme": current_user.type_programme,
        "objectif_type": current_user.objectif_type,
    }


class CreerEvaluationSchema(BaseModel):
    macrocycle_id: Optional[int] = None
    est_induction: bool = False
    notes: Optional[str] = None


class DemiCooperSchema(BaseModel):
    distance_metres: float = Field(..., gt=0, description="Distance parcourue en 6 minutes (mÃ¨tres)")
    conditions: Optional[str] = None
    fc_max: Optional[int] = Field(None, gt=0, lt=250)


class Max1MinSchema(BaseModel):
    exercice_id: int
    repetitions_realisees: int = Field(..., ge=0)
    notes: Optional[str] = None


class AMRAPBenchmarkSchema(BaseModel):
    tours_completes: float = Field(..., ge=0, description="Ex. 2.9 = 2 tours + 9 reps")
    total_reps: Optional[int] = None
    tractions_dernier_partiel: Optional[int] = None
    pompes_dernier_partiel: Optional[int] = None
    squats_dernier_partiel: Optional[int] = None
    dips_dernier_partiel: Optional[int] = None
    burpees_dernier_partiel: Optional[int] = None
    mountain_climbers_dernier_partiel: Optional[int] = None
    fc_moyenne_bpm: Optional[int] = None
    fc_max_bpm: Optional[int] = None
    notes: Optional[str] = None


class JournalSeanceSchema(BaseModel):
    utilisateur_id: Optional[int] = None  # ignorÃ© â€” on utilise current_user.id
    completee: bool = True
    rpe: Optional[float] = Field(None, ge=1, le=10)
    rpe_cible: Optional[float] = Field(None, ge=1, le=10)
    type_course: Optional[str] = None  # "route" | "trail"
    distance_reelle_km: Optional[float] = None
    distance_repos_km: Optional[float] = None  # récupération trottinée entre blocs
    duree_reelle_min: Optional[int] = None
    dplus_reel_m: Optional[int] = None
    fc_moyenne_bpm: Optional[int] = None
    fc_max_bpm: Optional[int] = None
    tours_amrap_completes: Optional[float] = None
    total_reps_enregistrees: Optional[int] = None
    notes: Optional[str] = None
    details_intervalles: Optional[str] = None  # JSON string


# ---------------------------------------------------------------------------
# Routes â€” Ã‰valuations
# ---------------------------------------------------------------------------

@app.delete("/api/evaluations/incompletes", summary="Supprime les Ã©valuations sans AMRAP ET sans Max 1 min")
def supprimer_evaluations_incompletes(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    evals = db.query(JournalEvaluationSeance).filter(JournalEvaluationSeance.utilisateur_id == current_user.id).all()
    supprimes = 0
    for ev in evals:
        if ev.benchmark_amrap is None and len(ev.resultats_max_1min) == 0:
            db.delete(ev)
            supprimes += 1
    db.commit()
    return {"supprimes": supprimes}


@app.delete("/api/evaluations/{evaluation_id}", summary="Supprimer une Ã©valuation")
def supprimer_evaluation(evaluation_id: int, current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    evaluation = db.get(JournalEvaluationSeance, evaluation_id)
    if not evaluation or evaluation.utilisateur_id != current_user.id:
        raise HTTPException(404, "Ã‰valuation introuvable")
    # Supprimer les biomÃ©tries crÃ©Ã©es par le Demi-Cooper de cette Ã©valuation
    if evaluation.demi_cooper and evaluation.demi_cooper.id_biometrie_instantanee:
        bio = db.get(BiometrieUtilisateur, evaluation.demi_cooper.id_biometrie_instantanee)
        if bio:
            db.delete(bio)
    db.delete(evaluation)
    db.commit()
    return {"supprime": evaluation_id}


class ModifierEvaluationSchema(BaseModel):
    distance_metres: Optional[float] = None
    amrap_tours: Optional[float] = None
    max_1min: Optional[list[dict]] = None  # [{"exercice_id": int, "repetitions": int}]

@app.patch("/api/evaluations/{evaluation_id}", summary="Modifier les donnÃ©es d'une Ã©valuation existante")
def modifier_evaluation(evaluation_id: int, payload: ModifierEvaluationSchema, db: Session = Depends(obtenir_session)):
    evaluation = db.get(JournalEvaluationSeance, evaluation_id)
    if not evaluation:
        raise HTTPException(404, "Ã‰valuation introuvable")

    if payload.distance_metres is not None:
        cooper = evaluation.demi_cooper
        if cooper:
            cooper.distance_metres = payload.distance_metres
            cooper.vma_calculee_kmh = ResultatDemiCooper.calculer_vma(payload.distance_metres)
            # Met Ã  jour la biomÃ©trie liÃ©e
            bio = (
                db.query(BiometrieUtilisateur)
                .filter(BiometrieUtilisateur.utilisateur_id == evaluation.utilisateur_id)
                .filter(BiometrieUtilisateur.enregistre_le >= evaluation.evalue_le)
                .order_by(BiometrieUtilisateur.enregistre_le.asc())
                .first()
            )
            if bio:
                bio.vma_kmh = cooper.vma_calculee_kmh

    if payload.amrap_tours is not None:
        amrap = evaluation.benchmark_amrap
        if amrap:
            amrap.tours_completes = payload.amrap_tours

    if payload.max_1min is not None:
        for item in payload.max_1min:
            r = db.query(ResultatMax1Min).filter(
                ResultatMax1Min.evaluation_id == evaluation_id,
                ResultatMax1Min.exercice_id == item["exercice_id"],
            ).first()
            if r:
                r.repetitions_realisees = item["repetitions"]

    db.commit()
    return {"ok": True}


@app.get("/api/evaluations/historique", summary="Historique des Ã©valuations passÃ©es")
def historique_evaluations(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    evals = (
        db.query(JournalEvaluationSeance)
        .filter(JournalEvaluationSeance.utilisateur_id == current_user.id)
        .order_by(JournalEvaluationSeance.evalue_le.desc())
        .all()
    )
    result = []
    for ev in evals:
        cooper = ev.demi_cooper
        amrap = ev.benchmark_amrap
        max1min = ev.resultats_max_1min
        result.append({
            "id": ev.id,
            "date": str(ev.evalue_le)[:10],
            "est_induction": ev.est_induction,
            "vma_kmh": cooper.vma_calculee_kmh if cooper else None,
            "distance_m": cooper.distance_metres if cooper else None,
            "amrap_tours": amrap.tours_completes if amrap else None,
            "max_1min": [
                {"nom": r.exercice.nom, "reps": r.repetitions_realisees, "exercice_id": r.exercice_id}
                for r in sorted(max1min, key=lambda x: x.exercice_id)
            ],
        })
    return {"evaluations": result}


@app.post("/api/evaluations/", summary="CrÃ©er une session d'Ã©valuation")
def creer_evaluation(payload: CreerEvaluationSchema, current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    evaluation = JournalEvaluationSeance(
        utilisateur_id=current_user.id,
        macrocycle_id=payload.macrocycle_id,
        est_induction=payload.est_induction,
        notes=payload.notes,
    )
    db.add(evaluation)
    db.commit()
    db.refresh(evaluation)
    return {"id": evaluation.id, "evalue_le": str(evaluation.evalue_le)}


@app.post(
    "/api/evaluations/{evaluation_id}/demi-cooper",
    summary="Enregistrer un rÃ©sultat Demi-Cooper et recalculer la VMA",
)
def enregistrer_demi_cooper(
    evaluation_id: int,
    payload: DemiCooperSchema,
    db: Session = Depends(obtenir_session),
):
    evaluation = db.get(JournalEvaluationSeance, evaluation_id)
    if not evaluation:
        raise HTTPException(404, "Ã‰valuation introuvable")

    vma = ResultatDemiCooper.calculer_vma(payload.distance_metres)

    # CrÃ©er le snapshot biomÃ©trique avec toutes les zones recalculÃ©es
    biometrie = BiometrieUtilisateur.depuis_demi_cooper(
        utilisateur_id=evaluation.utilisateur_id,
        distance_metres=payload.distance_metres,
        fc_max=payload.fc_max,
    )
    db.add(biometrie)
    db.flush()  # obtenir l'id avant de le rÃ©fÃ©rencer

    resultat = ResultatDemiCooper(
        evaluation_id=evaluation_id,
        distance_metres=payload.distance_metres,
        vma_calculee_kmh=vma,
        conditions=payload.conditions,
        id_biometrie_instantanee=biometrie.id,
    )
    db.add(resultat)
    db.commit()
    db.refresh(biometrie)

    return {
        "vma_kmh": vma,
        "biometrie_id": biometrie.id,
        "zones": {
            "Z1": {"min": biometrie.z1_min_kmh, "max": biometrie.z1_max_kmh},
            "Z2": {"min": biometrie.z2_min_kmh, "max": biometrie.z2_max_kmh},
            "Z3": {"min": biometrie.z3_min_kmh, "max": biometrie.z3_max_kmh},
            "Z4": {"min": biometrie.z4_min_kmh, "max": biometrie.z4_max_kmh},
            "Z5": {"min": biometrie.z5_min_kmh, "max": biometrie.z5_max_kmh},
        },
    }


@app.post(
    "/api/evaluations/{evaluation_id}/max-1min",
    summary="Enregistrer les scores Max RÃ©pÃ©titions 1 Minute",
)
def enregistrer_max_1min(
    evaluation_id: int,
    payload: list[Max1MinSchema],
    db: Session = Depends(obtenir_session),
):
    evaluation = db.get(JournalEvaluationSeance, evaluation_id)
    if not evaluation:
        raise HTTPException(404, "Ã‰valuation introuvable")

    resultats = []
    for item in payload:
        r = ResultatMax1Min(
            evaluation_id=evaluation_id,
            exercice_id=item.exercice_id,
            repetitions_realisees=item.repetitions_realisees,
            notes=item.notes,
        )
        db.add(r)
        resultats.append({"exercice_id": item.exercice_id, "repetitions": item.repetitions_realisees})

    db.commit()
    return {"enregistres": len(resultats), "resultats": resultats}


@app.post(
    "/api/evaluations/{evaluation_id}/amrap-benchmark",
    summary="Enregistrer le score AMRAP Benchmark 10 minutes",
)
def enregistrer_amrap_benchmark(
    evaluation_id: int,
    payload: AMRAPBenchmarkSchema,
    db: Session = Depends(obtenir_session),
):
    evaluation = db.get(JournalEvaluationSeance, evaluation_id)
    if not evaluation:
        raise HTTPException(404, "Ã‰valuation introuvable")

    benchmark = ResultatAMRAPBenchmark(
        evaluation_id=evaluation_id,
        tours_completes=payload.tours_completes,
        total_reps=payload.total_reps,
        tractions_dernier_partiel=payload.tractions_dernier_partiel,
        pompes_dernier_partiel=payload.pompes_dernier_partiel,
        squats_dernier_partiel=payload.squats_dernier_partiel,
        dips_dernier_partiel=payload.dips_dernier_partiel,
        burpees_dernier_partiel=payload.burpees_dernier_partiel,
        mountain_climbers_dernier_partiel=payload.mountain_climbers_dernier_partiel,
        fc_moyenne_bpm=payload.fc_moyenne_bpm,
        fc_max_bpm=payload.fc_max_bpm,
        notes=payload.notes,
    )
    db.add(benchmark)
    db.commit()
    db.refresh(benchmark)
    return {"id": benchmark.id, "tours_completes": benchmark.tours_completes}


# ---------------------------------------------------------------------------
# Routes â€” Journalisation des sÃ©ances
# ---------------------------------------------------------------------------

@app.post(
    "/api/seances/{seance_id}/journal",
    summary="Journaliser une sÃ©ance complÃ©tÃ©e",
)
def journaliser_seance(
    seance_id: int,
    payload: JournalSeanceSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    seance = db.get(SeanceEntrainement, seance_id)
    if not seance:
        raise HTTPException(404, "SÃ©ance introuvable")

    if seance.journal:
        raise HTTPException(409, "Journal dÃ©jÃ  crÃ©Ã© pour cette sÃ©ance â€” utilisez PATCH")

    # RPE cible automatique depuis la zone de la séance si non fourni
    _RPE_PAR_ZONE = {"Z1": 5.0, "Z2": 6.0, "Z3": 7.0, "Z4": 8.0, "Z5": 9.0}
    rpe_cible_final = payload.rpe_cible
    if rpe_cible_final is None and seance.zone_cible:
        rpe_cible_final = _RPE_PAR_ZONE.get(seance.zone_cible.value)

    # Calcul automatique distance_reelle_km pour séances fractionnées
    distance_km = payload.distance_reelle_km
    if distance_km is None and payload.details_intervalles:
        try:
            import json as _json
            blocs = _json.loads(payload.details_intervalles)
            distance_km = sum(b.get("distance_km") or 0 for b in blocs)
            if payload.distance_repos_km:
                distance_km += payload.distance_repos_km
            distance_km = round(distance_km, 3) if distance_km else None
        except Exception:
            pass

    journal = JournalSeance(
        utilisateur_id=current_user.id,
        seance_id=seance_id,
        completee=payload.completee,
        rpe=payload.rpe,
        rpe_cible=rpe_cible_final,
        type_course=payload.type_course or current_user.type_course,
        distance_reelle_km=distance_km,
        distance_repos_km=round(payload.distance_repos_km, 2) if payload.distance_repos_km is not None else None,
        duree_reelle_min=payload.duree_reelle_min,
        dplus_reel_m=payload.dplus_reel_m,
        fc_moyenne_bpm=payload.fc_moyenne_bpm,
        fc_max_bpm=payload.fc_max_bpm,
        tours_amrap_completes=payload.tours_amrap_completes,
        total_reps_enregistrees=payload.total_reps_enregistrees,
        notes=payload.notes,
        details_intervalles=payload.details_intervalles,
    )
    db.add(journal)
    db.commit()
    db.refresh(journal)
    conseil = _conseil_recuperation(payload.rpe) if payload.rpe and payload.completee else None
    return {"id": journal.id, "enregistre_le": str(journal.enregistre_le), "conseil_recuperation": conseil}


class PrefillSeanceSchema(BaseModel):
    utilisateur_id: int = 1
    duree_reelle_min: Optional[int] = None
    distance_reelle_km: Optional[float] = None
    dplus_reel_m: Optional[int] = None
    fc_moyenne_bpm: Optional[int] = None
    fc_max_bpm: Optional[int] = None


@app.post(
    "/api/seances/{seance_id}/journal/prefill",
    summary="PrÃ©-remplit les mÃ©triques physiques â€” en attente du RPE",
)
def prefill_seance(
    seance_id: int,
    payload: PrefillSeanceSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    seance = db.get(SeanceEntrainement, seance_id)
    if not seance:
        raise HTTPException(404, "SÃ©ance introuvable")

    existing = seance.journal
    if existing:
        existing.duree_reelle_min = payload.duree_reelle_min
        existing.distance_reelle_km = payload.distance_reelle_km
        existing.dplus_reel_m = payload.dplus_reel_m
        existing.fc_moyenne_bpm = payload.fc_moyenne_bpm
        existing.fc_max_bpm = payload.fc_max_bpm
        existing.completee = False
    else:
        journal = JournalSeance(
            utilisateur_id=current_user.id,
            seance_id=seance_id,
            completee=False,
            duree_reelle_min=payload.duree_reelle_min,
            distance_reelle_km=payload.distance_reelle_km,
            dplus_reel_m=payload.dplus_reel_m,
            fc_moyenne_bpm=payload.fc_moyenne_bpm,
            fc_max_bpm=payload.fc_max_bpm,
        )
        db.add(journal)
    db.commit()
    return {"ok": True}


class ValiderRPESchema(BaseModel):
    rpe: float = Field(..., ge=1, le=10)
    notes: Optional[str] = None


def _conseil_recuperation(rpe: float) -> dict:
    r = int(round(rpe))
    if r <= 4:
        return {"niveau": "facile", "titre": "RÃ©cupÃ©ration standard",
                "conseil": "Belle sÃ©ance lÃ©gÃ¨re ! Hydratation normale et 7-8h de sommeil suffisent."}
    elif r <= 6:
        return {"niveau": "modere", "titre": "RÃ©cupÃ©ration classique",
                "conseil": "Ã‰tirements 10 min ce soir. Dors 8h et bois au moins 2L d'eau."}
    elif r <= 8:
        return {"niveau": "intense", "titre": "RÃ©cupÃ©ration active",
                "conseil": "ProtÃ©ines dans les 30 min (20-30 g). Ã‰tirements + foam roller. Vise 8-9h de sommeil."}
    elif r == 9:
        return {"niveau": "tres_intense", "titre": "RÃ©cupÃ©ration prioritaire",
                "conseil": "Repos actif ou complet demain. Jambes surÃ©levÃ©es 15 min. Minimum 9h de sommeil."}
    else:
        return {"niveau": "depassement", "titre": "Repos obligatoire",
                "conseil": "2 jours de repos minimum. Alimentation anti-inflammatoire. Consulte un mÃ©decin si douleurs persistantes."}


@app.patch(
    "/api/seances/{seance_id}/journal/valider",
    summary="Finalise la sÃ©ance avec le RPE â€” marque completee=True",
)
def valider_rpe(
    seance_id: int,
    payload: ValiderRPESchema,
    db: Session = Depends(obtenir_session),
):
    seance = db.get(SeanceEntrainement, seance_id)
    if not seance or not seance.journal:
        raise HTTPException(404, "Journal introuvable â€” lance d'abord un prefill")
    seance.journal.rpe = payload.rpe
    seance.journal.notes = payload.notes
    seance.journal.completee = True
    db.commit()
    return {"ok": True, "conseil_recuperation": _conseil_recuperation(payload.rpe)}


@app.delete(
    "/api/seances/{seance_id}/journal",
    summary="Supprime le journal d'une sÃ©ance (annule la validation)",
)
def supprimer_journal_seance(
    seance_id: int,
    db: Session = Depends(obtenir_session),
):
    seance = db.get(SeanceEntrainement, seance_id)
    if not seance or not seance.journal:
        raise HTTPException(404, "Journal introuvable")
    db.delete(seance.journal)
    db.commit()
    return {"ok": True}


class PlanifierSchema(BaseModel):
    date_planifiee: Optional[str] = None   # "YYYY-MM-DD" ou null pour annuler
    heure_planifiee: Optional[str] = None  # "HH:MM" ou null


@app.patch("/api/seances/{seance_id}/planifier", summary="Planifie ou dÃ©planifie une sÃ©ance")
def planifier_seance(
    seance_id: int,
    payload: PlanifierSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    seance = db.get(SeanceEntrainement, seance_id)
    if not seance:
        raise HTTPException(404, "SÃ©ance introuvable")
    seance.date_planifiee = date.fromisoformat(payload.date_planifiee) if payload.date_planifiee else None
    seance.heure_planifiee = payload.heure_planifiee or None
    db.commit()
    _planifier_notification(seance.id, seance.date_planifiee, seance.heure_planifiee)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Push notifications
# ---------------------------------------------------------------------------

class PushSubscribeSchema(BaseModel):
    endpoint: str
    p256dh: str
    auth: str


@app.get("/api/push/vapid-public-key", summary="Retourne la clÃ© publique VAPID")
def get_vapid_public_key():
    return {"publicKey": _VAPID_PUBLIC}


@app.post("/api/push/subscribe", summary="Enregistre un endpoint push")
def push_subscribe(
    payload: PushSubscribeSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    sub = db.query(PushSubscription).filter_by(endpoint=payload.endpoint).first()
    if sub:
        sub.p256dh = payload.p256dh
        sub.auth   = payload.auth
        sub.utilisateur_id = current_user.id
    else:
        sub = PushSubscription(
            utilisateur_id=current_user.id,
            endpoint=payload.endpoint,
            p256dh=payload.p256dh,
            auth=payload.auth,
        )
        db.add(sub)
    db.commit()
    return {"ok": True}


@app.delete("/api/push/unsubscribe", summary="Supprime un endpoint push")
def push_unsubscribe(
    payload: PushSubscribeSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    sub = db.query(PushSubscription).filter_by(
        endpoint=payload.endpoint, utilisateur_id=current_user.id
    ).first()
    if sub:
        db.delete(sub)
        db.commit()
    return {"ok": True}



@app.post("/api/push/test", summary="Envoie une notification push de test Ã  l'utilisateur connectÃ©")
def push_test(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    if not _PUSH_ENABLED or not _VAPID_PRIVATE:
        raise HTTPException(503, "Push non configurÃ© sur ce serveur")
    subs = db.query(PushSubscription).filter_by(utilisateur_id=current_user.id).all()
    if not subs:
        raise HTTPException(404, "Aucun abonnement push enregistrÃ© pour cet utilisateur")
    import json as _json
    payload = _json.dumps({
        "title": "Coach EPC â€” Test ðŸ””",
        "body": "Les notifications push fonctionnent correctement !",
        "tag": "test-push",
        "url": "/profil",
    })
    sent = 0
    errors = []
    for sub in subs:
        try:
            webpush(
                subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                data=payload,
                vapid_private_key=_VAPID_PRIVATE,
                vapid_claims={"sub": _VAPID_EMAIL},
            )
            sent += 1
        except WebPushException as e:
            errors.append(f"WebPushException: {e}")
            db.delete(sub)
        except Exception as e:
            errors.append(f"{type(e).__name__}: {e}")
    db.commit()
    if sent == 0:
        raise HTTPException(500, detail={"errors": errors, "subs_count": len(subs)})
    return {"ok": True, "sent": sent, "errors": errors}


@app.patch(
    "/api/seances/{seance_id}/journal",
    summary="Modifie les donnÃ©es d'un journal existant",
)
def modifier_journal_seance(
    seance_id: int,
    payload: JournalSeanceSchema,
    db: Session = Depends(obtenir_session),
):
    seance = db.get(SeanceEntrainement, seance_id)
    if not seance or not seance.journal:
        raise HTTPException(404, "Journal introuvable")
    j = seance.journal
    if payload.type_course is not None: j.type_course = payload.type_course
    if payload.rpe is not None: j.rpe = payload.rpe
    if payload.notes is not None: j.notes = payload.notes
    if payload.duree_reelle_min is not None: j.duree_reelle_min = payload.duree_reelle_min
    if payload.dplus_reel_m is not None: j.dplus_reel_m = payload.dplus_reel_m
    if payload.fc_moyenne_bpm is not None: j.fc_moyenne_bpm = payload.fc_moyenne_bpm
    if payload.fc_max_bpm is not None: j.fc_max_bpm = payload.fc_max_bpm
    if payload.distance_repos_km is not None:
        j.distance_repos_km = round(payload.distance_repos_km, 2)
    if payload.details_intervalles is not None:
        j.details_intervalles = payload.details_intervalles
        # Recalculer distance_reelle_km depuis les blocs si non fournie explicitement
        if payload.distance_reelle_km is None:
            try:
                import json as _json
                blocs = _json.loads(payload.details_intervalles)
                total = sum(b.get("distance_km") or 0 for b in blocs)
                repos = payload.distance_repos_km if payload.distance_repos_km is not None else (j.distance_repos_km or 0)
                total += repos
                if total > 0:
                    j.distance_reelle_km = round(total, 3)
            except Exception:
                pass
    if payload.distance_reelle_km is not None:
        j.distance_reelle_km = payload.distance_reelle_km
    j.completee = True
    db.commit()
    return {"ok": True}


def _extraire_metriques_forme(texte: str) -> dict:
    """Parse le texte OCR d'un screenshot de l'app Forme (Apple Watch)."""
    metriques = {}

    # DurÃ©e â€” ex. "40:00" ou "1:05:30"
    m = re.search(r"\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b", texte)
    if m:
        if m.group(3):
            metriques["duree_reelle_min"] = int(m.group(1)) * 60 + int(m.group(2))
        else:
            metriques["duree_reelle_min"] = int(m.group(1)) * 60 + int(m.group(2))
            # Si format MM:SS et durÃ©e < 10 min, probablement des secondes
            if metriques["duree_reelle_min"] < 10:
                metriques["duree_reelle_min"] = int(m.group(1))

    # Distance â€” ex. "6,19 KM" ou "6.19 KM"
    m = re.search(r"([\d][,\.][\d]+|\d+)\s*K[Mm]", texte)
    if m:
        metriques["distance_reelle_km"] = float(m.group(1).replace(",", "."))

    # DÃ©nivelÃ© â€” ex. "DÃ©nivelÃ© : 19 M" ou "19 m"
    m = re.search(r"[Dd][Ã©e]niv[eÃ©]l[eÃ©]\s*:?\s*(\d+)\s*[Mm]", texte)
    if m:
        metriques["dplus_reel_m"] = int(m.group(1))

    # FC moyenne â€” ex. "Moyenne : 153 BPM" (la premiÃ¨re occurrence)
    matches_bpm = re.findall(r"[Mm]oyenne\s*:?\s*(\d+)\s*[Bb][Pp][Mm]", texte)
    if matches_bpm:
        metriques["fc_moyenne_bpm"] = int(matches_bpm[0])

    # FC max â€” ex. "89â€“165 BPM" ou "89-165 BPM"
    m = re.search(r"(\d+)\s*[â€“-]\s*(\d+)\s*[Bb][Pp][Mm]", texte)
    if m:
        metriques["fc_max_bpm"] = int(m.group(2))

    return metriques


@app.post(
    "/api/seances/{seance_id}/journal/analyse-screenshot",
    summary="Analyse un screenshot Forme via OCR et prÃ©-remplit les mÃ©triques",
)
async def analyser_screenshot(
    seance_id: int,
    utilisateur_id: int = Query(1),
    file: UploadFile = File(...),
    db: Session = Depends(obtenir_session),
):
    from PIL import Image
    from rapidocr_onnxruntime import RapidOCR

    seance = db.get(SeanceEntrainement, seance_id)
    if not seance:
        raise HTTPException(404, "SÃ©ance introuvable")

    contenu = await file.read()
    try:
        image = Image.open(io.BytesIO(contenu)).convert("RGB")
        import numpy as np
        arr = np.array(image)
        ocr = RapidOCR()
        result, _ = ocr(arr)
        texte = "\n".join(r[1] for r in result) if result else ""
    except Exception as exc:
        raise HTTPException(500, f"OCR Ã©chouÃ© : {exc}")

    metriques = _extraire_metriques_forme(texte)
    if not metriques:
        raise HTTPException(422, f"Aucune mÃ©trique dÃ©tectÃ©e. Texte extrait : {texte[:300]!r}")

    existing = seance.journal
    if existing:
        for k, v in metriques.items():
            setattr(existing, k, v)
        existing.completee = False
    else:
        journal = JournalSeance(
            utilisateur_id=utilisateur_id,
            seance_id=seance_id,
            completee=False,
            **metriques,
        )
        db.add(journal)
    db.commit()
    return {"ok": True, "metriques": metriques}


# ---------------------------------------------------------------------------
# Routes â€” Semaine courante
# ---------------------------------------------------------------------------

@app.get("/api/semaine-courante", summary="Retourne les sÃ©ances de la semaine en cours")
def semaine_courante(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    aujourd_hui = date.today()

    semaine = (
        db.query(SemaineEntrainement)
        .join(Macrocycle)
        .filter(
            Macrocycle.utilisateur_id == current_user.id,
            SemaineEntrainement.date_debut <= aujourd_hui,
            SemaineEntrainement.date_debut + timedelta(days=7) > aujourd_hui,
        )
        .first()
    )

    if not semaine:
        # Retourne la prochaine semaine Ã  venir si aucune en cours
        semaine = (
            db.query(SemaineEntrainement)
            .join(Macrocycle)
            .filter(
                Macrocycle.utilisateur_id == current_user.id,
                SemaineEntrainement.date_debut > aujourd_hui,
            )
            .order_by(SemaineEntrainement.date_debut)
            .first()
        )

    if not semaine:
        raise HTTPException(404, "Aucune semaine trouvÃ©e")

    mc = semaine.macrocycle
    return {
        "semaine_id": semaine.id,
        "numero_semaine": semaine.numero_semaine,
        "macrophase": semaine.macrophase.value,
        "date_debut": str(semaine.date_debut),
        "macrocycle": {
            "id": mc.id,
            "numero_cycle": mc.numero_cycle,
            "nom": {1: "Module 1 â€” Adaptation", 2: "Module 2 â€” RÃ©vÃ©lation", 3: "Module 3 â€” Confirmation"}.get(mc.numero_cycle, f"Module {mc.numero_cycle}"),
        },
        "seances": [
            {
                "id": s.id,
                "type": s.type_seance.value,
                "titre": s.titre,
                "date": str(s.date_seance),
                "zone_cible": s.zone_cible.value if s.zone_cible else None,
                "duree_cible_min": s.duree_cible_min,
                "dplus_cible_m": s.dplus_cible_m,
                "temps_limite_min": s.temps_limite_min,
                "description": s.description,
                "exercices": [
                    {
                        "nom": ex.nom_affichage if ex.exercice_id is None else ex.exercice.nom,
                        "series": ex.series,
                        "repetitions": ex.repetitions,
                        "duree_sec": ex.duree_sec,
                        "tempo": ex.tempo_effectif,
                        "duree_bloc_min": ex.duree_bloc_min,
                    }
                    for ex in s.exercices
                ],
                "date_planifiee": str(s.date_planifiee) if s.date_planifiee else None,
                "heure_planifiee": s.heure_planifiee,
                "journal": {
                    "completee": s.journal.completee,
                    "rpe": s.journal.rpe,
                    "notes": s.journal.notes,
                    "duree_reelle_min": s.journal.duree_reelle_min,
                    "distance_reelle_km": s.journal.distance_reelle_km,
                    "distance_repos_km": s.journal.distance_repos_km,
                    "dplus_reel_m": s.journal.dplus_reel_m,
                    "fc_moyenne_bpm": s.journal.fc_moyenne_bpm,
                    "details_intervalles": s.journal.details_intervalles,
                } if s.journal else None,
            }
            for s in sorted(semaine.seances, key=lambda x: x.date_seance)
        ],
    }


# ---------------------------------------------------------------------------
# Routes â€” Macrocycles
# ---------------------------------------------------------------------------

@app.get(
    "/api/macrocycles/{macrocycle_id}/semaines",
    summary="RÃ©cupÃ©rer les semaines d'un macrocycle avec leurs sÃ©ances",
)
def obtenir_semaines_macrocycle(
    macrocycle_id: int,
    db: Session = Depends(obtenir_session),
):
    macrocycle = db.get(Macrocycle, macrocycle_id)
    if not macrocycle:
        raise HTTPException(404, "Macrocycle introuvable")

    return {
        "macrocycle_id": macrocycle_id,
        "numero_cycle": macrocycle.numero_cycle,
        "date_debut": str(macrocycle.date_debut),
        "date_fin": str(macrocycle.date_fin),
        "semaines": [
            {
                "numero_semaine": s.numero_semaine,
                "macrophase": s.macrophase.value,
                "date_debut": str(s.date_debut),
                "multiplicateur_volume": s.multiplicateur_volume,
                "objectif_km_course": s.objectif_km_course,
                "objectif_amrap_min": s.objectif_amrap_min,
                "seances": [
                    {
                        "id": seance.id,
                        "type": seance.type_seance.value,
                        "titre": seance.titre,
                        "description": seance.description,
                        "date": str(seance.date_seance),
                        "zone_cible": seance.zone_cible.value if seance.zone_cible else None,
                        "distance_cible_km": seance.distance_cible_km,
                        "duree_cible_min": seance.duree_cible_min,
                        "dplus_cible_m": seance.dplus_cible_m,
                        "temps_limite_min": seance.temps_limite_min,
                        "exercices": [
                            {
                                "nom": ex.nom_affichage if ex.exercice_id is None else ex.exercice.nom,
                                "slug": None if ex.exercice_id is None else ex.exercice.slug,
                                "series": ex.series,
                                "repetitions": ex.repetitions,
                                "duree_sec": ex.duree_sec,
                                "tempo": ex.tempo_effectif,
                                "duree_bloc_min": ex.duree_bloc_min,
                            }
                            for ex in seance.exercices
                        ],
                    }
                    for seance in s.seances
                ],
            }
            for s in macrocycle.semaines
        ],
    }


# ---------------------------------------------------------------------------
# Routes â€” Analytique
# ---------------------------------------------------------------------------

@app.get(
    "/api/analytics/tendances-physiologiques",
    summary="Ã‰volution VMA et scores Max 1 min au fil des macrocycles",
)
def tendances_physiologiques(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.tendances_physiologiques(db, current_user.id)


@app.get(
    "/api/analytics/distribution-volume",
    summary="KilomÃ©trage hebdomadaire, D+ cumulÃ© et rÃ©partition musculaire Push/Pull/Jambes",
)
def distribution_volume(
    macrocycle_id: Optional[int] = Query(None),
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.distribution_volume(db, current_user.id, macrocycle_id)


@app.get(
    "/api/analytics/biometrie-recuperation",
    summary="Tendance RPE et Ratio Charge AiguÃ«/Chronique (ACWA) avec alerte risque blessure",
)
def biometrie_recuperation(
    macrocycle_id: Optional[int] = Query(None),
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.biometrie_recuperation(db, current_user.id, macrocycle_id)


@app.get("/api/analytics/zones-fc", summary="Minutes par zone FC et par semaine")
def zones_fc_hebdo(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.zones_fc_hebdo(db, current_user.id)


@app.get("/api/analytics/allure-endurance", summary="Progression de l'allure des sorties Z1/Z2")
def allure_endurance(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.allure_endurance(db, current_user.id)


@app.get("/api/analytics/prediction-course", summary="Temps prédit sur l'objectif pour chaque test VMA")
def prediction_course(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.prediction_course(db, current_user.id)


@app.get("/api/analytics/records", summary="Records personnels et jalons")
def records_personnels(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.records_personnels(db, current_user.id)


@app.get("/api/analytics/semaine-en-cours", summary="Progression prévu vs réalisé de la semaine en cours")
def semaine_en_cours(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.semaine_en_cours(db, current_user.id)


@app.get("/api/analytics/resume-hebdo", summary="Bilan de la dernière semaine terminée")
def resume_hebdo(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.resume_hebdo(db, current_user.id)


@app.get("/api/analytics/evenements", summary="Tests et courses mappés sur les semaines (annotations graphiques)")
def evenements_analytics(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.evenements(db, current_user.id)


@app.get("/api/analytics/semaine/{numero_semaine}/seances", summary="Détail des séances d'une semaine")
def seances_semaine_analytics(
    numero_semaine: int,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.seances_semaine(db, current_user.id, numero_semaine)


# ---------------------------------------------------------------------------
# Exercices
# ---------------------------------------------------------------------------

SLUGS_EVALUATION = [
    "traction-stricte",
    "dip-parallettes",
    "pompe-standard",
    "abdominal-crunch",
    "squat-bw",
    "pistol-squat-gauche",
    "pistol-squat-droit",
]

@app.get("/api/programme/toutes-semaines", summary="Toutes les semaines du programme â€” vue Ã  plat sans notion de module")
def toutes_semaines_programme(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    user = current_user
    mcs = db.query(Macrocycle).filter(Macrocycle.utilisateur_id == user.id).order_by(Macrocycle.numero_cycle).all()

    # Correction automatique du nombre de sÃ©ances par semaine (bulk SQL)
    try:
        n_muscu = user.seances_muscu_semaine or 2
        seances_total = user.seances_semaine or 5
        n_course = user.seances_course_semaine if user.seances_course_semaine is not None else max(1, seances_total - n_muscu)
        n_course = min(n_course, max(1, seances_total - n_muscu))
        total_muscu_target = seances_total - n_course
        muscu_types = {TypeSeance.EMOM, TypeSeance.AMRAP, TypeSeance.GYM_UPPER, TypeSeance.GYM_LOWER, TypeSeance.GYM_FULL}
        ids_a_supprimer: list[int] = []
        for mc in mcs:
            sems = db.query(SemaineEntrainement).filter(SemaineEntrainement.macrocycle_id == mc.id).all()
            for sem in sems:
                seances_sem = (
                    db.query(SeanceEntrainement)
                    .outerjoin(JournalSeance, JournalSeance.seance_id == SeanceEntrainement.id)
                    .filter(SeanceEntrainement.semaine_id == sem.id, JournalSeance.id.is_(None))
                    .all()
                )
                courses_nv = sorted([s for s in seances_sem if s.type_seance == TypeSeance.COURSE], key=lambda s: s.date_seance)
                muscu_nv = sorted([s for s in seances_sem if s.type_seance in muscu_types], key=lambda s: (0 if "3e" in (s.titre or "") else 1))
                while len(courses_nv) > n_course:
                    ids_a_supprimer.append(courses_nv.pop(0).id)
                while len(muscu_nv) > total_muscu_target:
                    ids_a_supprimer.append(muscu_nv.pop(0).id)
        if ids_a_supprimer:
            db.query(ExerciceSeance).filter(ExerciceSeance.seance_id.in_(ids_a_supprimer)).delete(synchronize_session=False)
            db.query(SeanceEntrainement).filter(SeanceEntrainement.id.in_(ids_a_supprimer)).delete(synchronize_session=False)
            db.commit()
            db.expire_all()
    except Exception as _e:
        db.rollback()

    semaine_globale = 0
    result = []
    for mc in mcs:
        for s in sorted(mc.semaines, key=lambda x: x.numero_semaine):
            semaine_globale += 1
            result.append({
                "semaine_globale": semaine_globale,
                "macrocycle_id": mc.id,
                "numero_semaine": s.numero_semaine,
                "macrophase": s.macrophase.value,
                "date_debut": str(s.date_debut),
                "multiplicateur_volume": s.multiplicateur_volume,
                "seances": [
                    {
                        "id": seance.id,
                        "type": seance.type_seance.value,
                        "titre": seance.titre,
                        "description": seance.description,
                        "date": str(seance.date_seance),
                        "zone_cible": seance.zone_cible.value if seance.zone_cible else None,
                        "distance_cible_km": seance.distance_cible_km,
                        "duree_cible_min": seance.duree_cible_min,
                        "dplus_cible_m": seance.dplus_cible_m,
                        "temps_limite_min": seance.temps_limite_min,
                        "exercices": [
                            {
                                "nom": ex.nom_affichage if ex.exercice_id is None else ex.exercice.nom,
                                "slug": None if ex.exercice_id is None else ex.exercice.slug,
                                "series": ex.series,
                                "repetitions": ex.repetitions,
                                "duree_sec": ex.duree_sec,
                                "tempo": ex.tempo_effectif,
                                "duree_bloc_min": ex.duree_bloc_min,
                            }
                            for ex in seance.exercices
                        ],
                        "date_planifiee": str(seance.date_planifiee) if seance.date_planifiee else None,
                        "heure_planifiee": seance.heure_planifiee,
                        "journal": {
                            "completee": seance.journal.completee,
                            "enregistre_le": seance.journal.enregistre_le.strftime("%Y-%m-%d") if seance.journal.enregistre_le else None,
                            "rpe": seance.journal.rpe,
                            "notes": seance.journal.notes,
                            "duree_reelle_min": seance.journal.duree_reelle_min,
                            "distance_reelle_km": seance.journal.distance_reelle_km,
                            "dplus_reel_m": seance.journal.dplus_reel_m,
                            "fc_moyenne_bpm": seance.journal.fc_moyenne_bpm,
                            "fc_max_bpm": seance.journal.fc_max_bpm,
                            "details_intervalles": seance.journal.details_intervalles,
                            "distance_repos_km": seance.journal.distance_repos_km,
                        } if seance.journal else None,
                    }
                    for seance in s.seances
                ],
            })
    return {"semaines": result, "total": semaine_globale}


@app.get("/api/macrocycles", summary="Liste tous les macrocycles de l'utilisateur")
def lister_macrocycles(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    mcs = db.query(Macrocycle).filter(Macrocycle.utilisateur_id == current_user.id).order_by(Macrocycle.numero_cycle).all()
    return [
        {
            "id": mc.id,
            "numero_cycle": mc.numero_cycle,
            "date_debut": str(mc.date_debut),
            "date_fin": str(mc.date_fin),
            "nom": {1: "Module 1 â€” Adaptation", 2: "Module 2 â€” RÃ©vÃ©lation", 3: "Module 3 â€” Confirmation"}.get(mc.numero_cycle, f"Module {mc.numero_cycle}"),
        }
        for mc in mcs
    ]


@app.post("/api/admin/seed-seances", summary="GÃ©nÃ¨re toutes les sÃ©ances des 16 semaines EPC (2 macrocycles)")
def seed_seances_route(db: Session = Depends(obtenir_session)):
    from seed_seances import seed_module1, seed_module2, seed_module3
    try:
        seed_module1()
        seed_module2()
        seed_module3()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erreur seed : {exc}")
    return {"message": "Seed terminÃ©."}


@app.post("/api/admin/init-macrocycles", summary="CrÃ©e les 2 macrocycles si absents (pour utilisateurs existants)")
def init_macrocycles(utilisateur_id: int = Query(1), db: Session = Depends(obtenir_session)):
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


@app.post("/api/admin/reseed", summary="RÃ©insÃ¨re les exercices par dÃ©faut")
def reseed(db: Session = Depends(obtenir_session)):
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


@app.get("/api/exercices/evaluation", summary="Liste des exercices du protocole Max 1 min")
def exercices_evaluation(db: Session = Depends(obtenir_session)):
    exercices = (
        db.query(VariationExercice)
        .filter(VariationExercice.slug.in_(SLUGS_EVALUATION))
        .order_by(VariationExercice.id)
        .all()
    )
    return [
        {"id": e.id, "nom": e.nom, "slug": e.slug}
        for e in exercices
    ]


# ---------------------------------------------------------------------------
# Objectif course â€” race goal
# ---------------------------------------------------------------------------

class ObjectifCourseSchema(BaseModel):
    nom: str
    date_course: str  # dd/mm/yyyy
    distance_km: float
    dplus_m: Optional[int] = 0
    objectif_temps_min: int
    notes: Optional[str] = None


def _allures_depuis_objectif(distance_km: float, objectif_temps_min: int) -> dict:
    """Calcule les allures cibles Z2/Z4/Z5 depuis l'objectif de course."""
    allure_course = objectif_temps_min / distance_km  # min/km
    def fmt(m: float) -> str:
        mins = int(m); secs = int((m - mins) * 60)
        return f"{mins}:{secs:02d}/km"
    return {
        "course": fmt(allure_course),
        "z2":     fmt(allure_course * 1.30),
        "z4":     fmt(allure_course * 1.07),
        "z5":     fmt(allure_course * 0.92),
        "course_min_km": round(allure_course, 2),
    }


@app.get("/api/objectif-course", summary="RÃ©cupÃ¨re le prochain objectif de course")
def get_objectif_course(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    obj = (
        db.query(ObjectifCourse)
        .filter(ObjectifCourse.utilisateur_id == current_user.id)
        .order_by(ObjectifCourse.cree_le.desc())
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="Aucun objectif de course enregistrÃ©")
    jours_restants = (obj.date_course - date.today()).days
    allures = _allures_depuis_objectif(obj.distance_km, obj.objectif_temps_min)
    h, m = divmod(obj.objectif_temps_min, 60)
    return {
        "id": obj.id,
        "nom": obj.nom,
        "date_course": obj.date_course.strftime("%d/%m/%Y"),
        "distance_km": obj.distance_km,
        "dplus_m": obj.dplus_m,
        "objectif_temps_min": obj.objectif_temps_min,
        "objectif_temps_str": f"{h}h{m:02d}" if h else f"{m} min",
        "jours_restants": jours_restants,
        "notes": obj.notes,
        "allures": allures,
    }


@app.post("/api/objectif-course", summary="Enregistre/remplace le prochain objectif de course")
def set_objectif_course(
    payload: ObjectifCourseSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    # Remplace l'objectif existant
    db.query(ObjectifCourse).filter(ObjectifCourse.utilisateur_id == current_user.id).delete()
    try:
        date_course = datetime.strptime(payload.date_course, "%d/%m/%Y").date()
    except ValueError:
        raise HTTPException(400, "Format de date invalide â€” attendu jj/mm/aaaa")
    obj = ObjectifCourse(
        utilisateur_id=current_user.id,
        nom=payload.nom,
        date_course=date_course,
        distance_km=payload.distance_km,
        dplus_m=payload.dplus_m or 0,
        objectif_temps_min=payload.objectif_temps_min,
        notes=payload.notes,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    allures = _allures_depuis_objectif(obj.distance_km, obj.objectif_temps_min)
    h, m = divmod(obj.objectif_temps_min, 60)
    return {
        "id": obj.id,
        "nom": obj.nom,
        "date_course": obj.date_course.strftime("%d/%m/%Y"),
        "distance_km": obj.distance_km,
        "dplus_m": obj.dplus_m,
        "objectif_temps_str": f"{h}h{m:02d}" if h else f"{m} min",
        "jours_restants": (obj.date_course - date.today()).days,
        "allures": allures,
    }


# ---------------------------------------------------------------------------
# Admin â€” reset macrocycles (dates)
# ---------------------------------------------------------------------------

@app.post("/api/admin/reset-macrocycles", summary="RecrÃ©e les 3 macrocycles depuis la date indiquÃ©e")
def reset_macrocycles(
    utilisateur_id: int = Query(1),
    date_debut: Optional[str] = Query(None, description="Date dÃ©but au format jj/mm/aaaa (dÃ©faut : lundi prochain)"),
    db: Session = Depends(obtenir_session),
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
            raise HTTPException(400, "Format de date invalide â€” attendu jj/mm/aaaa")
    else:
        today = date.today()
        jours = (7 - today.weekday()) % 7 or 7  # lundi prochain
        debut_mc1 = today + timedelta(days=jours)

    # Suppression des macrocycles existants (cascade ORM)
    for mc in db.query(Macrocycle).filter(Macrocycle.utilisateur_id == utilisateur_id).all():
        db.delete(mc)
    db.flush()

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
        "message": "Macrocycles recrÃ©Ã©s. Lance maintenant /api/admin/seed-seances.",
        "macrocycles": crees,
    }


# ---------------------------------------------------------------------------
# Programme â€” initialisation depuis l'UI
# ---------------------------------------------------------------------------

class InitProgrammePayload(BaseModel):
    date_debut: str = Field(..., description="Date dÃ©but du programme (lundi) au format jj/mm/aaaa")
    utilisateur_id: int = 1


@app.get("/api/programme/statut", summary="Statut du programme : existe-t-il ? quelle date de dÃ©but ?")
def statut_programme(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    mcs = db.query(Macrocycle).filter(Macrocycle.utilisateur_id == current_user.id).order_by(Macrocycle.numero_cycle).all()
    if not mcs:
        return {"programme_existe": False}

    mc1 = mcs[0]
    mc_last = mcs[-1]
    obj = db.query(ObjectifCourse).filter(ObjectifCourse.utilisateur_id == current_user.id).order_by(ObjectifCourse.id.desc()).first()

    semaines_totales = sum(len(mc.semaines) for mc in mcs)
    return {
        "programme_existe": True,
        "date_debut": mc1.date_debut.strftime("%d/%m/%Y"),
        "date_fin": mc_last.date_fin.strftime("%d/%m/%Y"),
        "nb_modules": len(mcs),
        "semaines_totales": semaines_totales,
        "objectif_course": {
            "nom": obj.nom,
            "date_course": obj.date_course.strftime("%d/%m/%Y"),
            "distance_km": obj.distance_km,
        } if obj else None,
    }


@app.post("/api/programme/corriger-seances", summary="Supprime les sÃ©ances en excÃ¨s pour respecter seances_semaine")
def corriger_seances(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    """
    Sans recrÃ©er le programme, retire les sÃ©ances course et muscu en surnombre
    pour que chaque semaine respecte seances_semaine total.
    PrioritÃ© de suppression course : EF Z2 (jour le plus tÃ´t) en premier.
    PrioritÃ© de suppression muscu  : complÃ©ment EMOM (titre contient '3e sÃ©ance') en premier.
    SÃ©ances dÃ©jÃ  validÃ©es (journal) : jamais supprimÃ©es.
    """
    user = current_user
    n_muscu = user.seances_muscu_semaine or 2
    seances_total = user.seances_semaine or 5
    n_course = user.seances_course_semaine if user.seances_course_semaine is not None else max(1, seances_total - n_muscu)
    n_course = min(n_course, max(1, seances_total - n_muscu))

    mcs = db.query(Macrocycle).filter(Macrocycle.utilisateur_id == user.id).all()
    semaines = []
    for mc in mcs:
        semaines.extend(db.query(SemaineEntrainement).filter(SemaineEntrainement.macrocycle_id == mc.id).all())

    supprimees = 0
    for sem in semaines:
        seances = db.query(SeanceEntrainement).filter(SeanceEntrainement.semaine_id == sem.id).all()
        # Ne touche pas aux sÃ©ances dÃ©jÃ  validÃ©es
        non_validees = [s for s in seances if not s.journal]

        courses_nv = sorted(
            [s for s in non_validees if s.type_seance == TypeSeance.COURSE],
            key=lambda s: s.date_seance
        )
        muscu_types = {TypeSeance.EMOM, TypeSeance.AMRAP, TypeSeance.GYM_UPPER, TypeSeance.GYM_LOWER, TypeSeance.GYM_FULL}
        muscu_nv = [s for s in non_validees if s.type_seance in muscu_types]

        # Supprimer l'excÃ¨s de course (du plus tÃ´t = EF au plus tard)
        while len(courses_nv) > n_course:
            db.delete(courses_nv.pop(0))
            supprimees += 1

        # Supprimer l'excÃ¨s de muscu (complÃ©ment EMOM en prioritÃ© = titre contient '3e')
        total_muscu_target = seances_total - n_course
        muscu_nv_sorted = sorted(muscu_nv, key=lambda s: (0 if "3e" in (s.titre or "") else 1))
        while len(muscu_nv_sorted) > total_muscu_target:
            db.delete(muscu_nv_sorted.pop(0))
            supprimees += 1

    db.commit()
    return {"ok": True, "seances_supprimees": supprimees, "n_course_cible": n_course, "n_muscu_cible": total_muscu_target}


@app.delete("/api/programme", summary="Supprime tous les macrocycles et sÃ©ances de l'utilisateur")
def supprimer_programme(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    mcs = db.query(Macrocycle).filter(Macrocycle.utilisateur_id == current_user.id).all()
    for mc in mcs:
        db.delete(mc)
    db.commit()
    return {"message": f"{len(mcs)} macrocycle(s) supprimÃ©(s)."}


@app.post("/api/programme/initialiser", summary="GÃ©nÃ¨re le programme depuis la date choisie dans l'UI")
def initialiser_programme(payload: InitProgrammePayload, current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    from models import SemaineEntrainement
    from periodization_rules import (
        BLUEPRINT_MACROCYCLE, generer_dates_semaines, generer_blueprint_course,
    )
    from models import TypeMacrophase
    from seed_seances import (
        MODULE1, MODULE2, MODULE3,
        _POOL_SURCHARGE, _semaine_course, _semaine_taper_course, _inserer_seances_en_session,
        calibrer_module, adapter_contenu_muscu, adapter_contenu_gym, adapter_contenu_course, enrichir_paces_vma,
    )

    try:
        debut_mc1 = datetime.strptime(payload.date_debut, "%d/%m/%Y").date()
    except ValueError:
        raise HTTPException(400, "Format de date invalide â€” attendu jj/mm/aaaa")

    if debut_mc1.weekday() != 0:
        raise HTTPException(400, "La date de dÃ©but doit Ãªtre un lundi")

    user = current_user

    obj = db.query(ObjectifCourse).filter(
        ObjectifCourse.utilisateur_id == user.id
    ).order_by(ObjectifCourse.id.desc()).first()

    # Suppression des macrocycles existants (cascade ORM â€” mÃªme session)
    for mc_old in db.query(Macrocycle).filter(Macrocycle.utilisateur_id == user.id).all():
        db.delete(mc_old)
    db.flush()

    try:
        # â”€â”€ CAS 1 : course planifiÃ©e â†’ programme adaptatif N semaines â”€â”€â”€â”€â”€â”€â”€
        if obj:
            n_semaines = (obj.date_course - debut_mc1).days // 7
            if n_semaines < 4:
                raise HTTPException(400, f"La course est dans {n_semaines} semaine(s) â€” trop proche (minimum 4 semaines).")

            n_surcharge = n_semaines - 3

            # Calibration v2 avant blueprint (progression individualisÃ©e)
            historique = {}
            if user.historique_perf:
                import json as _json
                try:
                    historique = _json.loads(user.historique_perf)
                except Exception:
                    historique = {}
            from intelligence_programme import (
                construire_profil, calibration_v2, generer_blueprint_course_v2,
                semaines_assimilation, appliquer_profil_au_contenu,
            )
            profil = construire_profil(user, db, historique)
            cal = calibration_v2(historique, profil)

            blueprint = generer_blueprint_course_v2(n_semaines, cal)
            dates = [debut_mc1 + timedelta(weeks=i) for i in range(n_semaines)]

            # Injection des semaines d'Ã©valuation dans le blueprint (AVANT insertion en BDD)
            eval_freq = user.frequence_tests_semaines or 8
            for regle in blueprint:
                if regle.numero <= n_surcharge and regle.numero % eval_freq == 0:
                    regle.macrophase = TypeMacrophase.EVALUATION
                    regle.objectif_amrap_min = None
                    regle.objectif_km_course = None

            mc = Macrocycle(
                utilisateur_id=user.id,
                numero_cycle=1,
                date_debut=debut_mc1,
                date_fin=debut_mc1 + timedelta(weeks=n_semaines),
            )
            db.add(mc)
            db.flush()
            for regle, date_sem in zip(blueprint, dates):
                db.add(SemaineEntrainement(
                    macrocycle_id=mc.id,
                    numero_semaine=regle.numero,
                    macrophase=regle.macrophase,
                    date_debut=date_sem,
                    multiplicateur_volume=regle.multiplicateur_volume,
                    objectif_km_course=regle.objectif_km_course,
                    objectif_amrap_min=regle.objectif_amrap_min,
                ))
            db.flush()

            kf_init = cal["km_factor"]
            af_init = cal["amrap_factor"]
            rf_init = cal["reps_factor"]
            m1_cal_init = calibrer_module(MODULE1, kf_init, af_init, rf_init)

            # VMA pour enrichissement des allures cibles
            vma_init = None
            if historique.get("vma_estimee"):
                try:
                    vma_init = float(historique["vma_estimee"])
                except (TypeError, ValueError):
                    pass
            if vma_init is None:
                bio = db.query(BiometrieUtilisateur).filter(
                    BiometrieUtilisateur.utilisateur_id == user.id
                ).order_by(BiometrieUtilisateur.enregistre_le.desc()).first()
                if bio:
                    vma_init = bio.vma_kmh

            # Volume progressif
            vol_pic = _calculer_volume_pic(obj.distance_km)
            BASELINE_VOL = 35.0
            f_pic_init = min(vol_pic / BASELINE_VOL, kf_init * cal.get("plafond_pic", 2.2))

            assim = semaines_assimilation(n_surcharge)
            n_build_weeks_init = sum(1 for i in range(1, n_surcharge + 1) if i % eval_freq != 0)
            content: dict = {}
            progress_map: dict = {}
            pool_idx = 1
            build_count = 0
            for i in range(1, n_surcharge + 1):
                if i % eval_freq == 0:
                    content[i] = MODULE1[8]
                else:
                    progress = build_count / max(1, n_build_weeks_init - 1) if n_build_weeks_init > 1 else 1.0
                    week_kf = kf_init + (f_pic_init - kf_init) * (progress ** cal.get("exp_progression", 0.75))
                    if i in assim:
                        week_kf *= 0.75  # semaine d'assimilation
                    pool_key = min(pool_idx, 15)
                    content[i] = calibrer_module({1: _POOL_SURCHARGE[pool_key]}, week_kf, af_init, rf_init)[1]
                    progress_map[i] = progress
                    pool_idx += 1
                    build_count += 1
            content[n_surcharge + 1] = m1_cal_init.get(6, MODULE1[6])
            content[n_surcharge + 2] = _semaine_taper_course()
            content[n_semaines]      = _semaine_course(obj.date_course, obj.nom)

            # Adaptation au profil (spÃ©cificitÃ© distance, sortie longue, variantes, terrain)
            content = appliquer_profil_au_contenu(content, profil, cal, progress_map)

            # Enrichissement allures rÃ©elles
            if vma_init and vma_init >= 5.0:
                content = enrichir_paces_vma(content, vma_init)

            n_muscu = user.seances_muscu_semaine or 2
            seances_total = user.seances_semaine or 5
            n_course = user.seances_course_semaine if user.seances_course_semaine is not None else max(1, seances_total - n_muscu)
            n_course = min(n_course, max(1, seances_total - n_muscu))
            muscu_adapter = adapter_contenu_gym if user.type_muscu == "salle" else adapter_contenu_muscu
            adapted = adapter_contenu_course(muscu_adapter(content, n_muscu, user.sexe), n_course)
            _inserer_seances_en_session(db, mc, adapted)
            db.commit()

            return {
                "message": f"Programme orientÃ© course gÃ©nÃ©rÃ© : {n_semaines} semaines ({n_surcharge} de build + 2 de taper + semaine course).",
                "semaines_totales": n_semaines,
                "course": obj.nom,
            }

        # â”€â”€ CAS 2 : pas de course â†’ programme standard 3 Ã— 8 semaines â”€â”€â”€â”€â”€â”€â”€
        # Recalibration si historique dispo
        historique_std = {}
        if user.historique_perf:
            import json as _json_std
            try:
                historique_std = _json_std.loads(user.historique_perf)
            except Exception:
                historique_std = {}
        from intelligence_programme import (
            construire_profil as _cp_std, calibration_v2 as _cv2_std,
            appliquer_profil_au_contenu as _apc_std,
        )
        profil_std = _cp_std(user, db, historique_std)
        cal_std = _cv2_std(historique_std, profil_std)
        kf_std = cal_std["km_factor"]
        af_std = cal_std["amrap_factor"]
        rf_std = cal_std["reps_factor"]

        # VMA pour allures
        vma_std = None
        if historique_std.get("vma_estimee"):
            try:
                vma_std = float(historique_std["vma_estimee"])
            except (TypeError, ValueError):
                pass
        if vma_std is None:
            bio_std = db.query(BiometrieUtilisateur).filter(
                BiometrieUtilisateur.utilisateur_id == user.id
            ).order_by(BiometrieUtilisateur.enregistre_le.desc()).first()
            if bio_std:
                vma_std = bio_std.vma_kmh

        n_muscu = user.seances_muscu_semaine or 2
        seances_total = user.seances_semaine or 5
        n_course = user.seances_course_semaine if user.seances_course_semaine is not None else max(1, seances_total - n_muscu)
        n_course = min(n_course, max(1, seances_total - n_muscu))
        muscu_adapter = adapter_contenu_gym if user.type_muscu == "salle" else adapter_contenu_muscu
        mcs_crees = []
        for numero_cycle in range(1, 4):
            debut = debut_mc1 + timedelta(weeks=8 * (numero_cycle - 1))
            mc = Macrocycle(
                utilisateur_id=user.id,
                numero_cycle=numero_cycle,
                date_debut=debut,
                date_fin=debut + timedelta(weeks=8),
            )
            db.add(mc)
            db.flush()
            for regle, date_sem in zip(BLUEPRINT_MACROCYCLE, generer_dates_semaines(debut)):
                km = round(regle.objectif_km_course * kf_std, 1) if regle.objectif_km_course else None
                amrap = round(regle.objectif_amrap_min * af_std) if regle.objectif_amrap_min else None
                db.add(SemaineEntrainement(
                    macrocycle_id=mc.id,
                    numero_semaine=regle.numero,
                    macrophase=regle.macrophase,
                    date_debut=date_sem,
                    multiplicateur_volume=regle.multiplicateur_volume,
                    objectif_km_course=km,
                    objectif_amrap_min=amrap,
                ))
            db.flush()
            module_data = {1: MODULE1, 2: MODULE2, 3: MODULE3}[numero_cycle]
            calibrated_std = calibrer_module(module_data, kf_std, af_std, rf_std)
            calibrated_std = _apc_std(calibrated_std, profil_std, cal_std)
            if vma_std and vma_std >= 5.0:
                calibrated_std = enrichir_paces_vma(calibrated_std, vma_std)
            adapted_std = adapter_contenu_course(muscu_adapter(calibrated_std, n_muscu, user.sexe), n_course)
            _inserer_seances_en_session(db, mc, adapted_std)
            mcs_crees.append(numero_cycle)

        db.commit()
        return {
            "message": "Programme performance gÃ©nÃ©rale gÃ©nÃ©rÃ© : 3 modules Ã— 8 semaines.",
            "semaines_totales": 24,
        }

    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(500, detail=f"Erreur gÃ©nÃ©ration : {type(exc).__name__}: {exc}")


# ---------------------------------------------------------------------------
# Intelligence sportive â€” analyse objectif + recalibration
# ---------------------------------------------------------------------------

@app.get("/api/programme/analyse-objectif", summary="Analyse VMA cible vs actuelle pour l'objectif en cours")
def analyse_objectif(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    try:
        obj = db.query(ObjectifCourse).filter(
            ObjectifCourse.utilisateur_id == current_user.id
        ).order_by(ObjectifCourse.id.desc()).first()

        if not obj:
            return {"objectif": None, "vma_actuelle": None, "vma_requise": None, "delta_vma": None}

        bio = db.query(BiometrieUtilisateur).filter(
            BiometrieUtilisateur.utilisateur_id == current_user.id
        ).order_by(BiometrieUtilisateur.enregistre_le.desc()).first()
        vma_actuelle = bio.vma_kmh if bio else None

        dist = float(obj.distance_km or 0)
        temps = int(obj.objectif_temps_min or 0)

        vma_req = _vma_requise(dist, temps) if dist > 0 and temps > 0 else None
        delta = round(vma_req - vma_actuelle, 1) if (vma_req and vma_actuelle) else None

        if dist <= 5:
            label_intensite = "~97% VMA"
        elif dist <= 12:
            label_intensite = "~94% VMA"
        elif dist <= 22:
            label_intensite = "~85% VMA"
        elif dist <= 45:
            label_intensite = "~78% VMA"
        else:
            label_intensite = "~70% VMA"

        faisabilite = (
            "atteignable" if delta is not None and delta <= 0 else
            "ambitieux" if delta is not None and delta <= 1.5 else
            "challenge" if delta is not None and delta <= 3.5 else
            "trÃ¨s ambitieux"
        )

        allures_train = None
        if vma_actuelle and vma_actuelle >= 5.0:
            allures_train = {
                "Z2": _pace_str(vma_actuelle * 0.70),
                "Z4": _pace_str(vma_actuelle * 0.90),
                "Z5": _pace_str(vma_actuelle * 1.025),
            }

        allure_course_kmh = (dist / temps) * 60 if dist > 0 and temps > 0 else None
        h, mn = divmod(temps, 60)
        objectif_temps_str = f"{h}h{mn:02d}" if h else f"{mn} min"
        jours_restants = (obj.date_course - date.today()).days if obj.date_course else 0

        # PrÃ©diction chrono basÃ©e sur VMA actuelle
        temps_predit_min = None
        if vma_actuelle and dist > 0:
            if dist <= 5:   pct_vma = 0.97
            elif dist <= 12: pct_vma = 0.94
            elif dist <= 22: pct_vma = 0.85
            elif dist <= 45: pct_vma = 0.78
            else:            pct_vma = 0.70
            pace_predit_kmh = vma_actuelle * pct_vma
            temps_predit_min = round(dist / pace_predit_kmh * 60)

        return {
            "objectif": {
                "nom": obj.nom,
                "distance_km": dist,
                "objectif_temps_str": objectif_temps_str,
                "allure_course": _pace_str(allure_course_kmh) if allure_course_kmh else None,
                "jours_restants": jours_restants,
            },
            "vma_actuelle": vma_actuelle,
            "vma_requise": vma_req,
            "delta_vma": delta,
            "label_intensite": label_intensite,
            "faisabilite": faisabilite,
            "allures_entrainement": allures_train,
            "volume_pic_cible": _calculer_volume_pic(dist),
            "temps_predit_min": temps_predit_min,
        }
    except Exception as exc:
        import traceback
        traceback.print_exc()
        # Retourner un rÃ©sultat vide plutÃ´t qu'un 500 pour ne pas bloquer le Dashboard
        return {"objectif": None, "vma_actuelle": None, "vma_requise": None, "delta_vma": None, "_error": str(exc)}


@app.get("/api/programme/alerte-fatigue", summary="DÃ©tecte une fatigue excessive sur les 3 derniÃ¨res sÃ©ances")
def alerte_fatigue(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    derniers = (
        db.query(JournalSeance)
        .filter(
            JournalSeance.utilisateur_id == current_user.id,
            JournalSeance.rpe.isnot(None),
            JournalSeance.completee == True,
        )
        .order_by(JournalSeance.enregistre_le.desc())
        .limit(3)
        .all()
    )
    if len(derniers) >= 3 and all(j.rpe > 8 for j in derniers):
        rpe_moyen = round(sum(j.rpe for j in derniers) / len(derniers), 1)
        return {
            "alerte": True,
            "rpe_moyen": rpe_moyen,
            "message": f"RPE moyen de {rpe_moyen}/10 sur tes 3 derniÃ¨res sÃ©ances. Une semaine de dÃ©charge est recommandÃ©e.",
        }
    return {"alerte": False}


class BlessureSchema(BaseModel):
    duree_jours: int = Field(..., ge=1, le=90)
    description: Optional[str] = None


@app.post("/api/programme/blessure", summary="Signale une blessure et adapte le programme")
def signaler_blessure(
    payload: BlessureSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    today = date.today()
    fin = today + timedelta(days=payload.duree_jours)
    seances = (
        db.query(SeanceEntrainement)
        .join(SemaineEntrainement)
        .join(Macrocycle)
        .filter(
            Macrocycle.utilisateur_id == current_user.id,
            SeanceEntrainement.date_seance >= today,
            SeanceEntrainement.date_seance <= fin,
            SeanceEntrainement.type_seance != TypeSeance.REPOS,
            SeanceEntrainement.type_seance != TypeSeance.BLESSURE,
        )
        .all()
    )
    for s in seances:
        s.type_seance = TypeSeance.BLESSURE
        s.titre = "Repos â€” Blessure"
        s.description = f"Repos forcÃ© suite Ã  une blessure ({payload.description or 'non prÃ©cisÃ©e'}). Reprends progressivement aprÃ¨s guÃ©rison."
        for ex in s.exercices:
            db.delete(ex)
    db.commit()
    return {"ok": True, "nb_seances_modifiees": len(seances), "fin_blessure": str(fin)}


@app.post("/api/programme/adapter-charge", summary="Régule la charge de la semaine courante selon ACWA / RPE / assiduité")
def adapter_charge(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    """Adaptation continue : si la charge aiguë dérape (ACWA > 1.5 ou RPE moyen
    élevé), les séances restantes de la semaine sont allégées de 20 % ; si
    l'utilisateur encaisse très bien (ACWA < 0.8, RPE bas, assidu), légère
    augmentation. Idempotent — marqueur ⚙ dans le titre."""
    from intelligence_programme import adapter_charge_semaine
    try:
        return adapter_charge_semaine(db, current_user)
    except Exception as exc:
        db.rollback()
        return {"ok": False, "erreur": str(exc)}


@app.post("/api/programme/corriger-durees-course", summary="Recalcule les durées des séances Z3-Z5 surestimées par calibration")
def corriger_durees_course(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    import re as _re

    # Mapping exact des durées correctes (non calibrées) par structure d'intervalles.
    # Clé : partie entre parenthèses du titre seed original.
    DUREES_SEED = {
        "(3×8 min R=2 min)": 40,
        "(6×2 min R=2 min)": 40,
        "(3×10 min R=2 min)": 45,
        "(8×2 min R=1:30 min)": 45,
        "(3×11 min R=2 min)": 50,
        "(6×2:30 min R=2 min)": 45,
        "(3×12 min R=2 min)": 50,
        "(8×2:30 min R=1:30 min)": 50,
        "(6×3 min R=3 min)": 50,
        "(8×3 min R=2 min)": 55,
        "(3×10 min R=2 min) — maintenance": 45,
    }

    def _cle_intervalles(titre: str):
        """Extrait '(N×T min R=Tr min)' du titre, avec éventuel suffixe '— mot'."""
        m = _re.search(r"\(\d+[×x*]\d.*?\)(?:\s*—\s*\w+)?", titre)
        return m.group(0).strip() if m else None

    seances = (
        db.query(SeanceEntrainement)
        .join(SemaineEntrainement)
        .join(Macrocycle)
        .filter(
            Macrocycle.utilisateur_id == current_user.id,
            SeanceEntrainement.type_seance == TypeSeance.COURSE,
        )
        .all()
    )

    nb_corriges = 0
    for s in seances:
        titre = s.titre or ""
        cle = _cle_intervalles(titre)
        duree_correcte = DUREES_SEED.get(cle) if cle else None
        if duree_correcte and s.duree_cible_min != duree_correcte:
            ancien = s.duree_cible_min
            s.duree_cible_min = duree_correcte
            if ancien:
                s.titre = _re.sub(
                    r"(?<=—\s)\d+(?=\s*min\b)",
                    str(duree_correcte),
                    titre,
                    count=1,
                )
            nb_corriges += 1

    db.commit()
    return {"ok": True, "nb_corriges": nb_corriges}


@app.post("/api/programme/corriger-emom", summary="Corrige les EMOM compléments mal affectés (bug logique inversée)")
def corriger_emom_3e_seance(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    """
    Pour chaque semaine non complétée ayant exactement 2 EMOMs :
    - le complément est celui avec le temps_limite le plus court (20 min)
    - si principal et complément ont le même type PUSH/PULL → swap le complément
    """
    PUSH_SLUGS = {
        "dip-parallettes", "triceps-extension-dips", "pompe-standard",
        "pompe-large", "pompe-genoux", "pompe-diamant",
    }
    PULL_SLUGS = {
        "traction-stricte", "traction-australienne", "curl-biceps-traction",
        "le-y", "extension-hanche", "rotateur-long",
    }

    # Templates PULL et PUSH pour le complément
    TPL_PULL = {
        "titre": "EMOM PULL — 3e séance",
        "description": (
            "EMOM PULL complémentaire — 2 blocs :\n"
            "  • Bloc A — 10 min : Traction australienne + Curl biceps (alternés)\n"
            "      8 tractions / 10 curl (cycle × 5)\n"
            "  • Bloc B — 10 min : Le Y / Extension de hanche (alternés × 5)\n"
            "      10 reps / 15 reps"
        ),
        "temps_limite": 20,
        "exercices": [
            {"slug": "traction-australienne", "reps": 8,  "tempo": "X/1/2/0", "duree_min": 10},
            {"slug": "curl-biceps-traction",  "reps": 10, "tempo": "X/1/2/0", "duree_min": 10},
            {"slug": "le-y",                  "reps": 10, "tempo": "2/1/X/0", "duree_min": 10},
            {"slug": "extension-hanche",      "reps": 15, "tempo": "2/1/X/0", "duree_min": 10},
        ],
    }
    TPL_PUSH = {
        "titre": "EMOM PUSH — 3e séance",
        "description": (
            "EMOM PUSH complémentaire — 2 blocs :\n"
            "  • Bloc A — 10 min : Dips + Pompes standard (alternés)\n"
            "      6 dips / 10 pompes (cycle × 5)\n"
            "  • Bloc B — 10 min : Pompes prise large / Extension triceps / Squat (triplet × 3)\n"
            "      8 reps / 10 reps / 15 reps"
        ),
        "temps_limite": 20,
        "exercices": [
            {"slug": "dip-parallettes",        "reps": 6,  "tempo": "2/1/X/0", "duree_min": 10},
            {"slug": "pompe-standard",         "reps": 10, "tempo": "2/0/X/0", "duree_min": 10},
            {"slug": "pompe-large",            "reps": 8,  "tempo": "2/1/X/0", "duree_min": 10},
            {"slug": "triceps-extension-dips", "reps": 10, "tempo": "2/1/X/0", "duree_min": 10},
            {"slug": "squat-bw",               "reps": 15, "tempo": "3/1/X/0", "duree_min": 10},
        ],
    }

    exercices_map = {e.slug: e for e in db.query(VariationExercice).all()}
    nb_corriges = 0

    from sqlalchemy import or_
    # Récupérer tous les EMOMs non complétés de l'utilisateur, groupés par semaine
    rows = (
        db.query(SeanceEntrainement, SemaineEntrainement.id.label("sem_id"))
        .join(SemaineEntrainement, SeanceEntrainement.semaine_id == SemaineEntrainement.id)
        .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
        .outerjoin(JournalSeance, JournalSeance.seance_id == SeanceEntrainement.id)
        .filter(
            Macrocycle.utilisateur_id == current_user.id,
            SeanceEntrainement.type_seance == TypeSeance.EMOM,
            or_(JournalSeance.completee.is_(None), JournalSeance.completee == False),
        )
        .all()
    )

    # Grouper par semaine
    by_sem: dict[int, list] = {}
    for row in rows:
        s = row.SeanceEntrainement
        sid = row.sem_id
        by_sem.setdefault(sid, []).append(s)

    for sem_id, emoms in by_sem.items():
        if len(emoms) < 2:
            continue

        # Le complément est le plus court (temps_limite_min le plus bas)
        emoms_sorted = sorted(emoms, key=lambda s: s.temps_limite_min or 9999)
        complement = emoms_sorted[0]   # durée la plus courte → 3e séance
        principal  = emoms_sorted[-1]  # durée la plus longue → EMOM principal

        titre_p = (principal.titre or "").upper()
        titre_c = (complement.titre or "").upper()
        p_is_push = "PUSH" in titre_p
        p_is_pull = "PULL" in titre_p
        c_is_push = "PUSH" in titre_c
        c_is_pull = "PULL" in titre_c

        # Si on ne peut pas déterminer le type du principal → skip
        if not (p_is_push or p_is_pull):
            continue

        # Vérifier aussi via les exercices si le titre ne suffit pas
        if not p_is_push and not p_is_pull:
            ex_slugs = {e.exercice.slug for e in principal.exercices if e.exercice}
            p_is_push = bool(ex_slugs & PUSH_SLUGS)
            p_is_pull = bool(ex_slugs & PULL_SLUGS)

        # Détecter si le complément doit être corrigé
        correct_tpl = TPL_PULL if p_is_push else TPL_PUSH
        wrong = (p_is_push and c_is_push) or (p_is_pull and c_is_pull)

        if not wrong:
            continue  # déjà correct

        # Corriger : mettre à jour le titre, la description, les exercices
        complement.titre = correct_tpl["titre"]
        complement.description = correct_tpl["description"]
        complement.temps_limite_min = correct_tpl["temps_limite"]

        # Supprimer les anciens exercices
        db.query(ExerciceSeance).filter(ExerciceSeance.seance_id == complement.id).delete()
        db.flush()

        for pos, ex_data in enumerate(correct_tpl["exercices"], 1):
            exercice = exercices_map.get(ex_data["slug"])
            if not exercice:
                continue
            db.add(ExerciceSeance(
                seance_id=complement.id,
                exercice_id=exercice.id,
                ordre=pos,
                repetitions=ex_data.get("reps"),
                tempo_override=ex_data.get("tempo"),
                duree_bloc_min=ex_data.get("duree_min"),
            ))
        nb_corriges += 1

    db.commit()
    return {"ok": True, "nb_semaines_corrigees": nb_corriges}


@app.post("/api/programme/recalibrer", summary="Recalibre les sÃ©ances restantes aprÃ¨s un test d'Ã©valuation")
def recalibrer_programme(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    """
    AprÃ¨s une semaine d'Ã©valuation, met Ã  jour la VMA et recalibre
    les descriptions de toutes les sÃ©ances de course futures avec les nouvelles allures.
    """
    from datetime import date as date_cls
    from seed_seances import enrichir_paces_vma, calculer_paces_vma

    # VMA la plus rÃ©cente
    bio = db.query(BiometrieUtilisateur).filter(
        BiometrieUtilisateur.utilisateur_id == current_user.id
    ).order_by(BiometrieUtilisateur.enregistre_le.desc()).first()
    if not bio:
        raise HTTPException(400, "Aucune biomÃ©trie disponible. Effectuez d'abord un test Demi-Cooper.")

    vma = bio.vma_kmh
    if not vma or vma < 5.0:
        raise HTTPException(400, "VMA invalide ou non calculÃ©e.")

    paces = calculer_paces_vma(vma)
    zone_prefix = {
        "Z1": f"â”€â”€ Coach ({vma:.1f} km/h VMA) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\nAllure cible : {paces['Z1']} (Z1 â€” rÃ©cupÃ©ration â€” 60-65% VMA)\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n",
        "Z2": f"â”€â”€ Coach ({vma:.1f} km/h VMA) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\nAllure cible : {paces['Z2']} (Z2 â€” endurance fond. â€” 65-75% VMA)\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n",
        "Z3": f"â”€â”€ Coach ({vma:.1f} km/h VMA) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\nAllure cible : {paces['Z3']} (Z3 â€” tempo â€” 75-85% VMA)\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n",
        "Z4": f"â”€â”€ Coach ({vma:.1f} km/h VMA) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\nAllure cible : {paces['Z4']} (Z4 â€” seuil lactique â€” 85-95% VMA)\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n",
        "Z5": f"â”€â”€ Coach ({vma:.1f} km/h VMA) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\nAllure effort : {paces['Z5']} (Z5 â€” VOâ‚‚max â€” 100-105% VMA)\nAllure rÃ©cup  : {paces['recup']} (Z1)\nâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n",
    }

    today = date_cls.today()
    updated = 0

    # Mettre Ã  jour toutes les sÃ©ances de course futures
    mcs = db.query(Macrocycle).filter(Macrocycle.utilisateur_id == current_user.id).all()
    for mc in mcs:
        for semaine in mc.semaines:
            if semaine.date_debut < today:
                continue
            for seance in semaine.seances:
                if seance.type_seance.value != "COURSE" or not seance.zone_cible:
                    continue
                zone_key = seance.zone_cible.value  # ex: "Z2"
                prefix = zone_prefix.get(zone_key)
                if not prefix:
                    continue
                # Supprimer l'ancien bloc Coach s'il existe
                desc = seance.description or ""
                coach_end = desc.find("â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n")
                if coach_end >= 0 and "â”€â”€ Coach" in desc[:coach_end]:
                    desc = desc[coach_end + len("â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€\n"):]
                seance.description = prefix + desc
                updated += 1

    db.commit()
    return {
        "ok": True,
        "vma": vma,
        "allures": {
            "Z2": paces["Z2"],
            "Z4": paces["Z4"],
            "Z5": paces["Z5"],
        },
        "seances_mises_a_jour": updated,
        "message": f"Recalibration effectuÃ©e avec VMA {vma:.1f} km/h. {updated} sÃ©ance(s) de course mises Ã  jour.",
    }


# ---------------------------------------------------------------------------
# SantÃ©
# ---------------------------------------------------------------------------

@app.get("/", include_in_schema=False)
def racine():
    return {"statut": "Coach EPC opÃ©rationnel", "docs": "/docs"}


@app.get("/health", include_in_schema=False)
def sante():
    return {"statut": "ok", "timestamp": datetime.utcnow().isoformat()}


# ---------------------------------------------------------------------------
# Migration donnÃ©es historiques â†’ nouveau compte
# ---------------------------------------------------------------------------

class MigrationSchema(BaseModel):
    ancien_user_id: int = 1

@app.post("/api/admin/migrer-donnees", summary="RÃ©affecte les donnÃ©es d'un ancien compte vers le compte connectÃ©")
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

    # Macrocycles (cascade : SemaineEntrainement â†’ SeanceEntrainement)
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



# ---------------------------------------------------------------------------
# Import iOS Shortcuts
# ---------------------------------------------------------------------------

import secrets as _secrets

# Mapping type Apple Health -> types seance coach
_HEALTH_TYPE_MAP = {
    "Running":        ["COURSE"],
    "TrailRunning":   ["COURSE"],
    "Walking":        ["DECHARGE"],
    "Hiking":         ["DECHARGE"],
    "FunctionalStrengthTraining": ["GYM_UPPER", "GYM_LOWER", "GYM_FULL", "EMOM", "AMRAP"],
    "TraditionalStrengthTraining": ["GYM_UPPER", "GYM_LOWER", "GYM_FULL"],
    "HighIntensityIntervalTraining": ["EMOM", "AMRAP"],
    "CrossTraining":  ["EMOM", "AMRAP"],
    "MixedCardio":    ["EMOM", "AMRAP", "COURSE"],
    "Other":          ["EMOM", "AMRAP", "GYM_UPPER", "GYM_LOWER", "GYM_FULL", "COURSE"],
}

_TYPE_SEANCE_TO_HEALTH = {
    "COURSE":    ["Running", "TrailRunning", "MixedCardio"],
    "GYM_UPPER": ["FunctionalStrengthTraining", "TraditionalStrengthTraining", "CrossTraining"],
    "GYM_LOWER": ["FunctionalStrengthTraining", "TraditionalStrengthTraining", "CrossTraining"],
    "GYM_FULL":  ["FunctionalStrengthTraining", "TraditionalStrengthTraining", "CrossTraining"],
    "EMOM":      ["HighIntensityIntervalTraining", "CrossTraining", "FunctionalStrengthTraining"],
    "AMRAP":     ["HighIntensityIntervalTraining", "CrossTraining", "FunctionalStrengthTraining"],
    "DECHARGE":  ["Walking", "Hiking"],
}


def _get_user_by_import_token(token: str, db: Session) -> Utilisateur:
    user = db.query(Utilisateur).filter(Utilisateur.import_token == token).first()
    if not user:
        raise HTTPException(401, "Token invalide")
    return user


@app.get("/api/auth/import-token", summary="Retourne (et genere si besoin) le token d import iOS")
def get_import_token(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    if not current_user.import_token:
        current_user.import_token = _secrets.token_urlsafe(32)
        db.commit()
    return {"import_token": current_user.import_token}


@app.post("/api/auth/import-token/regenerer", summary="Regenere le token d import")
def regenerer_import_token(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    current_user.import_token = _secrets.token_urlsafe(32)
    db.commit()
    return {"import_token": current_user.import_token}


@app.get("/api/import/seances-recentes", summary="Seances non validees des 3 derniers jours (auth par token)")
def import_seances_recentes(
    token: str = Query(...),
    db: Session = Depends(obtenir_session),
):
    user = _get_user_by_import_token(token, db)
    aujourd_hui = date.today()
    depuis = aujourd_hui - timedelta(days=3)
    demain  = aujourd_hui + timedelta(days=1)

    seances = (
        db.query(SeanceEntrainement)
        .join(SemaineEntrainement, SeanceEntrainement.semaine_id == SemaineEntrainement.id)
        .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
        .filter(
            Macrocycle.utilisateur_id == user.id,
            SeanceEntrainement.date_seance >= depuis,
            SeanceEntrainement.date_seance <= demain,
        )
        .order_by(SeanceEntrainement.date_seance.desc())
        .all()
    )

    result = []
    for s in seances:
        if s.journal and s.journal.completee:
            continue  # deja validee
        types_health = _TYPE_SEANCE_TO_HEALTH.get(s.type_seance.value, [])
        result.append({
            "id":           s.id,
            "titre":        s.titre,
            "type":         s.type_seance.value,
            "date":         str(s.date_planifiee) if s.date_planifiee else None,
            "types_health": types_health,
            "duree_cible_min": s.duree_cible_min,
            "distance_cible_km": s.distance_cible_km,
        })
    return {"seances": result}


class WorkoutImportSchema(BaseModel):
    token:          str
    seance_id:      int
    health_type:    Optional[str]  = None
    duree_min:      Optional[int]  = None
    distance_km:    Optional[float] = None
    dplus_m:        Optional[int]  = None
    fc_moyenne_bpm: Optional[int]  = None
    fc_max_bpm:     Optional[int]  = None
    calories:       Optional[int]  = None
    rpe:            Optional[float] = Field(None, ge=1, le=10)
    notes:          Optional[str]  = None


@app.post("/api/import/workout", summary="Importe un workout Apple Watch dans une seance")
def import_workout(
    payload: WorkoutImportSchema,
    db: Session = Depends(obtenir_session),
):
    user = _get_user_by_import_token(payload.token, db)

    seance = db.query(SeanceEntrainement).filter(
        SeanceEntrainement.id == payload.seance_id,
        SeanceEntrainement.utilisateur_id == user.id,
    ).first()
    if not seance:
        raise HTTPException(404, "Seance introuvable")

    if seance.journal and seance.journal.completee:
        # Mise a jour si deja valide
        j = seance.journal
        if payload.duree_min is not None:      j.duree_reelle_min   = payload.duree_min
        if payload.distance_km is not None:    j.distance_reelle_km = payload.distance_km
        if payload.dplus_m is not None:        j.dplus_reel_m       = payload.dplus_m
        if payload.fc_moyenne_bpm is not None: j.fc_moyenne_bpm     = payload.fc_moyenne_bpm
        if payload.fc_max_bpm is not None:     j.fc_max_bpm         = payload.fc_max_bpm
        if payload.rpe is not None:            j.rpe                = payload.rpe
        if payload.notes is not None:          j.notes              = payload.notes
        j.completee = True
    else:
        j = JournalSeance(
            utilisateur_id=user.id,
            seance_id=payload.seance_id,
            completee=True,
            duree_reelle_min=payload.duree_min,
            distance_reelle_km=payload.distance_km,
            dplus_reel_m=payload.dplus_m,
            fc_moyenne_bpm=payload.fc_moyenne_bpm,
            fc_max_bpm=payload.fc_max_bpm,
            rpe=payload.rpe,
            notes=payload.notes,
        )
        db.add(j)
    db.commit()
    return {"ok": True, "seance": seance.titre}
