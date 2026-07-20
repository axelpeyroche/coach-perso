"""
Moteur d'intelligence de génération de programme.

Centralise tout ce qui rend le programme spécifique au profil de l'utilisateur :

1. Profil consolidé          — âge, sexe, VMA, force, objectif, terrain
2. Calibration v2            — facteurs séparés pull/push/jambes, modulation âge,
                               vitesse de progression individualisée
3. Blueprint course v2       — mésocycles 3:1 (semaines d'assimilation),
                               rampe de volume adaptée au niveau et à l'âge
4. Adaptation du contenu     — substitution de variantes selon la force réelle,
                               spécificité d'allure selon la distance cible,
                               sortie longue progressive vers le pic spécifique,
                               ajustement terrain route/trail
5. Adaptation continue       — régulation hebdomadaire de la charge selon
                               ACWA, RPE moyen et taux de complétion
"""

from __future__ import annotations

from datetime import date, timedelta

from models import TypeSeance, ZoneCourse


# ---------------------------------------------------------------------------
# 1. Profil consolidé
# ---------------------------------------------------------------------------

def construire_profil(user, db, historique: dict | None = None) -> dict:
    """Rassemble tout ce que l'on sait de l'utilisateur en un seul dict.

    `historique` : contenu de user.historique_perf déjà parsé (facultatif —
    re-parsé depuis l'utilisateur sinon).
    """
    import json

    if historique is None:
        historique = {}
        if getattr(user, "historique_perf", None):
            try:
                historique = json.loads(user.historique_perf)
            except Exception:
                historique = {}

    # Âge
    age = None
    if getattr(user, "date_naissance", None):
        today = date.today()
        dn = user.date_naissance
        age = today.year - dn.year - ((today.month, today.day) < (dn.month, dn.day))

    # VMA la plus fiable : biométrie récente sinon estimation questionnaire
    vma = None
    try:
        from models import BiometrieUtilisateur
        bio = (
            db.query(BiometrieUtilisateur)
            .filter(BiometrieUtilisateur.utilisateur_id == user.id)
            .order_by(BiometrieUtilisateur.enregistre_le.desc())
            .first()
        )
        if bio and bio.vma_kmh and bio.vma_kmh >= 5.0:
            vma = float(bio.vma_kmh)
    except Exception:
        pass
    if vma is None and historique.get("vma_estimee"):
        try:
            v = float(historique["vma_estimee"])
            if 5.0 <= v <= 30.0:
                vma = v
        except (TypeError, ValueError):
            pass

    # FC max : mesurée sinon formule de Tanaka (208 − 0.7 × âge)
    fc_max = getattr(user, "fc_max", None)
    if not fc_max and age:
        fc_max = round(208 - 0.7 * age)

    # Objectif course actif
    objectif = None
    try:
        from models import ObjectifCourse
        obj = (
            db.query(ObjectifCourse)
            .filter(ObjectifCourse.utilisateur_id == user.id)
            .order_by(ObjectifCourse.id.desc())
            .first()
        )
        if obj:
            objectif = {
                "nom": obj.nom,
                "distance_km": float(obj.distance_km or 0),
                "temps_min": int(obj.objectif_temps_min or 0),
                "date_course": obj.date_course,
            }
    except Exception:
        pass

    def _num(key):
        try:
            v = historique.get(key)
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    return {
        "age": age,
        "sexe": getattr(user, "sexe", None),
        "vma": vma,
        "fc_max": fc_max,
        "niveau": historique.get("niveau", "intermediaire"),
        "volume_km_semaine": _num("volume_km_semaine"),
        "max_pompes": _num("max_pompes"),
        "max_tractions": _num("max_tractions"),
        "objectif": objectif,
        "type_course": getattr(user, "type_course", None),  # "route" | "trail"
    }


# ---------------------------------------------------------------------------
# 2. Calibration v2
# ---------------------------------------------------------------------------

def _facteur_recuperation(age: int | None) -> float:
    """Capacité de récupération relative selon l'âge (module la progression)."""
    if age is None:
        return 1.0
    if age < 30:
        return 1.0
    if age < 40:
        return 0.95
    if age < 50:
        return 0.90
    if age < 60:
        return 0.85
    return 0.78


def calibration_v2(historique: dict, profil: dict | None = None) -> dict:
    """Calibration enrichie. Rétro-compatible : km_factor / amrap_factor /
    reps_factor restent présents ; ajoute les facteurs par catégorie et la
    dynamique de progression individualisée.
    """
    profil = profil or {}
    niveau = historique.get("niveau", profil.get("niveau", "intermediaire"))
    niveau_map = {"debutant": 0.75, "intermediaire": 1.0, "confirme": 1.25}
    base_factor = niveau_map.get(niveau, 1.0)

    # --- km_factor : volume actuel réel prioritaire ---
    volume = historique.get("volume_km_semaine", profil.get("volume_km_semaine"))
    try:
        vol = float(volume) if volume is not None else None
    except (TypeError, ValueError):
        vol = None
    if vol is not None:
        km_base = min(max(vol * 0.8, 8.0), 50.0)
        km_factor = km_base / 15.0
    else:
        km_factor = base_factor

    # Modulation âge : le volume de départ reste, mais on tempère l'ambition
    age = profil.get("age")
    if age is not None:
        if age >= 60:
            km_factor *= 0.85
        elif age >= 50:
            km_factor *= 0.92

    # --- Facteurs force séparés pull / push / jambes ---
    def _num(key):
        try:
            v = historique.get(key, profil.get(key))
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    pompes = _num("max_pompes")
    tractions = _num("max_tractions")

    # Référentiels : 20 pompes / 8 tractions = niveau 1.0
    push_factor = max(0.5, min(1.7, pompes / 20.0)) if pompes is not None else base_factor
    pull_factor = max(0.5, min(1.7, tractions / 8.0)) if tractions is not None else base_factor
    legs_factor = round((push_factor + pull_factor) / 2, 3)  # approximation raisonnable

    # --- amrap_factor : capacité de travail globale ---
    if pompes is not None and tractions is not None:
        score = (pompes / 20.0) + (tractions / 8.0)
        amrap_factor = max(0.55, min(1.6, 0.45 + score * 0.275))
    else:
        amrap_factor = base_factor

    reps_factor = round((push_factor + pull_factor + legs_factor) / 3, 3)

    # --- Dynamique de progression ---
    recovery = _facteur_recuperation(age)
    # Taux de croissance hebdomadaire du volume (« règle des 10 % » prudente)
    taux_progression = {
        "debutant": 0.05, "intermediaire": 0.065, "confirme": 0.08,
    }.get(niveau, 0.065) * recovery
    # Exposant de la rampe de volume : plus haut = montée plus douce au début
    exp_progression = {"debutant": 0.90, "intermediaire": 0.75, "confirme": 0.65}.get(niveau, 0.75)
    # Plafond du facteur pic vs niveau actuel
    plafond_pic = {"debutant": 1.6, "intermediaire": 2.0, "confirme": 2.4}.get(niveau, 2.0)

    return {
        "km_factor": round(km_factor, 3),
        "amrap_factor": round(amrap_factor, 3),
        "reps_factor": reps_factor,
        "pull_factor": round(pull_factor, 3),
        "push_factor": round(push_factor, 3),
        "legs_factor": legs_factor,
        "recovery_factor": round(recovery, 3),
        "taux_progression": round(taux_progression, 4),
        "exp_progression": exp_progression,
        "plafond_pic": plafond_pic,
    }


# ---------------------------------------------------------------------------
# 3. Blueprint course v2 — mésocycles 3:1
# ---------------------------------------------------------------------------

def semaines_assimilation(n_surcharge: int) -> set[int]:
    """Numéros des semaines d'assimilation (récup relative) pendant le build.

    Structure 3:1 classique : toutes les 4 semaines, sauf si le build est court
    (< 6 semaines) et jamais sur la dernière semaine de build (pic conservé).
    """
    if n_surcharge < 6:
        return set()
    return {i for i in range(4, n_surcharge, 4)}


def generer_blueprint_course_v2(n_semaines: int, calib: dict):
    """Blueprint course avec progression individualisée et mésocycles 3:1.

    Même structure de sortie que generer_blueprint_course (liste de RegleSemaine)
    pour rester compatible avec l'insertion existante.
    """
    from periodization_rules import RegleSemaine
    from models import TypeMacrophase

    if n_semaines < 4:
        raise ValueError("Minimum 4 semaines pour un programme orienté course.")

    taux = calib.get("taux_progression", 0.06)
    n_surcharge = n_semaines - 3
    assim = semaines_assimilation(n_surcharge)

    semaines = []
    mult = 1.0
    for i in range(1, n_surcharge + 1):
        if i in assim:
            semaines.append(RegleSemaine(
                numero=i,
                macrophase=TypeMacrophase.SURCHARGE,
                multiplicateur_volume=round(mult * 0.75, 2),
                objectif_amrap_min=min(20 + i * 2, 35),
                objectif_km_course=round(min(15.0 + i * 1.5, 30.0) * 0.75, 1),
                description=f"Assimilation {i}/{n_surcharge} — volume -25 %, le corps absorbe le travail",
            ))
            # le multiplicateur de fond continue sa route (pas de régression durable)
        else:
            semaines.append(RegleSemaine(
                numero=i,
                macrophase=TypeMacrophase.SURCHARGE,
                multiplicateur_volume=round(min(mult, 1.45), 2),
                objectif_amrap_min=min(20 + i * 2, 35),
                objectif_km_course=min(15.0 + i * 1.5, 30.0),
                description=f"Surcharge progressive {i}/{n_surcharge}",
            ))
            mult = min(mult * (1 + taux), 1.45)

    semaines.append(RegleSemaine(
        numero=n_surcharge + 1,
        macrophase=TypeMacrophase.DECHARGE,
        multiplicateur_volume=0.70,
        objectif_amrap_min=15,
        objectif_km_course=10.0,
        description="Décharge — récupération active, volume -30 %",
    ))
    semaines.append(RegleSemaine(
        numero=n_surcharge + 2,
        macrophase=TypeMacrophase.DECHARGE,
        multiplicateur_volume=0.50,
        objectif_amrap_min=None,
        objectif_km_course=5.0,
        description="Affûtage — préservation neuromusculaire avant course",
    ))
    semaines.append(RegleSemaine(
        numero=n_semaines,
        macrophase=TypeMacrophase.EVALUATION,
        multiplicateur_volume=0.20,
        objectif_amrap_min=None,
        objectif_km_course=None,
        description="Semaine de course — activation légère + jour J",
    ))
    return semaines


# ---------------------------------------------------------------------------
# 4. Adaptation du contenu au profil
# ---------------------------------------------------------------------------

_SLUGS_PULL = {
    "traction-stricte", "traction-australienne", "traction-partielle",
    "curl-biceps-traction", "le-y", "rotateur-long",
}
_SLUGS_PUSH = {
    "pompe-standard", "pompe-large", "pompe-genoux", "pompe-diamant",
    "dip-parallettes", "dip-partiel", "triceps-extension-dips",
}
_SLUGS_JAMBES = {
    "squat-bw", "pistol-squat-gauche", "pistol-squat-droit",
    "extension-hanche", "chaise-isometrique",
}

# Durée pic de la sortie longue (min) selon la distance de course visée
def _pic_sortie_longue(distance_km: float) -> int:
    if distance_km <= 10:
        return 75
    if distance_km <= 15:
        return 90
    if distance_km <= 25:
        return 120
    if distance_km <= 45:
        return 150
    return 180


_SEANCE_SEUIL_CANONIQUE = {
    "titre": "Seuil Z4 — 45 min (3×10 min R=2 min)",
    "zone": ZoneCourse.Z4, "duree_min": 45,
    "description": (
        "Terrain : route plate ou piste.\n"
        "• Échauffement : 8 min Z1/Z2\n"
        "• 3 × 10 min Z4 (87-95% VMA) / 2 min récup Z1 trot\n"
        "• Retour : 5 min Z1\n"
        "Conversion automatique : ta course cible demande de l'endurance de seuil,\n"
        "pas de la vitesse pure — régularité d'allure prioritaire."
    ),
}

_SEANCE_Z5_CANONIQUE = {
    "titre": "Fractionné Z5 — 40 min (6×2 min R=2 min)",
    "zone": ZoneCourse.Z5, "duree_min": 40,
    "description": (
        "Terrain : piste ou route plate mesurée.\n"
        "• Échauffement : 10 min Z1/Z2\n"
        "• 6 × 2 min Z5 (100-105% VMA) / 2 min récup Z1 trot\n"
        "• Retour : 6 min Z1\n"
        "Conversion automatique : course courte → l'économie à haute vitesse\n"
        "devient prioritaire en fin de préparation."
    ),
}


def _substituer_variantes(seance: dict, profil: dict) -> dict:
    """Remplace les mouvements trop durs (ou trop faciles) selon la force réelle."""
    exs = seance.get("exercices")
    if not exs:
        return seance

    tractions = profil.get("max_tractions")
    pompes = profil.get("max_pompes")
    niveau = profil.get("niveau", "intermediaire")

    nouveaux = []
    for ex in exs:
        ex = dict(ex)
        slug = ex.get("slug") or ""
        reps = ex.get("reps")

        if slug == "traction-stricte" and tractions is not None and tractions < 4:
            ex["slug"] = "traction-australienne"
            if reps:
                ex["reps"] = max(4, round(reps * 1.5))
        elif slug == "pompe-standard" and pompes is not None and pompes < 8:
            ex["slug"] = "pompe-genoux"
        elif slug in ("pistol-squat-gauche", "pistol-squat-droit") and niveau == "debutant":
            ex["slug"] = "squat-bw"
            if reps:
                ex["reps"] = max(8, round(reps * 2))
        nouveaux.append(ex)

    # Dédoublonner deux pistols convertis en squat dans la même séance
    vus: dict[str, int] = {}
    dedup = []
    for ex in nouveaux:
        cle = ex.get("slug") or ex.get("nom") or ""
        if cle == "squat-bw" and cle in vus:
            dedup[vus[cle]]["reps"] = (dedup[vus[cle]].get("reps") or 0) + (ex.get("reps") or 0)
            continue
        vus[cle] = len(dedup)
        dedup.append(ex)

    seance = dict(seance)
    seance["exercices"] = dedup
    return seance


def _ajuster_reps_categorie(seance: dict, calib: dict) -> dict:
    """Raffine les reps par groupe : la calibration globale (reps_factor) a déjà
    été appliquée ; on corrige par le ratio catégorie/global pour refléter les
    forces et faiblesses réelles (ex. fort en pompes, faible en tractions)."""
    exs = seance.get("exercices")
    if not exs:
        return seance
    global_f = calib.get("reps_factor") or 1.0
    if global_f <= 0:
        return seance

    ratios = {
        "pull": (calib.get("pull_factor") or global_f) / global_f,
        "push": (calib.get("push_factor") or global_f) / global_f,
        "jambes": (calib.get("legs_factor") or global_f) / global_f,
    }

    nouveaux = []
    for ex in exs:
        ex = dict(ex)
        slug = ex.get("slug") or ""
        reps = ex.get("reps")
        if reps:
            if slug in _SLUGS_PULL:
                ex["reps"] = max(1, round(reps * ratios["pull"]))
            elif slug in _SLUGS_PUSH:
                ex["reps"] = max(1, round(reps * ratios["push"]))
            elif slug in _SLUGS_JAMBES:
                ex["reps"] = max(1, round(reps * ratios["jambes"]))
        nouveaux.append(ex)
    seance = dict(seance)
    seance["exercices"] = nouveaux
    return seance


def _convertir_seance_course(seance: dict, cible: dict) -> dict:
    """Applique une structure canonique (seuil ou Z5) à une séance course."""
    ns = dict(seance)
    ns["titre"] = cible["titre"]
    ns["zone"] = cible["zone"]
    ns["duree_min"] = cible["duree_min"]
    ns["description"] = cible["description"]
    return ns


def _ajuster_terrain(seance: dict, profil: dict) -> dict:
    """Route → D+ nul et mention terrain plat ; trail → D+ renforcé."""
    ns = dict(seance)
    type_course = profil.get("type_course")
    dplus = ns.get("dplus_m")
    if type_course == "route":
        if dplus:
            ns["dplus_m"] = 0
            titre = ns.get("titre", "")
            import re
            titre = re.sub(r"\s*\(D\+\s*\d+\s*m\)", "", titre)
            ns["titre"] = titre.replace("Sortie longue trail", "Sortie longue route")
    elif type_course == "trail" and dplus:
        ns["dplus_m"] = round(dplus * 1.3 / 10) * 10
        titre = ns.get("titre", "")
        if f"D+ {dplus} m" in titre:
            ns["titre"] = titre.replace(f"D+ {dplus} m", f"D+ {ns['dplus_m']} m", 1)
    return ns


def appliquer_profil_au_contenu(
    content: dict,
    profil: dict,
    calib: dict,
    progress_map: dict | None = None,
) -> dict:
    """Passe d'adaptation principale : applique toutes les règles liées au profil.

    `progress_map` : {numero_semaine: progress 0..1 dans le build} — présent
    uniquement pour un programme orienté course ; active la spécificité
    d'allure et la montée de la sortie longue.
    """
    objectif = profil.get("objectif")
    dist = objectif["distance_km"] if objectif else None
    age = profil.get("age")

    result = {}
    for sem, seances in content.items():
        progress = (progress_map or {}).get(sem)
        nouvelles = []
        for s in seances:
            ns = dict(s)
            t = ns.get("type")

            if t == TypeSeance.COURSE:
                zone = ns.get("zone")

                # -- Spécificité d'allure selon la distance cible / l'âge --
                if zone == ZoneCourse.Z5 and (
                    (dist and dist >= 25 and progress is not None)
                    or (age is not None and age >= 58)
                ):
                    # Course longue ou athlète senior : la VO2max pure rapporte
                    # moins que le seuil — conversion.
                    ns = _convertir_seance_course(ns, _SEANCE_SEUIL_CANONIQUE)
                elif (
                    zone in (ZoneCourse.Z3, ZoneCourse.Z4)
                    and dist and dist <= 10
                    and progress is not None and progress >= 0.66
                ):
                    # Course courte, dernier tiers du build : place à la vitesse.
                    ns = _convertir_seance_course(ns, _SEANCE_Z5_CANONIQUE)

                # -- Sortie longue : progression vers le pic spécifique --
                titre = ns.get("titre", "")
                if dist and progress is not None and "Sortie longue" in titre:
                    pic = _pic_sortie_longue(dist)
                    duree_actuelle = ns.get("duree_min")
                    if duree_actuelle:
                        cible = round(pic * (0.55 + 0.45 * progress ** 0.8) / 5) * 5
                        nouvelle = max(duree_actuelle, min(cible, pic))
                        if nouvelle != duree_actuelle:
                            from seed_seances import _remplacer_duree_titre
                            ns["duree_min"] = nouvelle
                            ns["titre"] = _remplacer_duree_titre(titre, duree_actuelle, nouvelle)

                # -- Terrain --
                ns = _ajuster_terrain(ns, profil)

            elif t in (TypeSeance.EMOM, TypeSeance.AMRAP):
                ns = _substituer_variantes(ns, profil)
                ns = _ajuster_reps_categorie(ns, calib)

            nouvelles.append(ns)
        result[sem] = nouvelles
    return result


# ---------------------------------------------------------------------------
# 5. Adaptation continue — régulation hebdomadaire de la charge
# ---------------------------------------------------------------------------

MARQUEUR_ALLEGE = "⚙ Allégé — "
MARQUEUR_RENFORCE = "⚙ Renforcé — "


def adapter_charge_semaine(db, user) -> dict:
    """Analyse la charge récente et ajuste les séances à venir de la semaine
    courante. Idempotent (marqueur dans le titre). Sans effet si données
    insuffisantes (< 4 séances sur 28 jours).

    Règles :
      ACWA > 1.5  ou RPE moyen 7 j ≥ 8.5  → alléger  (-20 % durées / temps)
      ACWA < 0.8  et RPE moyen 7 j ≤ 6    → renforcer (+10 %), si assiduité OK
    """
    from models import (
        JournalSeance, SeanceEntrainement, SemaineEntrainement, Macrocycle,
    )
    from datetime import datetime

    maintenant = datetime.now()
    il_y_a_7j = maintenant - timedelta(days=7)
    il_y_a_28j = maintenant - timedelta(days=28)

    journaux = (
        db.query(JournalSeance)
        .filter(
            JournalSeance.utilisateur_id == user.id,
            JournalSeance.completee == True,  # noqa: E712
            JournalSeance.enregistre_le >= il_y_a_28j,
        )
        .all()
    )
    if len(journaux) < 4:
        return {"ok": True, "action": "aucune", "raison": "données insuffisantes"}

    def _charge(j) -> float:
        duree = j.duree_reelle_min or 45
        rpe = j.rpe or 5
        return duree * rpe

    charge_7j = sum(_charge(j) for j in journaux if j.enregistre_le >= il_y_a_7j)
    charge_28j = sum(_charge(j) for j in journaux)
    chronique = charge_28j / 4 if charge_28j else 0
    acwa = round(charge_7j / chronique, 2) if chronique > 0 else None

    rpes_7j = [j.rpe for j in journaux if j.enregistre_le >= il_y_a_7j and j.rpe]
    rpe_moyen = round(sum(rpes_7j) / len(rpes_7j), 1) if rpes_7j else None

    action = "aucune"
    facteur = 1.0
    marqueur = ""
    if acwa is not None and (acwa > 1.5 or (rpe_moyen is not None and rpe_moyen >= 8.5)):
        action, facteur, marqueur = "allegement", 0.8, MARQUEUR_ALLEGE
    elif (
        acwa is not None and acwa < 0.8
        and rpe_moyen is not None and rpe_moyen <= 6
        and len(rpes_7j) >= 3
    ):
        action, facteur, marqueur = "renforcement", 1.1, MARQUEUR_RENFORCE

    if action == "aucune":
        return {"ok": True, "action": action, "acwa": acwa, "rpe_moyen": rpe_moyen}

    # Séances futures non validées de la semaine courante
    today = date.today()
    lundi = today - timedelta(days=today.weekday())
    seances = (
        db.query(SeanceEntrainement)
        .join(SemaineEntrainement)
        .join(Macrocycle)
        .outerjoin(JournalSeance, JournalSeance.seance_id == SeanceEntrainement.id)
        .filter(
            Macrocycle.utilisateur_id == user.id,
            SemaineEntrainement.date_debut == lundi,
            JournalSeance.id.is_(None),
        )
        .all()
    )

    nb_ajustees = 0
    for s in seances:
        titre = s.titre or ""
        if titre.startswith("⚙"):
            continue  # déjà ajustée cette semaine
        if s.type_seance == TypeSeance.COURSE:
            # On ne touche qu'à l'endurance : l'intensité se gère par le RPE en séance
            if s.zone_cible in (ZoneCourse.Z1, ZoneCourse.Z2) and s.duree_cible_min:
                s.duree_cible_min = max(20, round(s.duree_cible_min * facteur / 5) * 5)
                s.titre = marqueur + titre
                nb_ajustees += 1
        elif s.type_seance in (TypeSeance.EMOM, TypeSeance.AMRAP) and s.temps_limite_min:
            s.temps_limite_min = max(10, round(s.temps_limite_min * facteur / 2) * 2)
            s.titre = marqueur + titre
            nb_ajustees += 1

    db.commit()
    return {
        "ok": True,
        "action": action,
        "acwa": acwa,
        "rpe_moyen": rpe_moyen,
        "seances_ajustees": nb_ajustees,
    }
