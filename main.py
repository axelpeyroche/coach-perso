"""
API FastAPI — Coach d'Entraînement Hybride EPC.

Routes :
    POST /api/evaluations/              Créer une session d'évaluation
    POST /api/evaluations/{id}/demi-cooper      Enregistrer un Demi-Cooper
    POST /api/evaluations/{id}/max-1min         Enregistrer les scores Max 1 min
    POST /api/evaluations/{id}/amrap-benchmark  Enregistrer le score AMRAP Benchmark
    GET  /api/analytics/tendances-physiologiques
    GET  /api/analytics/distribution-volume
    GET  /api/analytics/biometrie-recuperation
    GET  /api/macrocycles/{id}/semaines
    POST /api/seances/{id}/journal              Journaliser une séance complétée
"""

from __future__ import annotations

from datetime import datetime, date, timedelta
from typing import Optional

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
    Utilisateur,
    VariationExercice,
)

app = FastAPI(
    title="Coach EPC — API",
    description="API du coach d'entraînement hybride Course & Musculation au poids du corps.",
    version="1.0.0",
)

def _initialiser_donnees_demo():
    """Crée un utilisateur et 2 macrocycles (Module 1 + Module 2) si la base est vide."""
    from models import Utilisateur, SemaineEntrainement
    from periodization_rules import BLUEPRINT_MACROCYCLE, generer_dates_semaines
    db = next(obtenir_session())
    try:
        if db.query(Utilisateur).count() == 0:
            user = Utilisateur(email="coach@perso.fr", nom="Athlète EPC")
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
# Auth — JWT + bcrypt
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
        raise HTTPException(401, "Non authentifié")
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
    """Envoi de la notification push pour une séance planifiée (appelé par APScheduler)."""
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
            "title": f"🏃 Séance du jour : {seance.titre}",
            "body": f"C'est l'heure de ta séance ! {seance.heure_planifiee or ''}".strip(),
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
    """Ajoute ou supprime un job APScheduler pour la notification de la séance."""
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
        # Re-planifie les notifications pour toutes les séances futures encore non validées
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
# Auth — Register / Login / Me / Onboarding
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


@app.post("/api/auth/register", summary="Crée un nouveau compte")
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
        raise HTTPException(500, f"Erreur base de données: {e}")
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


@app.get("/api/auth/me", summary="Retourne le profil de l'utilisateur connecté")
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


@app.post("/api/auth/reset-onboarding", summary="Réinitialise l'onboarding et supprime le programme")
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
        return "—"
    s = 3600 / kmh
    return f"{int(s // 60)}:{int(s % 60):02d}/km"


def _calculer_volume_pic(distance_km: float) -> float:
    """Volume hebdomadaire pic recommandé (km/semaine) selon la distance cible."""
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
    """VMA nécessaire (km/h) pour atteindre l'objectif temps sur la distance."""
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

    # km_factor — calé sur le volume hebdomadaire actuel
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

    # amrap_factor — calé sur les performances muscu
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


@app.post("/api/auth/onboarding", summary="Complète l'onboarding et génère le programme")
def onboarding(
    payload: OnboardingSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    import json as _json
    from models import SemaineEntrainement
    from periodization_rules import BLUEPRINT_MACROCYCLE, generer_dates_semaines, generer_blueprint_course
    from seed_seances import MODULE1, MODULE2, MODULE3, _POOL_SURCHARGE, _semaine_course, _semaine_taper_course, _inserer_seances_en_session, calibrer_module, adapter_contenu_muscu, adapter_contenu_gym, adapter_contenu_course, enrichir_paces_vma

    # Sauvegarder préférences
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

    # Calibration depuis l'historique de performance
    calib = {"km_factor": 1.0, "amrap_factor": 1.0, "reps_factor": 1.0}
    if payload.historique_perf:
        current_user.historique_perf = _json.dumps(payload.historique_perf, ensure_ascii=False)
        hist = payload.historique_perf
        calib = _calculer_calibration(hist)

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

    # Supprimer ancien programme si existant
    for mc_old in db.query(Macrocycle).filter(Macrocycle.utilisateur_id == current_user.id).all():
        db.delete(mc_old)
    db.flush()

    # Récupérer objectif course si existant
    obj_course = db.query(ObjectifCourse).filter(
        ObjectifCourse.utilisateur_id == current_user.id
    ).order_by(ObjectifCourse.id.desc()).first()

    kf = calib["km_factor"]
    af = calib["amrap_factor"]
    rf = calib["reps_factor"]

    if obj_course and payload.objectif_type in ("course", "hybride"):
        from models import TypeMacrophase
        n_semaines = max(4, (obj_course.date_course - debut).days // 7)
        n_surcharge = n_semaines - 3
        eval_freq = current_user.frequence_tests_semaines or 8

        # Blueprint adaptatif + marquage des semaines d'évaluation dans la période de surcharge
        blueprint = generer_blueprint_course(n_semaines)
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

        # VMA pour enrichissement des descriptions
        vma_for_paces = None
        if payload.historique_perf and payload.historique_perf.get("vma_estimee"):
            try:
                vma_for_paces = float(payload.historique_perf["vma_estimee"])
            except (TypeError, ValueError):
                pass

        # Contenu des séances : surcharge progressive + semaines d'évaluation
        # Volume progressif : facteur km augmente de kf (niveau actuel) vers f_pic (volume objectif)
        vol_pic = _calculer_volume_pic(obj_course.distance_km)
        BASELINE_VOL = 35.0
        f_pic = min(vol_pic / BASELINE_VOL, kf * 2.2)  # cap à 2.2× le niveau actuel

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
                week_kf = kf + (f_pic - kf) * (progress ** 0.75)
                pool_key = min(pool_idx, 15)
                week_content = calibrer_module({1: _POOL_SURCHARGE[pool_key]}, week_kf, af, rf)[1]
                content[i] = week_content
                pool_idx += 1
                build_count += 1
        content[n_surcharge + 1] = m1_cal.get(6, MODULE1[6])  # décharge calibrée
        content[n_surcharge + 2] = _semaine_taper_course()     # taper pré-course (pas de prépa tests)
        content[n_semaines] = _semaine_course(obj_course.date_course, obj_course.nom)

        # Enrichissement des descriptions avec allures réelles
        if vma_for_paces and vma_for_paces >= 5.0:
            content = enrichir_paces_vma(content, vma_for_paces)

        n_muscu = current_user.seances_muscu_semaine or 2
        n_course = current_user.seances_course_semaine or 3
        muscu_adapter = adapter_contenu_gym if current_user.type_muscu == "salle" else adapter_contenu_muscu
        adapted = adapter_contenu_course(muscu_adapter(content, n_muscu, current_user.sexe), n_course)
        _inserer_seances_en_session(db, mc, adapted)
    else:
        # Programme standard 2 macrocycles avec sessions calibrées
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
            if vma_for_paces and vma_for_paces >= 5.0:
                calibrated = enrichir_paces_vma(calibrated, vma_for_paces)
            adapted = adapter_contenu_course(muscu_adapter(calibrated, n_muscu, current_user.sexe), n_course)
            _inserer_seances_en_session(db, mc, adapted)

    db.commit()
    return {"ok": True, "message": "Onboarding terminé, programme généré."}


# ---------------------------------------------------------------------------
# Schémas Pydantic
# ---------------------------------------------------------------------------

class ProfilFCSchema(BaseModel):
    fc_max: Optional[int] = Field(None, gt=0, lt=250)
    fc_repos: Optional[int] = Field(None, gt=0, lt=150)
    poids_kg: Optional[float] = Field(None, gt=0, lt=300)

@app.get("/api/utilisateur/profil-fc", summary="Récupère fc_max, fc_repos et poids_kg de l'utilisateur")
def get_profil_fc(current_user: Utilisateur = Depends(get_current_user)):
    return {"fc_max": current_user.fc_max, "fc_repos": current_user.fc_repos, "poids_kg": current_user.poids_kg}

@app.patch("/api/utilisateur/profil-fc", summary="Met à jour fc_max, fc_repos et/ou poids_kg")
def patch_profil_fc(payload: ProfilFCSchema, current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    if payload.fc_max is not None: current_user.fc_max = payload.fc_max
    if payload.fc_repos is not None: current_user.fc_repos = payload.fc_repos
    if payload.poids_kg is not None: current_user.poids_kg = payload.poids_kg
    db.commit()
    return {"fc_max": current_user.fc_max, "fc_repos": current_user.fc_repos, "poids_kg": current_user.poids_kg}


class PreferencesSchema(BaseModel):
    seances_muscu_semaine: Optional[int] = Field(None, ge=1, le=5)
    frequence_tests_semaines: Optional[int] = Field(None, ge=2, le=16)

@app.patch("/api/utilisateur/preferences", summary="Met à jour les préférences d'entraînement")
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

@app.patch("/api/utilisateur/infos", summary="Met à jour les informations personnelles")
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
            raise HTTPException(409, "Cet email est déjà utilisé")
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


@app.get("/api/utilisateur/preferences", summary="Récupère les préférences d'entraînement")
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
    distance_metres: float = Field(..., gt=0, description="Distance parcourue en 6 minutes (mètres)")
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
    utilisateur_id: Optional[int] = None  # ignoré — on utilise current_user.id
    completee: bool = True
    rpe: Optional[float] = Field(None, ge=1, le=10)
    rpe_cible: Optional[float] = Field(None, ge=1, le=10)
    distance_reelle_km: Optional[float] = None
    duree_reelle_min: Optional[int] = None
    dplus_reel_m: Optional[int] = None
    fc_moyenne_bpm: Optional[int] = None
    fc_max_bpm: Optional[int] = None
    tours_amrap_completes: Optional[float] = None
    total_reps_enregistrees: Optional[int] = None
    notes: Optional[str] = None
    details_intervalles: Optional[str] = None  # JSON string


# ---------------------------------------------------------------------------
# Routes — Évaluations
# ---------------------------------------------------------------------------

@app.delete("/api/evaluations/incompletes", summary="Supprime les évaluations sans AMRAP ET sans Max 1 min")
def supprimer_evaluations_incompletes(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    evals = db.query(JournalEvaluationSeance).filter(JournalEvaluationSeance.utilisateur_id == current_user.id).all()
    supprimes = 0
    for ev in evals:
        if ev.benchmark_amrap is None and len(ev.resultats_max_1min) == 0:
            db.delete(ev)
            supprimes += 1
    db.commit()
    return {"supprimes": supprimes}


class ModifierEvaluationSchema(BaseModel):
    distance_metres: Optional[float] = None
    amrap_tours: Optional[float] = None
    max_1min: Optional[list[dict]] = None  # [{"exercice_id": int, "repetitions": int}]

@app.patch("/api/evaluations/{evaluation_id}", summary="Modifier les données d'une évaluation existante")
def modifier_evaluation(evaluation_id: int, payload: ModifierEvaluationSchema, db: Session = Depends(obtenir_session)):
    evaluation = db.get(JournalEvaluationSeance, evaluation_id)
    if not evaluation:
        raise HTTPException(404, "Évaluation introuvable")

    if payload.distance_metres is not None:
        cooper = evaluation.demi_cooper
        if cooper:
            cooper.distance_metres = payload.distance_metres
            cooper.vma_calculee_kmh = ResultatDemiCooper.calculer_vma(payload.distance_metres)
            # Met à jour la biométrie liée
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


@app.get("/api/evaluations/historique", summary="Historique des évaluations passées")
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


@app.post("/api/evaluations/", summary="Créer une session d'évaluation")
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
    summary="Enregistrer un résultat Demi-Cooper et recalculer la VMA",
)
def enregistrer_demi_cooper(
    evaluation_id: int,
    payload: DemiCooperSchema,
    db: Session = Depends(obtenir_session),
):
    evaluation = db.get(JournalEvaluationSeance, evaluation_id)
    if not evaluation:
        raise HTTPException(404, "Évaluation introuvable")

    vma = ResultatDemiCooper.calculer_vma(payload.distance_metres)

    # Créer le snapshot biométrique avec toutes les zones recalculées
    biometrie = BiometrieUtilisateur.depuis_demi_cooper(
        utilisateur_id=evaluation.utilisateur_id,
        distance_metres=payload.distance_metres,
        fc_max=payload.fc_max,
    )
    db.add(biometrie)
    db.flush()  # obtenir l'id avant de le référencer

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
    summary="Enregistrer les scores Max Répétitions 1 Minute",
)
def enregistrer_max_1min(
    evaluation_id: int,
    payload: list[Max1MinSchema],
    db: Session = Depends(obtenir_session),
):
    evaluation = db.get(JournalEvaluationSeance, evaluation_id)
    if not evaluation:
        raise HTTPException(404, "Évaluation introuvable")

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
        raise HTTPException(404, "Évaluation introuvable")

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
# Routes — Journalisation des séances
# ---------------------------------------------------------------------------

@app.post(
    "/api/seances/{seance_id}/journal",
    summary="Journaliser une séance complétée",
)
def journaliser_seance(
    seance_id: int,
    payload: JournalSeanceSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    seance = db.get(SeanceEntrainement, seance_id)
    if not seance:
        raise HTTPException(404, "Séance introuvable")

    if seance.journal:
        raise HTTPException(409, "Journal déjà créé pour cette séance — utilisez PATCH")

    journal = JournalSeance(
        utilisateur_id=current_user.id,
        seance_id=seance_id,
        completee=payload.completee,
        rpe=payload.rpe,
        rpe_cible=payload.rpe_cible,
        distance_reelle_km=payload.distance_reelle_km,
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
    summary="Pré-remplit les métriques physiques — en attente du RPE",
)
def prefill_seance(
    seance_id: int,
    payload: PrefillSeanceSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    seance = db.get(SeanceEntrainement, seance_id)
    if not seance:
        raise HTTPException(404, "Séance introuvable")

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
        return {"niveau": "facile", "titre": "Récupération standard",
                "conseil": "Belle séance légère ! Hydratation normale et 7-8h de sommeil suffisent."}
    elif r <= 6:
        return {"niveau": "modere", "titre": "Récupération classique",
                "conseil": "Étirements 10 min ce soir. Dors 8h et bois au moins 2L d'eau."}
    elif r <= 8:
        return {"niveau": "intense", "titre": "Récupération active",
                "conseil": "Protéines dans les 30 min (20-30 g). Étirements + foam roller. Vise 8-9h de sommeil."}
    elif r == 9:
        return {"niveau": "tres_intense", "titre": "Récupération prioritaire",
                "conseil": "Repos actif ou complet demain. Jambes surélevées 15 min. Minimum 9h de sommeil."}
    else:
        return {"niveau": "depassement", "titre": "Repos obligatoire",
                "conseil": "2 jours de repos minimum. Alimentation anti-inflammatoire. Consulte un médecin si douleurs persistantes."}


@app.patch(
    "/api/seances/{seance_id}/journal/valider",
    summary="Finalise la séance avec le RPE — marque completee=True",
)
def valider_rpe(
    seance_id: int,
    payload: ValiderRPESchema,
    db: Session = Depends(obtenir_session),
):
    seance = db.get(SeanceEntrainement, seance_id)
    if not seance or not seance.journal:
        raise HTTPException(404, "Journal introuvable — lance d'abord un prefill")
    seance.journal.rpe = payload.rpe
    seance.journal.notes = payload.notes
    seance.journal.completee = True
    db.commit()
    return {"ok": True, "conseil_recuperation": _conseil_recuperation(payload.rpe)}


@app.delete(
    "/api/seances/{seance_id}/journal",
    summary="Supprime le journal d'une séance (annule la validation)",
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


@app.patch("/api/seances/{seance_id}/planifier", summary="Planifie ou déplanifie une séance")
def planifier_seance(
    seance_id: int,
    payload: PlanifierSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    seance = db.get(SeanceEntrainement, seance_id)
    if not seance:
        raise HTTPException(404, "Séance introuvable")
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


@app.get("/api/push/vapid-public-key", summary="Retourne la clé publique VAPID")
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


@app.post("/api/push/test", summary="Envoie une notification push de test à l'utilisateur connecté")
def push_test(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    if not _PUSH_ENABLED or not _VAPID_PRIVATE:
        raise HTTPException(503, "Push non configuré sur ce serveur")
    subs = db.query(PushSubscription).filter_by(utilisateur_id=current_user.id).all()
    if not subs:
        raise HTTPException(404, "Aucun abonnement push enregistré pour cet utilisateur")
    import json as _json
    payload = _json.dumps({
        "title": "Coach EPC — Test 🔔",
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
            errors.append(str(e))
            db.delete(sub)
    db.commit()
    if sent == 0:
        raise HTTPException(500, f"Échec envoi push : {errors}")
    return {"ok": True, "sent": sent}


@app.patch(
    "/api/seances/{seance_id}/journal",
    summary="Modifie les données d'un journal existant",
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
    if payload.rpe is not None: j.rpe = payload.rpe
    if payload.notes is not None: j.notes = payload.notes
    if payload.duree_reelle_min is not None: j.duree_reelle_min = payload.duree_reelle_min
    if payload.distance_reelle_km is not None: j.distance_reelle_km = payload.distance_reelle_km
    if payload.dplus_reel_m is not None: j.dplus_reel_m = payload.dplus_reel_m
    if payload.fc_moyenne_bpm is not None: j.fc_moyenne_bpm = payload.fc_moyenne_bpm
    if payload.fc_max_bpm is not None: j.fc_max_bpm = payload.fc_max_bpm
    if payload.details_intervalles is not None: j.details_intervalles = payload.details_intervalles
    j.completee = True
    db.commit()
    return {"ok": True}


def _extraire_metriques_forme(texte: str) -> dict:
    """Parse le texte OCR d'un screenshot de l'app Forme (Apple Watch)."""
    metriques = {}

    # Durée — ex. "40:00" ou "1:05:30"
    m = re.search(r"\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b", texte)
    if m:
        if m.group(3):
            metriques["duree_reelle_min"] = int(m.group(1)) * 60 + int(m.group(2))
        else:
            metriques["duree_reelle_min"] = int(m.group(1)) * 60 + int(m.group(2))
            # Si format MM:SS et durée < 10 min, probablement des secondes
            if metriques["duree_reelle_min"] < 10:
                metriques["duree_reelle_min"] = int(m.group(1))

    # Distance — ex. "6,19 KM" ou "6.19 KM"
    m = re.search(r"([\d][,\.][\d]+|\d+)\s*K[Mm]", texte)
    if m:
        metriques["distance_reelle_km"] = float(m.group(1).replace(",", "."))

    # Dénivelé — ex. "Dénivelé : 19 M" ou "19 m"
    m = re.search(r"[Dd][ée]niv[eé]l[eé]\s*:?\s*(\d+)\s*[Mm]", texte)
    if m:
        metriques["dplus_reel_m"] = int(m.group(1))

    # FC moyenne — ex. "Moyenne : 153 BPM" (la première occurrence)
    matches_bpm = re.findall(r"[Mm]oyenne\s*:?\s*(\d+)\s*[Bb][Pp][Mm]", texte)
    if matches_bpm:
        metriques["fc_moyenne_bpm"] = int(matches_bpm[0])

    # FC max — ex. "89–165 BPM" ou "89-165 BPM"
    m = re.search(r"(\d+)\s*[–-]\s*(\d+)\s*[Bb][Pp][Mm]", texte)
    if m:
        metriques["fc_max_bpm"] = int(m.group(2))

    return metriques


@app.post(
    "/api/seances/{seance_id}/journal/analyse-screenshot",
    summary="Analyse un screenshot Forme via OCR et pré-remplit les métriques",
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
        raise HTTPException(404, "Séance introuvable")

    contenu = await file.read()
    try:
        image = Image.open(io.BytesIO(contenu)).convert("RGB")
        import numpy as np
        arr = np.array(image)
        ocr = RapidOCR()
        result, _ = ocr(arr)
        texte = "\n".join(r[1] for r in result) if result else ""
    except Exception as exc:
        raise HTTPException(500, f"OCR échoué : {exc}")

    metriques = _extraire_metriques_forme(texte)
    if not metriques:
        raise HTTPException(422, f"Aucune métrique détectée. Texte extrait : {texte[:300]!r}")

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
# Routes — Semaine courante
# ---------------------------------------------------------------------------

@app.get("/api/semaine-courante", summary="Retourne les séances de la semaine en cours")
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
        # Retourne la prochaine semaine à venir si aucune en cours
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
        raise HTTPException(404, "Aucune semaine trouvée")

    mc = semaine.macrocycle
    return {
        "semaine_id": semaine.id,
        "numero_semaine": semaine.numero_semaine,
        "macrophase": semaine.macrophase.value,
        "date_debut": str(semaine.date_debut),
        "macrocycle": {
            "id": mc.id,
            "numero_cycle": mc.numero_cycle,
            "nom": {1: "Module 1 — Adaptation", 2: "Module 2 — Révélation", 3: "Module 3 — Confirmation"}.get(mc.numero_cycle, f"Module {mc.numero_cycle}"),
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
                    "dplus_reel_m": s.journal.dplus_reel_m,
                    "fc_moyenne_bpm": s.journal.fc_moyenne_bpm,
                } if s.journal else None,
            }
            for s in sorted(semaine.seances, key=lambda x: x.date_seance)
        ],
    }


# ---------------------------------------------------------------------------
# Routes — Macrocycles
# ---------------------------------------------------------------------------

@app.get(
    "/api/macrocycles/{macrocycle_id}/semaines",
    summary="Récupérer les semaines d'un macrocycle avec leurs séances",
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
# Routes — Analytique
# ---------------------------------------------------------------------------

@app.get(
    "/api/analytics/tendances-physiologiques",
    summary="Évolution VMA et scores Max 1 min au fil des macrocycles",
)
def tendances_physiologiques(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.tendances_physiologiques(db, current_user.id)


@app.get(
    "/api/analytics/distribution-volume",
    summary="Kilométrage hebdomadaire, D+ cumulé et répartition musculaire Push/Pull/Jambes",
)
def distribution_volume(
    macrocycle_id: Optional[int] = Query(None),
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.distribution_volume(db, current_user.id, macrocycle_id)


@app.get(
    "/api/analytics/biometrie-recuperation",
    summary="Tendance RPE et Ratio Charge Aiguë/Chronique (ACWA) avec alerte risque blessure",
)
def biometrie_recuperation(
    macrocycle_id: Optional[int] = Query(None),
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    return analytics_service.biometrie_recuperation(db, current_user.id, macrocycle_id)


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

@app.get("/api/programme/toutes-semaines", summary="Toutes les semaines du programme — vue à plat sans notion de module")
def toutes_semaines_programme(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    mcs = db.query(Macrocycle).filter(Macrocycle.utilisateur_id == current_user.id).order_by(Macrocycle.numero_cycle).all()
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
                            "rpe": seance.journal.rpe,
                            "notes": seance.journal.notes,
                            "duree_reelle_min": seance.journal.duree_reelle_min,
                            "distance_reelle_km": seance.journal.distance_reelle_km,
                            "dplus_reel_m": seance.journal.dplus_reel_m,
                            "fc_moyenne_bpm": seance.journal.fc_moyenne_bpm,
                            "fc_max_bpm": seance.journal.fc_max_bpm,
                            "details_intervalles": seance.journal.details_intervalles,
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
            "nom": {1: "Module 1 — Adaptation", 2: "Module 2 — Révélation", 3: "Module 3 — Confirmation"}.get(mc.numero_cycle, f"Module {mc.numero_cycle}"),
        }
        for mc in mcs
    ]


@app.post("/api/admin/seed-seances", summary="Génère toutes les séances des 16 semaines EPC (2 macrocycles)")
def seed_seances_route(db: Session = Depends(obtenir_session)):
    from seed_seances import seed_module1, seed_module2, seed_module3
    try:
        seed_module1()
        seed_module2()
        seed_module3()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erreur seed : {exc}")
    return {"message": "Seed terminé."}


@app.post("/api/admin/init-macrocycles", summary="Crée les 2 macrocycles si absents (pour utilisateurs existants)")
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


@app.post("/api/admin/reseed", summary="Réinsère les exercices par défaut")
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
# Objectif course — race goal
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


@app.get("/api/objectif-course", summary="Récupère le prochain objectif de course")
def get_objectif_course(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    obj = (
        db.query(ObjectifCourse)
        .filter(ObjectifCourse.utilisateur_id == current_user.id)
        .order_by(ObjectifCourse.cree_le.desc())
        .first()
    )
    if not obj:
        raise HTTPException(status_code=404, detail="Aucun objectif de course enregistré")
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
        raise HTTPException(400, "Format de date invalide — attendu jj/mm/aaaa")
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
# Admin — reset macrocycles (dates)
# ---------------------------------------------------------------------------

@app.post("/api/admin/reset-macrocycles", summary="Recrée les 3 macrocycles depuis la date indiquée")
def reset_macrocycles(
    utilisateur_id: int = Query(1),
    date_debut: Optional[str] = Query(None, description="Date début au format jj/mm/aaaa (défaut : lundi prochain)"),
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
            raise HTTPException(400, "Format de date invalide — attendu jj/mm/aaaa")
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
        "message": "Macrocycles recréés. Lance maintenant /api/admin/seed-seances.",
        "macrocycles": crees,
    }


# ---------------------------------------------------------------------------
# Programme — initialisation depuis l'UI
# ---------------------------------------------------------------------------

class InitProgrammePayload(BaseModel):
    date_debut: str = Field(..., description="Date début du programme (lundi) au format jj/mm/aaaa")
    utilisateur_id: int = 1


@app.get("/api/programme/statut", summary="Statut du programme : existe-t-il ? quelle date de début ?")
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


@app.delete("/api/programme", summary="Supprime tous les macrocycles et séances de l'utilisateur")
def supprimer_programme(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    mcs = db.query(Macrocycle).filter(Macrocycle.utilisateur_id == current_user.id).all()
    for mc in mcs:
        db.delete(mc)
    db.commit()
    return {"message": f"{len(mcs)} macrocycle(s) supprimé(s)."}


@app.post("/api/programme/initialiser", summary="Génère le programme depuis la date choisie dans l'UI")
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
        raise HTTPException(400, "Format de date invalide — attendu jj/mm/aaaa")

    if debut_mc1.weekday() != 0:
        raise HTTPException(400, "La date de début doit être un lundi")

    user = current_user

    obj = db.query(ObjectifCourse).filter(
        ObjectifCourse.utilisateur_id == user.id
    ).order_by(ObjectifCourse.id.desc()).first()

    # Suppression des macrocycles existants (cascade ORM — même session)
    for mc_old in db.query(Macrocycle).filter(Macrocycle.utilisateur_id == user.id).all():
        db.delete(mc_old)
    db.flush()

    try:
        # ── CAS 1 : course planifiée → programme adaptatif N semaines ───────
        if obj:
            n_semaines = (obj.date_course - debut_mc1).days // 7
            if n_semaines < 4:
                raise HTTPException(400, f"La course est dans {n_semaines} semaine(s) — trop proche (minimum 4 semaines).")

            n_surcharge = n_semaines - 3
            blueprint = generer_blueprint_course(n_semaines)
            dates = [debut_mc1 + timedelta(weeks=i) for i in range(n_semaines)]

            # Injection des semaines d'évaluation dans le blueprint (AVANT insertion en BDD)
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

            # Calibration si historique dispo
            historique = {}
            if user.historique_perf:
                import json as _json
                try:
                    historique = _json.loads(user.historique_perf)
                except Exception:
                    historique = {}
            cal = _calculer_calibration(historique)
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
                ).order_by(BiometrieUtilisateur.date_mesure.desc()).first()
                if bio:
                    vma_init = bio.vma_kmh

            # Volume progressif
            vol_pic = _calculer_volume_pic(obj.distance_km)
            BASELINE_VOL = 35.0
            f_pic_init = min(vol_pic / BASELINE_VOL, kf_init * 2.2)

            n_build_weeks_init = sum(1 for i in range(1, n_surcharge + 1) if i % eval_freq != 0)
            content: dict = {}
            pool_idx = 1
            build_count = 0
            for i in range(1, n_surcharge + 1):
                if i % eval_freq == 0:
                    content[i] = MODULE1[8]
                else:
                    progress = build_count / max(1, n_build_weeks_init - 1) if n_build_weeks_init > 1 else 1.0
                    week_kf = kf_init + (f_pic_init - kf_init) * (progress ** 0.75)
                    pool_key = min(pool_idx, 15)
                    content[i] = calibrer_module({1: _POOL_SURCHARGE[pool_key]}, week_kf, af_init, rf_init)[1]
                    pool_idx += 1
                    build_count += 1
            content[n_surcharge + 1] = m1_cal_init.get(6, MODULE1[6])
            content[n_surcharge + 2] = _semaine_taper_course()
            content[n_semaines]      = _semaine_course(obj.date_course, obj.nom)

            # Enrichissement allures réelles
            if vma_init and vma_init >= 5.0:
                content = enrichir_paces_vma(content, vma_init)

            n_muscu = user.seances_muscu_semaine or 2
            n_course = user.seances_course_semaine or 3
            muscu_adapter = adapter_contenu_gym if user.type_muscu == "salle" else adapter_contenu_muscu
            adapted = adapter_contenu_course(muscu_adapter(content, n_muscu, user.sexe), n_course)
            _inserer_seances_en_session(db, mc, adapted)
            db.commit()

            return {
                "message": f"Programme orienté course généré : {n_semaines} semaines ({n_surcharge} de build + 2 de taper + semaine course).",
                "semaines_totales": n_semaines,
                "course": obj.nom,
            }

        # ── CAS 2 : pas de course → programme standard 3 × 8 semaines ───────
        # Recalibration si historique dispo
        historique_std = {}
        if user.historique_perf:
            import json as _json_std
            try:
                historique_std = _json_std.loads(user.historique_perf)
            except Exception:
                historique_std = {}
        cal_std = _calculer_calibration(historique_std)
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
            ).order_by(BiometrieUtilisateur.date_mesure.desc()).first()
            if bio_std:
                vma_std = bio_std.vma_kmh

        n_muscu = user.seances_muscu_semaine or 2
        n_course = user.seances_course_semaine or 3
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
            if vma_std and vma_std >= 5.0:
                calibrated_std = enrichir_paces_vma(calibrated_std, vma_std)
            adapted_std = adapter_contenu_course(muscu_adapter(calibrated_std, n_muscu, user.sexe), n_course)
            _inserer_seances_en_session(db, mc, adapted_std)
            mcs_crees.append(numero_cycle)

        db.commit()
        return {
            "message": "Programme performance générale généré : 3 modules × 8 semaines.",
            "semaines_totales": 24,
        }

    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(500, detail=f"Erreur génération : {type(exc).__name__}: {exc}")


# ---------------------------------------------------------------------------
# Intelligence sportive — analyse objectif + recalibration
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
        ).order_by(BiometrieUtilisateur.date_mesure.desc()).first()
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
            "très ambitieux"
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

        # Prédiction chrono basée sur VMA actuelle
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
        # Retourner un résultat vide plutôt qu'un 500 pour ne pas bloquer le Dashboard
        return {"objectif": None, "vma_actuelle": None, "vma_requise": None, "delta_vma": None, "_error": str(exc)}


@app.get("/api/programme/alerte-fatigue", summary="Détecte une fatigue excessive sur les 3 dernières séances")
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
            "message": f"RPE moyen de {rpe_moyen}/10 sur tes 3 dernières séances. Une semaine de décharge est recommandée.",
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
        s.titre = "Repos — Blessure"
        s.description = f"Repos forcé suite à une blessure ({payload.description or 'non précisée'}). Reprends progressivement après guérison."
        for ex in s.exercices:
            db.delete(ex)
    db.commit()
    return {"ok": True, "nb_seances_modifiees": len(seances), "fin_blessure": str(fin)}


@app.post("/api/programme/recalibrer", summary="Recalibre les séances restantes après un test d'évaluation")
def recalibrer_programme(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    """
    Après une semaine d'évaluation, met à jour la VMA et recalibre
    les descriptions de toutes les séances de course futures avec les nouvelles allures.
    """
    from datetime import date as date_cls
    from seed_seances import enrichir_paces_vma, calculer_paces_vma

    # VMA la plus récente
    bio = db.query(BiometrieUtilisateur).filter(
        BiometrieUtilisateur.utilisateur_id == current_user.id
    ).order_by(BiometrieUtilisateur.date_mesure.desc()).first()
    if not bio:
        raise HTTPException(400, "Aucune biométrie disponible. Effectuez d'abord un test Demi-Cooper.")

    vma = bio.vma_kmh
    if not vma or vma < 5.0:
        raise HTTPException(400, "VMA invalide ou non calculée.")

    paces = calculer_paces_vma(vma)
    zone_prefix = {
        "Z1": f"── Coach ({vma:.1f} km/h VMA) ────────────────\nAllure cible : {paces['Z1']} (Z1 — récupération — 60-65% VMA)\n──────────────────────────────────────\n",
        "Z2": f"── Coach ({vma:.1f} km/h VMA) ────────────────\nAllure cible : {paces['Z2']} (Z2 — endurance fond. — 65-75% VMA)\n──────────────────────────────────────\n",
        "Z3": f"── Coach ({vma:.1f} km/h VMA) ────────────────\nAllure cible : {paces['Z3']} (Z3 — tempo — 75-85% VMA)\n──────────────────────────────────────\n",
        "Z4": f"── Coach ({vma:.1f} km/h VMA) ────────────────\nAllure cible : {paces['Z4']} (Z4 — seuil lactique — 85-95% VMA)\n──────────────────────────────────────\n",
        "Z5": f"── Coach ({vma:.1f} km/h VMA) ────────────────\nAllure effort : {paces['Z5']} (Z5 — VO₂max — 100-105% VMA)\nAllure récup  : {paces['recup']} (Z1)\n──────────────────────────────────────\n",
    }

    today = date_cls.today()
    updated = 0

    # Mettre à jour toutes les séances de course futures
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
                coach_end = desc.find("──────────────────────────────────────\n")
                if coach_end >= 0 and "── Coach" in desc[:coach_end]:
                    desc = desc[coach_end + len("──────────────────────────────────────\n"):]
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
        "message": f"Recalibration effectuée avec VMA {vma:.1f} km/h. {updated} séance(s) de course mises à jour.",
    }


# ---------------------------------------------------------------------------
# Santé
# ---------------------------------------------------------------------------

@app.get("/", include_in_schema=False)
def racine():
    return {"statut": "Coach EPC opérationnel", "docs": "/docs"}


@app.get("/health", include_in_schema=False)
def sante():
    return {"statut": "ok", "timestamp": datetime.utcnow().isoformat()}


# ---------------------------------------------------------------------------
# Migration données historiques → nouveau compte
# ---------------------------------------------------------------------------

class MigrationSchema(BaseModel):
    ancien_user_id: int = 1

@app.post("/api/admin/migrer-donnees", summary="Réaffecte les données d'un ancien compte vers le compte connecté")
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
