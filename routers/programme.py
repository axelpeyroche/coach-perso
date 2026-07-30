"""Routes du domaine programme : vue semaine/macrocycles, initialisation, statut, corrections et recalibration."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
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
    SeanceEntrainement,
    SemaineEntrainement,
    TypeSeance,
    Utilisateur,
    VariationExercice,
)
from deps import (
    get_current_user,
    _calculer_volume_pic,
    _calibration_utilisateur,
    _fraction_vma_soutenable,
    _generer_macrocycles_standard,
    _pace_str,
    _parser_historique_perf,
    _supprimer_ancien_programme,
    _vma_depuis_historique_ou_bio,
    _vma_requise,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Routes — Semaine courante
# ---------------------------------------------------------------------------

@router.get("/api/semaine-courante", summary="Retourne les séances de la semaine en cours")
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
# Routes — Macrocycles
# ---------------------------------------------------------------------------

@router.get(
    "/api/macrocycles/{macrocycle_id}/semaines",
    summary="Récupérer les semaines d'un macrocycle avec leurs séances",
)
def obtenir_semaines_macrocycle(
    macrocycle_id: int,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    macrocycle = db.get(Macrocycle, macrocycle_id)
    if not macrocycle or macrocycle.utilisateur_id != current_user.id:
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
@router.get("/api/programme/toutes-semaines", summary="Toutes les semaines du programme — vue à plat sans notion de module")
def toutes_semaines_programme(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    user = current_user
    mcs = db.query(Macrocycle).filter(Macrocycle.utilisateur_id == user.id).order_by(Macrocycle.numero_cycle).all()

    # Correction automatique du nombre de séances par semaine (bulk SQL)
    # Désactivée en mode manuel : l'utilisateur gère lui-même ses séances.
    try:
      if user.programme_auto:
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
                "semaine_id": s.id,
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
@router.get("/api/macrocycles", summary="Liste tous les macrocycles de l'utilisateur")
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
# ---------------------------------------------------------------------------
# Programme — initialisation depuis l'UI
# ---------------------------------------------------------------------------

class InitProgrammePayload(BaseModel):
    date_debut: str = Field(..., description="Date début du programme (lundi) au format jj/mm/aaaa")


@router.get("/api/programme/statut", summary="Statut du programme : existe-t-il ? quelle date de début ?")
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


@router.post("/api/programme/corriger-seances", summary="Supprime les séances en excès pour respecter seances_semaine")
def corriger_seances(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    """
    Sans recréer le programme, retire les séances course et muscu en surnombre
    pour que chaque semaine respecte seances_semaine total.
    Priorité de suppression course : EF Z2 (jour le plus tôt) en premier.
    Priorité de suppression muscu  : complément EMOM (titre contient '3e séance') en premier.
    Séances déjà validées (journal) : jamais supprimées.
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
        # Ne touche pas aux séances déjà validées
        non_validees = [s for s in seances if not s.journal]

        courses_nv = sorted(
            [s for s in non_validees if s.type_seance == TypeSeance.COURSE],
            key=lambda s: s.date_seance
        )
        muscu_types = {TypeSeance.EMOM, TypeSeance.AMRAP, TypeSeance.GYM_UPPER, TypeSeance.GYM_LOWER, TypeSeance.GYM_FULL}
        muscu_nv = [s for s in non_validees if s.type_seance in muscu_types]

        # Supprimer l'excès de course (du plus tôt = EF au plus tard)
        while len(courses_nv) > n_course:
            db.delete(courses_nv.pop(0))
            supprimees += 1

        # Supprimer l'excès de muscu (complément EMOM en priorité = titre contient '3e')
        total_muscu_target = seances_total - n_course
        muscu_nv_sorted = sorted(muscu_nv, key=lambda s: (0 if "3e" in (s.titre or "") else 1))
        while len(muscu_nv_sorted) > total_muscu_target:
            db.delete(muscu_nv_sorted.pop(0))
            supprimees += 1

    db.commit()
    return {"ok": True, "seances_supprimees": supprimees, "n_course_cible": n_course, "n_muscu_cible": total_muscu_target}


@router.delete("/api/programme", summary="Supprime tous les macrocycles et séances de l'utilisateur")
def supprimer_programme(current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    mcs = db.query(Macrocycle).filter(Macrocycle.utilisateur_id == current_user.id).all()
    for mc in mcs:
        db.delete(mc)
    db.commit()
    return {"message": f"{len(mcs)} macrocycle(s) supprimé(s)."}


@router.post("/api/programme/initialiser", summary="Génère le programme depuis la date choisie dans l'UI")
def initialiser_programme(payload: InitProgrammePayload, current_user: Utilisateur = Depends(get_current_user), db: Session = Depends(obtenir_session)):
    from models import SemaineEntrainement
    from periodization_rules import generer_blueprint_course
    from models import TypeMacrophase
    from seed_seances import (
        MODULE1,
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

    # Suppression des macrocycles existants (journaux d'abord pour éviter FK)
    _supprimer_ancien_programme(db, user)

    try:
        # ── CAS 1 : course planifiée → programme adaptatif N semaines ───────
        if obj:
            n_semaines = (obj.date_course - debut_mc1).days // 7
            if n_semaines < 4:
                raise HTTPException(400, f"La course est dans {n_semaines} semaine(s) — trop proche (minimum 4 semaines).")

            n_surcharge = n_semaines - 3

            # Calibration v2 avant blueprint (progression individualisée)
            from intelligence_programme import (
                generer_blueprint_course_v2, semaines_assimilation, appliquer_profil_au_contenu,
            )
            historique = _parser_historique_perf(user.historique_perf, user.id)
            profil, cal = _calibration_utilisateur(db, user, historique)

            blueprint = generer_blueprint_course_v2(n_semaines, cal)
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

            kf_init = cal["km_factor"]
            af_init = cal["amrap_factor"]
            rf_init = cal["reps_factor"]
            m1_cal_init = calibrer_module(MODULE1, kf_init, af_init, rf_init)

            # VMA pour enrichissement des allures cibles
            vma_init = _vma_depuis_historique_ou_bio(db, user, historique)

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

            # Adaptation au profil (spécificité distance, sortie longue, variantes, terrain)
            content = appliquer_profil_au_contenu(content, profil, cal, progress_map)

            # Enrichissement allures réelles
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
                "message": f"Programme orienté course généré : {n_semaines} semaines ({n_surcharge} de build + 2 de taper + semaine course).",
                "semaines_totales": n_semaines,
                "course": obj.nom,
            }

        # ── CAS 2 : pas de course → programme standard 3 × 8 semaines ───────
        # Recalibration si historique dispo
        historique_std = _parser_historique_perf(user.historique_perf, user.id)
        profil_std, cal_std = _calibration_utilisateur(db, user, historique_std)
        kf_std = cal_std["km_factor"]
        af_std = cal_std["amrap_factor"]
        rf_std = cal_std["reps_factor"]

        # VMA pour allures
        vma_std = _vma_depuis_historique_ou_bio(db, user, historique_std)

        n_muscu = user.seances_muscu_semaine or 2
        seances_total = user.seances_semaine or 5
        n_course = user.seances_course_semaine if user.seances_course_semaine is not None else max(1, seances_total - n_muscu)
        n_course = min(n_course, max(1, seances_total - n_muscu))
        muscu_adapter = adapter_contenu_gym if user.type_muscu == "salle" else adapter_contenu_muscu
        _generer_macrocycles_standard(
            db, user, debut_mc1, 3, kf_std, af_std, rf_std, profil_std, cal_std, vma_std,
            muscu_adapter, n_muscu, n_course,
        )

        db.commit()
        return {
            "message": "Programme performance générale généré : 3 modules × 8 semaines.",
            "semaines_totales": 24,
        }

    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("Erreur génération programme")
        raise HTTPException(500, detail="Erreur lors de la génération du programme")

# ---------------------------------------------------------------------------
# Intelligence sportive — analyse objectif + recalibration
# ---------------------------------------------------------------------------

@router.get("/api/programme/analyse-objectif", summary="Analyse VMA cible vs actuelle pour l'objectif en cours")
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
        # Même formule que analytics_service.prediction_course :
        # distance effective = dist + D+/100, fraction via interpolation continue
        temps_predit_min = None
        if vma_actuelle and dist > 0:
            dist_eff = dist + (obj.dplus_m or 0) / 100.0
            fraction = _fraction_vma_soutenable(dist_eff)
            temps_predit_min = round(dist_eff / (vma_actuelle * fraction) * 60)

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


@router.get("/api/programme/alerte-fatigue", summary="Détecte une fatigue excessive sur les 3 dernières séances")
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


@router.post("/api/programme/blessure", summary="Signale une blessure et adapte le programme")
def signaler_blessure(
    payload: BlessureSchema,
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(obtenir_session),
):
    today = date.today()
    fin = today + timedelta(days=max(0, payload.duree_jours - 1))  # période inclusive
    desc = f"Repos forcé suite à une blessure ({payload.description or 'non précisée'}). Reprends progressivement après guérison."

    # Semaines de l'utilisateur (pour rattacher un marqueur blessure à chaque jour)
    semaines = (
        db.query(SemaineEntrainement)
        .join(Macrocycle, SemaineEntrainement.macrocycle_id == Macrocycle.id)
        .filter(Macrocycle.utilisateur_id == current_user.id)
        .all()
    )
    def semaine_du_jour(d):
        for w in semaines:
            if w.date_debut <= d < w.date_debut + timedelta(days=7):
                return w
        return None

    nb_jours = 0
    jour = today
    while jour <= fin:
        w = semaine_du_jour(jour)
        if w:
            # Séances de ce jour non validées → supprimées ; validées conservées.
            blessure_deja = False
            for s in list(w.seances):
                jour_s = s.date_planifiee or s.date_seance
                if jour_s != jour:
                    continue
                if s.type_seance == TypeSeance.BLESSURE:
                    blessure_deja = True
                    continue
                if s.journal and s.journal.completee:
                    continue
                for ex in list(s.exercices):
                    db.delete(ex)
                db.delete(s)
            if not blessure_deja:
                db.add(SeanceEntrainement(
                    semaine_id=w.id,
                    date_seance=jour,
                    date_planifiee=jour,
                    type_seance=TypeSeance.BLESSURE,
                    titre="Blessure — repos",
                    description=desc,
                    ordre_dans_semaine=99,
                ))
                nb_jours += 1
        jour += timedelta(days=1)
    db.commit()
    return {"ok": True, "nb_jours_blessure": nb_jours, "fin_blessure": str(fin)}


@router.post("/api/programme/adapter-charge", summary="Régule la charge de la semaine courante selon ACWA / RPE / assiduité")
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


@router.post("/api/programme/corriger-durees-course", summary="Recalcule les durées des séances Z3-Z5 surestimées par calibration")
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


@router.post("/api/programme/corriger-emom", summary="Corrige les EMOM compléments mal affectés (bug logique inversée)")
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


@router.post("/api/programme/recalibrer", summary="Recalibre les séances restantes après un test d'évaluation")
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
    ).order_by(BiometrieUtilisateur.enregistre_le.desc()).first()
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
