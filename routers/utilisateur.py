"""Routes du domaine utilisateur : profil, préférences, programme, export/suppression de compte."""

from __future__ import annotations

from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import obtenir_session
from models import (
    BiometrieUtilisateur,
    ExerciceSeance,
    JournalSeance,
    Macrocycle,
    ObjectifCourse,
    PushSubscription,
    SeanceEntrainement,
    SemaineEntrainement,
    Utilisateur,
    VariationExercice,
)
from deps import (
    get_current_user,
    _hash_password,
    _verify_password,
    _parser_historique_perf,
    _calibration_utilisateur,
    _injecter_seances_velo,
)

router = APIRouter()

class UpdateProgrammeSchema(BaseModel):
    type_programme: Optional[str] = None  # "hybride" | "muscu" | "course"
    seances_semaine: Optional[int] = Field(None, ge=1, le=14)
    seances_muscu_semaine: Optional[int] = Field(None, ge=0, le=14)
    seances_course_semaine: Optional[int] = Field(None, ge=0, le=14)
    seances_velo_semaine: Optional[int] = Field(None, ge=0, le=14)
    type_muscu: Optional[str] = None   # "poids_corps" | "salle"
    type_course: Optional[str] = None  # "route" | "trail" | "route_trail"
    frequence_tests_semaines: Optional[int] = Field(None, ge=1, le=52)


@router.patch("/api/utilisateur/programme", summary="Modifier les paramètres programme et régénérer les séances futures")
def update_programme(
    payload: UpdateProgrammeSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    from seed_seances import (
        MODULE1, MODULE2, MODULE3,
        calibrer_module,
        adapter_contenu_muscu, adapter_contenu_gym, adapter_contenu_course,
        enrichir_paces_vma,
    )

    # 1. Mettre à jour les préférences utilisateur
    if payload.type_programme is not None:
        current_user.type_programme = payload.type_programme
    if payload.seances_semaine is not None:
        current_user.seances_semaine = payload.seances_semaine
    if payload.seances_muscu_semaine is not None:
        current_user.seances_muscu_semaine = payload.seances_muscu_semaine
    if payload.seances_course_semaine is not None:
        current_user.seances_course_semaine = payload.seances_course_semaine
    if payload.seances_velo_semaine is not None:
        current_user.seances_velo_semaine = payload.seances_velo_semaine
    if payload.type_muscu is not None:
        current_user.type_muscu = payload.type_muscu
    if payload.type_course is not None:
        current_user.type_course = payload.type_course
    if payload.frequence_tests_semaines is not None:
        current_user.frequence_tests_semaines = payload.frequence_tests_semaines
    db.flush()

    # 2. Identifier les semaines non démarrées (aucune séance avec journal)
    today = date.today()
    mcs = db.query(Macrocycle).filter(Macrocycle.utilisateur_id == current_user.id).all()

    n_muscu = current_user.seances_muscu_semaine if current_user.seances_muscu_semaine is not None else 2
    seances_total = current_user.seances_semaine or 5
    n_course = current_user.seances_course_semaine if current_user.seances_course_semaine is not None else max(1, seances_total - n_muscu)
    muscu_adapter = adapter_contenu_gym if current_user.type_muscu == "salle" else adapter_contenu_muscu

    from intelligence_programme import appliquer_profil_au_contenu as _apc_upd
    hist_upd = _parser_historique_perf(current_user.historique_perf, current_user.id)
    profil_upd, calib = _calibration_utilisateur(db, current_user, hist_upd)
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

    semaines_regenerees = []  # pour réinjecter le vélo au besoin

    for mc in mcs:
        sems = (
            db.query(SemaineEntrainement)
            .filter(SemaineEntrainement.macrocycle_id == mc.id)
            .order_by(SemaineEntrainement.date_debut)
            .all()
        )

        # Numéros des semaines futures non démarrées à régénérer
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
            # Supprimer les séances non validées de cette semaine
            ids_seances = [s.id for s in seances_sem]
            if ids_seances:
                db.query(ExerciceSeance).filter(ExerciceSeance.seance_id.in_(ids_seances)).delete(synchronize_session=False)
                db.query(SeanceEntrainement).filter(SeanceEntrainement.semaine_id == sem.id).delete(synchronize_session=False)
            nums_a_regenerer.add(sem.numero_semaine)

        db.flush()

        # Mémoriser les semaines vidées pour y réinjecter le vélo ensuite
        semaines_regenerees.extend(s for s in sems if s.numero_semaine in nums_a_regenerer)

        if not nums_a_regenerer:
            continue

        # Vélo pur : pas de contenu course/muscu, seul le vélo sera réinjecté ensuite
        if current_user.type_programme == "velo":
            continue

        # Préparer le contenu calibré pour ce macrocycle
        module_data = modules.get(mc.numero_cycle, MODULE1)
        calibrated = calibrer_module(module_data, kf, af, rf)
        calibrated = _apc_upd(calibrated, profil_upd, calib)
        if vma_for_paces:
            calibrated = enrichir_paces_vma(calibrated, vma_for_paces)
        adapted = adapter_contenu_course(muscu_adapter(calibrated, n_muscu, current_user.sexe), n_course)

        # Injecter uniquement les semaines vidées (sans toucher aux semaines passées)
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

    # Réinjecter les séances vélo dans les semaines régénérées (velo / hybride)
    if semaines_regenerees:
        db.flush()
        _injecter_seances_velo(db, current_user, current_user.type_programme, semaines_regenerees)

    db.commit()
    return {"ok": True}
class ProfilFCSchema(BaseModel):
    fc_max: Optional[int] = Field(None, gt=0, lt=250)
    fc_repos: Optional[int] = Field(None, gt=0, lt=150)
    poids_kg: Optional[float] = Field(None, gt=0, lt=300)

@router.get("/api/utilisateur/profil-fc", summary="Récupère fc_max, fc_repos et poids_kg de l'utilisateur")
def get_profil_fc(current_user: Utilisateur = Depends(get_current_user)):
    return {"fc_max": current_user.fc_max, "fc_repos": current_user.fc_repos, "poids_kg": current_user.poids_kg}

@router.patch("/api/utilisateur/profil-fc", summary="Met à jour fc_max, fc_repos et/ou poids_kg")
def patch_profil_fc(payload: ProfilFCSchema, current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    from models import PoidsUtilisateur
    if payload.fc_max is not None: current_user.fc_max = payload.fc_max
    if payload.fc_repos is not None: current_user.fc_repos = payload.fc_repos
    if payload.poids_kg is not None:
        # Nouveau relevé de poids → point d'historique (uniquement si la valeur change)
        ancien = current_user.poids_kg
        if ancien is None or abs(payload.poids_kg - ancien) > 0.001:
            db.add(PoidsUtilisateur(utilisateur_id=current_user.id, poids_kg=payload.poids_kg))
        current_user.poids_kg = payload.poids_kg
    db.commit()
    return {"fc_max": current_user.fc_max, "fc_repos": current_user.fc_repos, "poids_kg": current_user.poids_kg}


@router.get("/api/utilisateur/poids/historique", summary="Historique des relevés de poids (évolution)")
def historique_poids(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    from models import PoidsUtilisateur
    entrees = (
        db.query(PoidsUtilisateur)
        .filter(PoidsUtilisateur.utilisateur_id == current_user.id)
        .order_by(PoidsUtilisateur.enregistre_le)
        .all()
    )
    points = [{"date": e.enregistre_le.strftime("%Y-%m-%d"), "poids": round(e.poids_kg, 1)} for e in entrees]
    # Aucun historique mais un poids existant (saisi avant cette fonctionnalité) :
    # on crée un point de départ daté de la création du compte (date réelle du 1er poids).
    if not points and current_user.poids_kg:
        d0 = current_user.cree_le.date() if current_user.cree_le else date.today()
        points.append({"date": d0.strftime("%Y-%m-%d"), "poids": round(current_user.poids_kg, 1)})
    return {"points": points}


class PreferencesSchema(BaseModel):
    seances_muscu_semaine: Optional[int] = Field(None, ge=1, le=5)
    frequence_tests_semaines: Optional[int] = Field(None, ge=2, le=16)

@router.patch("/api/utilisateur/preferences", summary="Met à jour les préférences d'entraînement")
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

@router.patch("/api/utilisateur/infos", summary="Met à jour les informations personnelles")
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


# Pas de stockage objet dédié (S3, etc.) : la photo est enregistrée telle
# quelle en base sous forme de data URL, d'où la limite de taille stricte.
MAX_PHOTO_DATA_URL_LEN = 2_000_000  # ~1,5 Mo décodé

class PhotoSchema(BaseModel):
    photo_url: Optional[str] = None

@router.patch("/api/utilisateur/photo", summary="Met à jour (ou supprime) la photo de profil")
def patch_utilisateur_photo(
    payload: PhotoSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    photo = payload.photo_url
    if photo:
        if not photo.startswith("data:image/"):
            raise HTTPException(400, "Format de photo invalide")
        if len(photo) > MAX_PHOTO_DATA_URL_LEN:
            raise HTTPException(413, "Photo trop grande (max environ 1,5 Mo)")
    current_user.photo_url = photo
    db.commit()
    return {"ok": True}


class PasswordChangeSchema(BaseModel):
    ancien_mot_de_passe: str
    nouveau_mot_de_passe: str = Field(min_length=8)

@router.patch("/api/utilisateur/password", summary="Change le mot de passe")
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


class FuseauHoraireSchema(BaseModel):
    fuseau_horaire: str

@router.patch("/api/utilisateur/fuseau-horaire", summary="Enregistre le fuseau horaire détecté côté navigateur")
def patch_fuseau_horaire(
    payload: FuseauHoraireSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    try:
        ZoneInfo(payload.fuseau_horaire)
    except Exception:
        raise HTTPException(400, "Fuseau horaire invalide")
    current_user.fuseau_horaire = payload.fuseau_horaire
    db.commit()
    return {"ok": True}


@router.get("/api/utilisateur/export", summary="Exporte toutes les données du compte (portabilité RGPD)")
def exporter_donnees(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    """Dump générique (colonne par colonne) des données personnelles de l'utilisateur."""
    import enum as _enum
    from models import PoidsUtilisateur

    def _dump(obj):
        d = {}
        for col in obj.__table__.columns:
            v = getattr(obj, col.name)
            if isinstance(v, (datetime, date)):
                v = v.isoformat()
            elif isinstance(v, _enum.Enum):
                v = v.value
            d[col.name] = v
        return d

    macrocycles = []
    for mc in current_user.macrocycles:
        semaines = []
        for sem in mc.semaines:
            seances = []
            for s in sem.seances:
                seance = _dump(s)
                seance["exercices"] = [_dump(e) for e in s.exercices]
                if s.journal:
                    journal = _dump(s.journal)
                    journal["exercices"] = [_dump(je) for je in s.journal.journaux_exercices]
                    seance["journal"] = journal
                else:
                    seance["journal"] = None
                seances.append(seance)
            semaine = _dump(sem)
            semaine["seances"] = seances
            semaines.append(semaine)
        macrocycle = _dump(mc)
        macrocycle["semaines"] = semaines
        macrocycles.append(macrocycle)

    evaluations = []
    for ev in current_user.journaux_evaluation:
        e = _dump(ev)
        e["demi_cooper"] = _dump(ev.demi_cooper) if ev.demi_cooper else None
        e["resultats_max_1min"] = [_dump(r) for r in ev.resultats_max_1min]
        e["benchmark_amrap"] = _dump(ev.benchmark_amrap) if ev.benchmark_amrap else None
        evaluations.append(e)

    poids = (
        db.query(PoidsUtilisateur)
        .filter_by(utilisateur_id=current_user.id)
        .order_by(PoidsUtilisateur.enregistre_le)
        .all()
    )
    objectifs = db.query(ObjectifCourse).filter_by(utilisateur_id=current_user.id).all()

    profil = _dump(current_user)
    profil.pop("password_hash", None)

    return {
        "profil": profil,
        "historique_poids": [_dump(p) for p in poids],
        "objectifs_course": [_dump(o) for o in objectifs],
        "biometries": [_dump(b) for b in current_user.biometries],
        "macrocycles": macrocycles,
        "evaluations": evaluations,
    }


@router.delete("/api/utilisateur", summary="Supprime définitivement le compte et toutes les données associées")
def supprimer_compte(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    from models import PoidsUtilisateur
    # Pas de relation ORM cascade déclarée sur Utilisateur pour ces 3 tables
    # (cf. models.py) : suppression explicite avant celle de l'utilisateur.
    db.query(PoidsUtilisateur).filter_by(utilisateur_id=current_user.id).delete()
    db.query(ObjectifCourse).filter_by(utilisateur_id=current_user.id).delete()
    db.query(PushSubscription).filter_by(utilisateur_id=current_user.id).delete()
    db.delete(current_user)
    db.commit()
    return {"ok": True}


@router.get("/api/utilisateur/preferences", summary="Récupère les préférences d'entraînement")
def get_preferences(current_user: Utilisateur = Depends(get_current_user)):
    return {
        "seances_muscu_semaine": current_user.seances_muscu_semaine or 2,
        "frequence_tests_semaines": current_user.frequence_tests_semaines or 8,
        "type_programme": current_user.type_programme,
        "objectif_type": current_user.objectif_type,
    }

