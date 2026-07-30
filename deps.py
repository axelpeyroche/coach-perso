"""
Dépendances et infrastructure partagées entre les routers du domaine :
auth (hash/JWT), scheduler de notifications push, helpers de génération
de programme réutilisés par plusieurs domaines (onboarding, mise à jour
du programme, admin, initialisation manuelle).
"""

from __future__ import annotations

from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo
from typing import Optional
import json as _json_mod

import logging
import os

from fastapi import Depends, HTTPException, Header, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from jose import JWTError, jwt

logger = logging.getLogger(__name__)

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

from database import creer_tables, obtenir_session
from models import (
    BiometrieUtilisateur,
    JournalSeance,
    Macrocycle,
    PushSubscription,
    SeanceEntrainement,
    SemaineEntrainement,
    TypeSeance,
    Utilisateur,
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
        logger.exception("Échec de l'initialisation des données de démo")
        db.rollback()
    finally:
        db.close()
# ---------------------------------------------------------------------------
# Auth — JWT + PBKDF2-HMAC-SHA256
# ---------------------------------------------------------------------------

import hashlib, hmac as _hmac, os as _os, base64 as _b64, secrets as _secrets

ALGORITHM  = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 30  # 30 jours

SECRET_KEY = os.getenv("JWT_SECRET")
if not SECRET_KEY:
    # Pas de secret configuré (ex. variable d'env absente sur Render) : on génère un
    # secret aléatoire pour ce process plutôt que d'utiliser une valeur par défaut
    # connue publiquement. Tous les tokens déjà émis deviennent invalides à chaque
    # redémarrage tant que JWT_SECRET n'est pas défini explicitement.
    SECRET_KEY = _secrets.token_hex(32)
    print("⚠️  JWT_SECRET non défini — génération d'un secret temporaire pour ce process. "
          "Définis la variable d'environnement JWT_SECRET pour éviter la déconnexion de "
          "tous les utilisateurs à chaque redémarrage.")

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
        logger.warning("Hash de mot de passe illisible/corrompu rencontré lors de la vérification")
        return False

def _create_token(user_id: int) -> str:
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": str(user_id), "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)

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


_ADMIN_TOKEN = os.getenv("ADMIN_TOKEN")

def verifier_admin_token(x_admin_token: Optional[str] = Header(None)) -> None:
    """Protège les routes de maintenance /api/admin/* : nécessite ADMIN_TOKEN configuré et fourni."""
    if not _ADMIN_TOKEN or not _hmac.compare_digest(x_admin_token or "", _ADMIN_TOKEN):
        raise HTTPException(403, "Accès administrateur refusé")


def _obtenir_seance_utilisateur(db: Session, seance_id: int, current_user: "Utilisateur") -> "SeanceEntrainement":
    """Récupère une séance en vérifiant qu'elle appartient bien à l'utilisateur courant."""
    seance = (
        db.query(SeanceEntrainement)
        .join(SemaineEntrainement, SeanceEntrainement.semaine_id == SemaineEntrainement.id)
        .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
        .filter(
            SeanceEntrainement.id == seance_id,
            Macrocycle.utilisateur_id == current_user.id,
        )
        .first()
    )
    if not seance:
        raise HTTPException(404, "Séance introuvable")
    return seance
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


_FUSEAU_DEFAUT = "Europe/Paris"


def _planifier_notification(seance_id: int, date_planifiee, heure_planifiee: str | None) -> None:
    """Ajoute ou supprime un job APScheduler pour la notification de la séance.

    L'heure planifiée est saisie par l'utilisateur dans son fuseau horaire local
    (détecté et envoyé par le navigateur) : on la convertit ici, pas en heure
    serveur, sinon la notification part avec le décalage horaire du serveur.
    """
    if not _PUSH_ENABLED or _scheduler is None:
        return
    job_id = f"seance-{seance_id}"
    _scheduler.remove_job(job_id) if _scheduler.get_job(job_id) else None
    if not date_planifiee:
        return
    h, m = (int(x) for x in (heure_planifiee or "08:00").split(":"))
    db = next(obtenir_session())
    try:
        seance = db.get(SeanceEntrainement, seance_id)
        semaine = db.get(SemaineEntrainement, seance.semaine_id) if seance else None
        utilisateur = db.get(Utilisateur, semaine.macrocycle.utilisateur_id) if semaine else None
        fuseau = (utilisateur.fuseau_horaire if utilisateur else None) or _FUSEAU_DEFAUT
    finally:
        db.close()
    try:
        tz = ZoneInfo(fuseau)
    except Exception:
        tz = ZoneInfo(_FUSEAU_DEFAUT)
    run_at = datetime(date_planifiee.year, date_planifiee.month, date_planifiee.day, h, m, tzinfo=tz)
    if run_at > datetime.now(tz):
        _scheduler.add_job(
            _envoyer_push_seance, "date",
            run_date=run_at, args=[seance_id], id=job_id,
            misfire_grace_time=3600,
        )


def demarrage():
    """Appelé depuis le handler @app.on_event("startup") de main.py."""
    global _scheduler
    creer_tables()
    _initialiser_donnees_demo()
    if _PUSH_ENABLED:
        _scheduler = BackgroundScheduler()
        _scheduler.start()
        # Re-planifie les notifications pour toutes les séances futures encore non validées
        db = next(obtenir_session())
        try:
            seances = db.query(SeanceEntrainement).filter(
                SeanceEntrainement.date_planifiee.isnot(None)
            ).all()
            for s in seances:
                if s.journal and s.journal.completee:
                    continue
                _planifier_notification(s.id, s.date_planifiee, s.heure_planifiee)
        finally:
            db.close()
def _pace_str(kmh: float) -> str:
    """Convertit une vitesse km/h en allure min:sec/km."""
    if not kmh or kmh <= 0:
        return "—"
    s = 3600 / kmh
    return f"{int(s // 60)}:{int(s % 60):02d}/km"


def _fraction_vma_soutenable(distance_km: float) -> float:
    """Fraction de VMA soutenable selon la distance (interpolation linéaire, identique analytics_service)."""
    reperes = [(5.0, 0.92), (10.0, 0.86), (21.1, 0.80), (42.2, 0.74)]
    if distance_km <= reperes[0][0]:
        return reperes[0][1]
    if distance_km >= reperes[-1][0]:
        return reperes[-1][1]
    for (d1, f1), (d2, f2) in zip(reperes, reperes[1:]):
        if d1 <= distance_km <= d2:
            return f1 + (f2 - f1) * (distance_km - d1) / (d2 - d1)
    return 0.80


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


def _injecter_seances_velo(db, user, type_programme, semaines):
    """
    Ajoute des séances vélo (modèle polarisé 80/20, approche préparateur physique)
    aux semaines fournies, pour un programme « velo » (pur) ou « hybride ».
      • PMA 30/30 (Z5) — VO2max
      • Sweet spot (Z3-Z4) — puissance soutenable
      • Endurance & vélocité (Z2) — technique
      • Sortie longue (Z2) — base aérobie
    Décharge : volume -40 % + rappel d'intensité court. Évaluation : test FTP (vélo pur).
    Réutilisé par l'onboarding et par la mise à jour du programme.
    """
    if type_programme not in ("velo", "hybride"):
        return
    from models import TypeMacrophase as _TM

    fc = user.fc_max
    def _pl(lo, hi):
        return f" (FC {round(fc*lo)}-{round(fc*hi)} bpm)" if fc else ""

    def _seances(mult, phase, n):
        decharge = phase == _TM.DECHARGE
        f = 0.6 if decharge else mult
        pma = (1, "Vélo — PMA 30/30",
               "Échauffement 20 min Z2 progressif. Puis 2 séries de 8×(30s à intensité maximale soutenable"
               f" / 30s récup souple){_pl(0.90, 1.00)}, 5 min souple entre les séries. Cadence > 95 rpm."
               " Retour au calme 10 min. RPE cible 8-9 sur les efforts.",
               max(45, round(65 * f)))
        seuil = (3, "Vélo — Sweet spot",
                 "Échauffement 15 min Z2. Puis 3×12 min en sweet spot (88-94 % FTP, « inconfortable mais tenable »)"
                 f"{_pl(0.83, 0.90)}, cadence 85-95 rpm, récup 6 min souple entre les blocs."
                 " Retour au calme 10 min. RPE cible 7.",
                 max(50, round(75 * f)))
        tempo = (4, "Vélo — Endurance & vélocité",
                 "Z2 continu avec travail neuromusculaire : alterner 3×5 min vélocité (105-110 rpm, petit braquet)"
                 " et 3×5 min force (55-65 rpm, gros braquet, en restant assis)"
                 f"{_pl(0.65, 0.75)}. Le reste à cadence naturelle.",
                 max(45, round(60 * f)))
        longue = (5, "Vélo — Sortie longue",
                  "Endurance fondamentale Z2, allure strictement conversationnelle"
                  f"{_pl(0.65, 0.75)}. S'alimenter toutes les 45 min (40-60 g de glucides/h),"
                  " boire 500-750 ml/h.",
                  max(60, round(105 * f)))
        if decharge:
            rappel = (1, "Vélo — Rappel intensité",
                      "Échauffement 15 min Z2 puis 5×1 min à haute intensité (RPE 8), récup 2 min."
                      " Objectif : entretenir les qualités sans générer de fatigue. Total volontairement court.",
                      45)
            return [rappel, (5, longue[1], longue[2], max(60, round(90 * 0.6)))][:max(1, min(n, 2))]
        ordre = [longue, seuil, pma, tempo]
        return sorted(ordre[:max(1, min(n, 4))], key=lambda s: s[0])

    if type_programme == "velo":
        n_velo = max(1, min(user.seances_velo_semaine or user.seances_semaine or 3, 4))
    elif user.seances_velo_semaine is not None:
        n_velo = max(0, min(user.seances_velo_semaine, 4))
    else:
        n_velo = 2 if (user.seances_semaine or 4) >= 6 else 1
    if n_velo <= 0:
        return

    for sem in semaines:
        nb = db.query(SeanceEntrainement).filter(SeanceEntrainement.semaine_id == sem.id).count()
        if sem.macrophase == _TM.EVALUATION:
            if type_programme == "velo":
                jour = sem.date_debut + timedelta(days=2)
                db.add(SeanceEntrainement(
                    semaine_id=sem.id, date_seance=jour, type_seance=TypeSeance.VELO,
                    titre="Vélo — Test FTP 20 min",
                    description="Échauffement 20 min avec 3 accélérations progressives. Puis 20 min à l'intensité"
                                " maximale que tu peux maintenir sur toute la durée (départ conservateur !)."
                                " FTP estimée = 95 % de la puissance (ou FC) moyenne du test. Retour au calme 15 min.",
                    ordre_dans_semaine=nb + 1, duree_cible_min=60, date_planifiee=jour,
                ))
            continue
        mult = sem.multiplicateur_volume or 1.0
        for i, (offset, titre, desc, duree) in enumerate(_seances(mult, sem.macrophase, n_velo)):
            jour = sem.date_debut + timedelta(days=offset)
            db.add(SeanceEntrainement(
                semaine_id=sem.id, date_seance=jour, type_seance=TypeSeance.VELO,
                titre=titre, description=desc,
                ordre_dans_semaine=nb + 1 + i, duree_cible_min=duree, date_planifiee=jour,
            ))


def _parser_historique_perf(historique_perf_json, user_id):
    """Parse le JSON historique_perf stocké en base, en journalisant les échecs."""
    if not historique_perf_json:
        return {}
    try:
        return _json_mod.loads(historique_perf_json)
    except Exception:
        logger.warning("historique_perf illisible pour l'utilisateur %s", user_id)
        return {}


def _calibration_utilisateur(db, user, historique):
    """Construit le profil consolidé et la calibration v2 pour un utilisateur."""
    from intelligence_programme import construire_profil, calibration_v2
    profil = construire_profil(user, db, historique)
    calib = calibration_v2(historique, profil)
    return profil, calib


def _vma_depuis_historique_ou_bio(db, user, historique):
    """VMA connue via historique questionnaire, sinon dernière biométrie enregistrée."""
    vma = None
    if historique.get("vma_estimee"):
        try:
            vma = float(historique["vma_estimee"])
        except (TypeError, ValueError):
            pass
    if vma is None:
        bio = (
            db.query(BiometrieUtilisateur)
            .filter(BiometrieUtilisateur.utilisateur_id == user.id)
            .order_by(BiometrieUtilisateur.enregistre_le.desc())
            .first()
        )
        if bio:
            vma = bio.vma_kmh
    return vma


def _supprimer_ancien_programme(db, user):
    """Supprime les macrocycles existants de l'utilisateur (journaux d'abord pour éviter les FK)."""
    old_seance_ids = [
        s.id
        for mc_old in db.query(Macrocycle).filter(Macrocycle.utilisateur_id == user.id).all()
        for sem in mc_old.semaines
        for s in sem.seances
    ]
    if old_seance_ids:
        db.query(JournalSeance).filter(JournalSeance.seance_id.in_(old_seance_ids)).delete(synchronize_session=False)
    for mc_old in db.query(Macrocycle).filter(Macrocycle.utilisateur_id == user.id).all():
        db.delete(mc_old)
    db.flush()


def _generer_macrocycles_standard(db, user, debut_base, n_cycles, kf, af, rf, profil, calib, vma_for_paces, muscu_adapter, n_muscu, n_course):
    """Génère n_cycles macrocycles de 8 semaines (blueprint standard, contenu calibré).

    Factorise la boucle partagée par l'onboarding (2 cycles) et l'initialisation
    manuelle du programme (3 cycles) — reste identique par ailleurs.
    """
    from periodization_rules import BLUEPRINT_MACROCYCLE, generer_dates_semaines
    from intelligence_programme import appliquer_profil_au_contenu
    from seed_seances import (
        MODULE1, MODULE2, MODULE3, _inserer_seances_en_session, calibrer_module,
        adapter_contenu_course, enrichir_paces_vma,
    )
    modules = {1: MODULE1, 2: MODULE2, 3: MODULE3}
    for numero_cycle in range(1, n_cycles + 1):
        debut_mc = debut_base + timedelta(weeks=8 * (numero_cycle - 1))
        mc = Macrocycle(utilisateur_id=user.id, numero_cycle=numero_cycle,
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
        adapted = adapter_contenu_course(muscu_adapter(calibrated, n_muscu, user.sexe), n_course)
        _inserer_seances_en_session(db, mc, adapted)
