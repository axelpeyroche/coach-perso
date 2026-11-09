"""
Zones d'entraînement recalculées automatiquement à partir du carnet.

- FC max : plus haute FC de séance des 12 derniers mois (pic isolé écarté).
- FC repos : moyenne des 7 dernières mesures des 30 derniers jours.
- FC au seuil (LTHR) : FC tenable environ 1 h, déduite des efforts soutenus en course et trail.
  Chaque séance donne une estimation : FC moyenne de ses meilleures portions de 20 et 60 min
  (flux de FC) ou, à défaut, FC moyenne de la séance, ramenée au seuil selon la durée tenue
  (un effort maximal de 20 min se court ~3 % au-dessus du seuil, un semi ~5 % en dessous).
  On garde la meilleure estimation des 12 derniers mois, un peu dépréciée avec l'âge
  (0,3 bpm par mois) : la FC au seuil bouge peu, c'est l'allure au seuil qui progresse.
- Zones cardiaques : méthode Friel (85 / 90 / 95 / 100 % de la FC au seuil) ; à défaut de seuil,
  Karvonen (60 / 70 / 80 / 90 % de la FC de réserve).
- Zones d'allure : pourcentages de la vitesse critique (meilleurs efforts des 90 derniers jours).
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from sqlalchemy.orm import Session

import carnet_service as cs
from models import Activite, MesureSante, Utilisateur

FENETRE_SEUIL_J = 365
DECROISSANCE_BPM_MOIS = 0.3
SEUIL_PIC_ISOLE = 5          # bpm : estimation dépassant la suivante de plus de 5 bpm = artefact
SEUIL_MIN_FRAC_FCMAX = 0.86  # en dessous, l'effort n'était pas assez soutenu pour situer le seuil
SEUIL_BORNES_FCMAX = (0.80, 0.95)
FRIEL = (0.85, 0.90, 0.95, 1.00)
KARVONEN = (0.60, 0.70, 0.80, 0.90)
ALLURE_PCT_VC = (0.72, 0.80, 0.90, 0.98)   # bornes des zones d'allure en % de la vitesse critique
FENETRE_VC_J = 90
NOMS = ["Récupération", "Endurance fondamentale", "Tempo", "Seuil", "VMA"]
USAGES = ["footing de récupération, échauffement", "sorties faciles et sorties longues",
          "allure marathon et semi", "blocs au seuil", "fractionnés, courses courtes"]


def _ratio_seuil(minutes: float, competition: bool) -> Optional[float]:
    """FC moyenne d'un effort maximal de cette durée / FC au seuil."""
    if minutes < 20:
        return None
    if minutes <= 60:
        return 1.03 - 0.03 * (minutes - 20) / 40
    if minutes <= 75:
        return 1.0 - 0.015 * (minutes - 60) / 15
    if competition and minutes <= 150:
        return 0.985 - 0.045 * (minutes - 75) / 75
    return None


def candidats_seuil(acts: list[Activite]) -> list[tuple[date, float, Activite]]:
    """Une estimation de FC au seuil par séance de course ou de trail (borne basse si l'effort n'était pas maximal)."""
    out = []
    for a in acts:
        if a.sport not in cs.SPORTS_PIED:
            continue
        det = cs._details_dict(a)
        ests = []
        fs = det.get("fc_soutenue") or {}
        if isinstance(fs, dict):
            if fs.get("20"):
                ests.append(float(fs["20"]) / 1.03)
            if fs.get("60"):
                ests.append(float(fs["60"]))
        duree = cs.duree_mouvement(a)
        if a.fc_moyenne_bpm and duree:
            r = _ratio_seuil(duree / 60, bool(a.est_competition))
            if r:
                ests.append(a.fc_moyenne_bpm / r)
        ests = [e for e in ests if 100 <= e <= 215]
        if ests:
            out.append((a.debut.date(), max(ests), a))
    return out


def fc_max_au(vals: list[tuple[date, int]], j: date) -> Optional[int]:
    recents = sorted((v for d, v in vals if j - timedelta(days=365) < d <= j
                      and cs.FC_MAX_PLAUSIBLE[0] <= v <= cs.FC_MAX_PLAUSIBLE[1]), reverse=True)
    xs = recents if len(recents) >= 10 else []
    if not xs and vals:
        # Sans mesure avant cette date : celle de la première année mesurée (la FC max bouge très lentement)
        premiere = min(d for d, _ in vals) + timedelta(days=364)
        if premiere > j:
            return fc_max_au(vals, premiere)
        xs = recents
    while len(xs) >= 2 and xs[0] - xs[1] > cs.FC_MAX_ECART_ISOLE:
        xs.pop(0)
    return xs[0] if xs else None


def fc_repos_au(mesures: dict[date, float], j: date) -> Optional[int]:
    jours = sorted((d for d in mesures if d <= j), reverse=True)[:cs.FC_REPOS_NB_JOURS]
    if not jours:
        return None
    recents = [mesures[d] for d in jours if d >= j - timedelta(days=cs.FC_REPOS_FENETRE_JOURS)]
    ech = recents or [mesures[jours[0]]]
    return round(sum(ech) / len(ech))


def fc_seuil_au(cands: list[tuple[date, float, Activite]], j: date, fc_max: Optional[int]) -> Optional[dict]:
    """Meilleure estimation des 12 derniers mois (dépréciée avec l'âge), pic isolé écarté."""
    xs = []
    for d, v, a in cands:
        if j - timedelta(days=FENETRE_SEUIL_J) < d <= j:
            age_mois = (j - d).days / 30.44
            ajuste = v - DECROISSANCE_BPM_MOIS * age_mois
            if not fc_max or ajuste >= SEUIL_MIN_FRAC_FCMAX * fc_max:
                xs.append((ajuste, d, a))
    xs.sort(key=lambda x: -x[0])
    # Une estimation très au-dessus des autres doit être confirmée par un autre effort proche
    # (à 5 bpm près, sur 2 ans) ; sinon c'est sans doute un artefact du capteur
    bruts = [(d, v) for d, v, _ in cands if j - timedelta(days=2 * FENETRE_SEUIL_J) < d <= j]
    def confirme(x):
        brut = next(v for d, v, a in cands if a is x[2])
        return any(abs(v - brut) <= SEUIL_PIC_ISOLE for d, v in bruts if d != x[1] or v != brut)
    while len(xs) >= 2 and xs[0][0] - xs[1][0] > SEUIL_PIC_ISOLE and not confirme(xs[0]):
        xs.pop(0)
    if not xs:
        return None
    v, d, a = xs[0]
    if fc_max:
        v = min(max(v, SEUIL_BORNES_FCMAX[0] * fc_max), SEUIL_BORNES_FCMAX[1] * fc_max)
    return {"valeur": round(v), "date": d.isoformat(), "activite_id": a.id, "titre": a.titre,
            "nb_efforts": len(xs)}


def bornes_fc(fc_seuil: Optional[int], fc_max: Optional[int], fc_repos: Optional[int]) -> tuple[Optional[list[int]], Optional[str]]:
    """4 bornes (début des zones 2 à 5) et la méthode employée."""
    if fc_seuil:
        return [round(p * fc_seuil) for p in FRIEL], "seuil"
    if fc_max and fc_repos and fc_max > fc_repos:
        return [round(fc_repos + p * (fc_max - fc_repos)) for p in KARVONEN], "reserve"
    return None, None


def _meilleurs_efforts(acts: list[Activite]) -> list[tuple[date, int, float]]:
    pts = []
    for a in acts:
        if a.sport not in cs.SPORTS_PIED:
            continue
        d = (cs._details_dict(a).get("efforts") or {}).get("d") or {}
        for m, metres in d.items():
            if str(m).isdigit() and metres:
                pts.append((a.debut.date(), int(m), float(metres)))
    return pts


def vitesse_critique_au(pts: list[tuple[date, int, float]], j: date) -> Optional[float]:
    import analyses_service as an
    meilleurs: dict[int, float] = {}
    for d, m, metres in pts:
        if j - timedelta(days=FENETRE_VC_J) < d <= j and metres > meilleurs.get(m, 0):
            meilleurs[m] = metres
    vc = an.vitesse_critique(meilleurs)
    return vc["vitesse_ms"] if vc else None


def _allure(vitesse_ms: float) -> int:
    return round(1000 / vitesse_ms)


def zones(bornes: Optional[list[int]], vc_ms: Optional[float], vma_kmh: Optional[float] = None) -> list[dict]:
    """Les 5 zones : bornes de FC (bpm) et d'allure (s/km, « min » = la plus lente)."""
    if not bornes:
        return []
    lim = [None] + bornes + [None]
    out = []
    for i in range(5):
        z = {"zone": i + 1, "nom": NOMS[i], "usage": USAGES[i],
             "fc_min": lim[i], "fc_max": (lim[i + 1] - 1) if lim[i + 1] else None}
        if vc_ms:
            p = [None] + list(ALLURE_PCT_VC) + [None]
            z["allure_lente"] = _allure(vc_ms * p[i]) if p[i] else None
            z["allure_rapide"] = _allure(vc_ms * p[i + 1]) if p[i + 1] else None
        out.append(z)
    if vma_kmh and out and vc_ms:
        out[4]["allure_vma"] = round(3600 / vma_kmh)
    return out


def _donnees(db: Session, user: Utilisateur) -> tuple[list[Activite], dict[date, float]]:
    acts = (db.query(Activite).filter(Activite.utilisateur_id == user.id).order_by(Activite.debut).all())
    return acts, fc_repos_toutes(db, user.id)


def physiologie(acts: list[Activite], fcr: dict[date, float], j: date) -> dict:
    vals = [(a.debut.date(), a.fc_max_bpm) for a in acts if a.fc_max_bpm]
    fmax = fc_max_au(vals, j)
    seuil = fc_seuil_au(candidats_seuil(acts), j, fmax)
    return {"fc_max": fmax, "fc_repos": fc_repos_au(fcr, j), "fc_seuil": seuil and seuil["valeur"], "seuil": seuil}


def zones_profil(user: Utilisateur, vc_ms: Optional[float], vma_kmh: Optional[float] = None,
                 reference: Optional[dict] = None) -> dict:
    """Zones du jour à partir des valeurs du profil (tenues à jour par synchroniser_physiologie)."""
    b, methode = bornes_fc(user.fc_seuil, user.fc_max, user.fc_repos)
    return {
        "fc_max": user.fc_max, "fc_repos": user.fc_repos, "fc_seuil": user.fc_seuil,
        "methode": methode, "reference": reference,
        "vitesse_critique_ms": vc_ms, "allure_critique_sec_km": _allure(vc_ms) if vc_ms else None,
        "vma_kmh": vma_kmh, "zones": zones(b, vc_ms, vma_kmh),
    }


def zones_actuelles(db: Session, user: Utilisateur, vma_kmh: Optional[float] = None) -> dict:
    """Zones du jour (pour le Résumé et l'export du plan hebdo)."""
    acts, _ = _donnees(db, user)
    auj = date.today()
    seuil = fc_seuil_au(candidats_seuil(acts), auj, user.fc_max)
    return zones_profil(user, vitesse_critique_au(_meilleurs_efforts(acts), auj), vma_kmh, seuil)


def fc_repos_toutes(db: Session, user_id: int) -> dict[date, float]:
    return {j: v for j, v in db.query(MesureSante.jour, MesureSante.valeur).filter(
        MesureSante.utilisateur_id == user_id, MesureSante.type == "fc_repos")}


def historique(acts: list[Activite], fcr: dict[date, float], auj: date, semaines: int = 104) -> dict:
    """Une valeur par semaine (fin de semaine) : FC max, FC repos, FC au seuil, bornes et vitesse critique."""
    vals = [(a.debut.date(), a.fc_max_bpm) for a in acts if a.fc_max_bpm]
    cands = candidats_seuil(acts)
    efforts = _meilleurs_efforts(acts)
    premiere = min([a.debut.date() for a in acts if a.sport in cs.SPORTS_PIED], default=None)
    points = []
    if premiere:
        lundi = max(cs._lundi(premiere), cs._lundi(auj) - timedelta(weeks=semaines - 1))
        while lundi <= auj:
            fin = min(lundi + timedelta(days=6), auj)
            fmax, frep = fc_max_au(vals, fin), fc_repos_au(fcr, fin)
            s = fc_seuil_au(cands, fin, fmax)
            b, methode = bornes_fc(s and s["valeur"], fmax, frep)
            vc = vitesse_critique_au(efforts, fin)
            points.append({
                "semaine": lundi.isoformat(), "fc_max": fmax, "fc_repos": frep, "fc_seuil": s and s["valeur"],
                "methode": methode, "bornes": b,
                "allures": [_allure(vc * p) for p in ALLURE_PCT_VC] if vc else None,
                "allure_critique": _allure(vc) if vc else None,
            })
            lundi += timedelta(weeks=1)
    # Changements de FC au seuil (≥ 2 bpm) : « 176 → 178 depuis le 3 décembre »
    changements, prec = [], None
    for p in points:
        v = p["fc_seuil"]
        if v is not None and (prec is None or abs(v - prec) >= 2):
            if prec is not None:
                changements.append({"semaine": p["semaine"], "avant": prec, "apres": v})
            prec = v
    return {"points": points, "changements": changements[-6:]}
