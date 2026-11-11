"""
Socle de fiabilité : anomalies dans les données, séances ou jours écartés des calculs (sans rien supprimer),
couverture de l'historique par année, journal des recalculs, état des synchros (page « Santé du carnet »).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from statistics import median
from typing import Iterable, Optional

from sqlalchemy.orm import Session

import carnet_service as cs
from models import Activite, Exclusion, JournalCalcul, MesureSante, PoidsUtilisateur, TraceGPS, Utilisateur

# ---------------------------------------------------------------------------
# Anomalies (fonctions pures, verrouillées par tests/test_qualite.py)
# ---------------------------------------------------------------------------

FC_MAX_ABSOLUE = 230          # bpm : au-delà, c'est le capteur
FC_MARGE_PROFIL = 12          # bpm au-dessus de la FC max du profil avant de signaler un pic
FC_MOYENNE_MIN = 45           # bpm : en dessous pendant un effort, la ceinture a décroché
ALLURE_MIN_PLAUSIBLE = 150    # s/km (24 km/h) : plus rapide à pied = GPS qui a sauté
ALLURE_PAUSE_COURSE = 900     # s/km (15 min/km) sur une course à plat : le chrono a tourné à l'arrêt
VITESSE_VELO_MAX = 70         # km/h de moyenne
DUREE_MAX_H = 18
NUIT_TRONQUEE_H = 3.0
ECART_FC_REPOS = 20           # bpm d'écart avec la médiane personnelle
RAPPORT_VFC = 2.5             # fois la médiane (au-dessus ou en dessous)
MESURES_MIN = 10              # valeurs nécessaires pour juger une mesure par rapport à l'habitude
DOUBLON_DEBUT_S = 600         # deux séances du même sport démarrées à moins de 10 min d'écart
SPORTS_ENDURANCE = cs.SPORTS_PIED | {"velo", "randonnee"}

# Une nuit écartée emporte toutes les mesures de cette nuit
GROUPES_MESURES = {
    "nuit": ("sommeil", "sommeil_profond", "sommeil_leger", "sommeil_paradoxal", "sommeil_eveil", "fc_sommeil",
             "score_sommeil", "spo2", "respiration", "temps_au_lit", "coucher", "lever"),
    "vfc": ("vfc", "vfc_rmssd"),
}
LIBELLES_MESURES = {"nuit": "Nuit", "vfc": "VFC", "fc_repos": "FC au repos", "pas": "Pas", "vo2max": "VO2max"}


def anomalies_activite(sport: str, duree_sec: Optional[int], distance_km: Optional[float],
                       fc_moyenne: Optional[int], fc_max: Optional[int],
                       fc_max_profil: Optional[int] = None) -> list[dict]:
    """Ce qui cloche dans une séance, d'après ses seuls chiffres. Chaque anomalie : code + phrase."""
    out = []
    if fc_max and (fc_max > FC_MAX_ABSOLUE or (fc_max_profil and fc_max > fc_max_profil + FC_MARGE_PROFIL)):
        ref = f", pour une FC max de {fc_max_profil} au profil" if fc_max_profil else ""
        out.append({"code": "fc_pic", "texte": f"Pic de FC à {fc_max} bpm{ref} : sans doute le capteur."})
    if fc_moyenne and fc_max and fc_moyenne > fc_max:
        out.append({"code": "fc_incoherente", "texte": f"FC moyenne ({fc_moyenne}) au-dessus de la FC max ({fc_max})."})
    if fc_moyenne and fc_moyenne < FC_MOYENNE_MIN and (duree_sec or 0) >= 600:
        out.append({"code": "fc_basse", "texte": f"FC moyenne de {fc_moyenne} bpm pendant l'effort : capteur décroché ?"})
    if duree_sec and distance_km and distance_km >= 0.4:
        allure = duree_sec / distance_km
        if sport in cs.SPORTS_PIED and allure < ALLURE_MIN_PLAUSIBLE:
            out.append({"code": "gps", "texte": f"Allure moyenne de {_mmss(allure)}/km : le GPS a sans doute dérivé."})
        elif sport == "course" and allure > ALLURE_PAUSE_COURSE:
            out.append({"code": "pause", "texte": f"Allure moyenne de {_mmss(allure)}/km : le chrono a peut-être tourné à l'arrêt."})
        elif sport == "velo" and distance_km / (duree_sec / 3600) > VITESSE_VELO_MAX:
            out.append({"code": "gps", "texte": f"{round(distance_km / (duree_sec / 3600))} km/h de moyenne à vélo : distance douteuse."})
    if duree_sec and duree_sec > DUREE_MAX_H * 3600:
        out.append({"code": "duree", "texte": f"Durée de {round(duree_sec / 3600)} h : enregistrement oublié ?"})
    return out


def doublons(seances: Iterable[tuple[int, str, datetime, Optional[int]]]) -> dict[int, int]:
    """(id, sport, début, durée) → {id du doublon: id de l'original}. Même sport, départs à moins de
    10 min, durées à 15 % près : la séance au plus grand identifiant est le doublon."""
    out: dict[int, int] = {}
    tri = sorted(seances, key=lambda s: (s[1], s[2]))
    for i, (ida, sport, debut, duree) in enumerate(tri):
        for idb, sport_b, debut_b, duree_b in tri[i + 1:]:
            if sport_b != sport or (debut_b - debut).total_seconds() > DOUBLON_DEBUT_S:
                break
            if duree and duree_b and abs(duree - duree_b) <= 0.15 * max(duree, duree_b):
                out[max(ida, idb)] = min(ida, idb)
    return out


def anomalies_mesures(series: dict[str, dict[date, float]]) -> list[dict]:
    """Valeurs journalières hors du plausible : nuit tronquée, FC au repos ou VFC loin de l'habitude."""
    out = []
    for j, v in (series.get("sommeil") or {}).items():
        if v < NUIT_TRONQUEE_H:
            out.append({"type": "nuit", "jour": j, "code": "nuit_tronquee",
                        "texte": f"Nuit de {_hmin(v)} : enregistrement sans doute tronqué."})
    fcr = series.get("fc_repos") or {}
    if len(fcr) >= MESURES_MIN:
        med = median(fcr.values())
        for j, v in fcr.items():
            if abs(v - med) >= ECART_FC_REPOS:
                out.append({"type": "fc_repos", "jour": j, "code": "fc_repos_aberrante",
                            "texte": f"FC au repos de {round(v)} bpm, pour {round(med)} d'habitude."})
    for t in GROUPES_MESURES["vfc"]:
        vfc = series.get(t) or {}
        if len(vfc) >= MESURES_MIN:
            med = median(vfc.values())
            for j, v in vfc.items():
                if med and (v > med * RAPPORT_VFC or v < med / RAPPORT_VFC):
                    out.append({"type": "vfc", "jour": j, "code": "vfc_aberrante",
                                "texte": f"VFC de {round(v)} ms, pour {round(med)} d'habitude."})
    return sorted(out, key=lambda a: a["jour"], reverse=True)


def _mmss(sec: float) -> str:
    sec = round(sec)
    return f"{sec // 60}:{sec % 60:02d}"


def _hmin(h: float) -> str:
    m = round(h * 60)
    return f"{m // 60} h {m % 60:02d}"


# ---------------------------------------------------------------------------
# Séances et jours écartés des calculs
# ---------------------------------------------------------------------------

def exclusions(db: Session, user_id: int) -> tuple[set[int], set[tuple[str, date]]]:
    """(identifiants de séances écartées, couples (type de mesure, jour) écartés — groupes développés)."""
    acts: set[int] = set()
    mesures: set[tuple[str, date]] = set()
    for e in db.query(Exclusion).filter(Exclusion.utilisateur_id == user_id):
        if e.genre == "activite" and e.activite_id:
            acts.add(e.activite_id)
        elif e.genre == "mesure" and e.type_mesure and e.jour:
            for t in GROUPES_MESURES.get(e.type_mesure, (e.type_mesure,)):
                mesures.add((t, e.jour))
    return acts, mesures


def appliquer(acts: list[Activite], mesures: dict[str, dict[date, float]],
              ecartees: tuple[set[int], set[tuple[str, date]]]) -> list[Activite]:
    """Retire les séances écartées (renvoie la nouvelle liste) et les mesures écartées (sur place)."""
    ids, jours = ecartees
    for t, j in jours:
        if t in mesures:
            mesures[t].pop(j, None)
    return [a for a in acts if a.id not in ids] if ids else acts


def liste_exclusions(db: Session, user_id: int) -> list[dict]:
    lignes = (db.query(Exclusion).filter(Exclusion.utilisateur_id == user_id).order_by(Exclusion.id.desc()).all())
    ids = [e.activite_id for e in lignes if e.activite_id]
    acts = {a.id: a for a in db.query(Activite).filter(Activite.id.in_(ids))} if ids else {}
    out = []
    for e in lignes:
        a = acts.get(e.activite_id)
        if e.genre == "activite" and not a:
            continue
        out.append({
            "id": e.id, "genre": e.genre, "raison": e.raison,
            "activite_id": e.activite_id,
            "titre": (a.titre or cs.SPORTS.get(a.sport, cs.SPORTS["autre"])["label"]) if a else
                     LIBELLES_MESURES.get(e.type_mesure, e.type_mesure),
            "jour": (a.debut.date() if a else e.jour).isoformat(),
            "type_mesure": e.type_mesure,
        })
    return out


def ecarter(db: Session, user: Utilisateur, activite_id: Optional[int], type_mesure: Optional[str],
            jour: Optional[date], raison: Optional[str]) -> Exclusion:
    q = db.query(Exclusion).filter(Exclusion.utilisateur_id == user.id)
    if activite_id:
        a = db.query(Activite).filter(Activite.id == activite_id, Activite.utilisateur_id == user.id).first()
        if not a:
            raise ValueError("Séance introuvable")
        deja = q.filter(Exclusion.genre == "activite", Exclusion.activite_id == activite_id).first()
        e = deja or Exclusion(utilisateur_id=user.id, genre="activite", activite_id=activite_id)
    else:
        if type_mesure not in LIBELLES_MESURES or not jour:
            raise ValueError("Mesure inconnue")
        deja = q.filter(Exclusion.genre == "mesure", Exclusion.type_mesure == type_mesure, Exclusion.jour == jour).first()
        e = deja or Exclusion(utilisateur_id=user.id, genre="mesure", type_mesure=type_mesure, jour=jour)
    e.raison = (raison or "").strip()[:200] or None
    db.add(e)
    db.flush()
    return e


def reintegrer(db: Session, user: Utilisateur, exclusion_id: int) -> bool:
    e = db.query(Exclusion).filter(Exclusion.id == exclusion_id, Exclusion.utilisateur_id == user.id).first()
    if not e:
        return False
    db.delete(e)   # seule la mise à l'écart disparaît : la séance et la mesure n'ont jamais été touchées
    db.flush()
    return True


# ---------------------------------------------------------------------------
# Détection sur le compte
# ---------------------------------------------------------------------------

JOURS_MESURES = 120
MAX_ANOMALIES = 40


def anomalies(db: Session, user: Utilisateur, auj: date) -> dict:
    ids_ecartes, jours_ecartes = exclusions(db, user.id)
    lignes = (db.query(Activite.id, Activite.sport, Activite.titre, Activite.debut, Activite.duree_sec,
                       Activite.distance_km, Activite.fc_moyenne_bpm, Activite.fc_max_bpm)
              .filter(Activite.utilisateur_id == user.id).all())
    dbl = doublons((r.id, r.sport, r.debut, r.duree_sec) for r in lignes if r.debut)
    titres = {r.id: r.titre or cs.SPORTS.get(r.sport, cs.SPORTS["autre"])["label"] for r in lignes}
    out = []
    for r in lignes:
        if r.id in ids_ecartes or not r.debut:
            continue
        pb = anomalies_activite(r.sport, r.duree_sec, r.distance_km, r.fc_moyenne_bpm, r.fc_max_bpm, user.fc_max)
        if r.id in dbl:
            pb.append({"code": "doublon", "texte": f"Même sport, même heure et même durée que « {titres[dbl[r.id]]} » : doublon probable."})
        if pb:
            out.append({"genre": "activite", "activite_id": r.id, "titre": titres[r.id], "jour": r.debut.date().isoformat(),
                        "sport": r.sport, "problemes": pb})
    series: dict[str, dict[date, float]] = {}
    for m in db.query(MesureSante).filter(MesureSante.utilisateur_id == user.id,
                                          MesureSante.jour > auj - timedelta(days=JOURS_MESURES),
                                          MesureSante.type.in_(("sommeil", "fc_repos", "vfc", "vfc_rmssd"))):
        series.setdefault(m.type, {})[m.jour] = m.valeur
    vus = set()
    for a in anomalies_mesures(series):
        cle = (a["type"], a["jour"])
        developpe = {(t, a["jour"]) for t in GROUPES_MESURES.get(a["type"], (a["type"],))}
        if cle in vus or developpe & jours_ecartes:
            continue
        vus.add(cle)
        out.append({"genre": "mesure", "type_mesure": a["type"], "titre": LIBELLES_MESURES[a["type"]],
                    "jour": a["jour"].isoformat(), "problemes": [{"code": a["code"], "texte": a["texte"]}]})
    out.sort(key=lambda a: a["jour"], reverse=True)
    return {"total": len(out), "liste": out[:MAX_ANOMALIES]}


# ---------------------------------------------------------------------------
# Couverture de l'historique
# ---------------------------------------------------------------------------

def couverture(db: Session, user_id: int) -> list[dict]:
    """Par année, pour les sports d'endurance : séances, celles qui ont une FC moyenne, un tracé GPS,
    et le détail seconde par seconde (flux). Sans flux : pas de zones, de dérive ni de FC au seuil."""
    avec_trace = {aid for aid, in db.query(TraceGPS.activite_id).filter(TraceGPS.utilisateur_id == user_id)}
    par_an: dict[int, dict] = {}
    q = (db.query(Activite.id, Activite.debut, Activite.fc_moyenne_bpm,
                  Activite.details.like('%"analyse_iv"%').label("flux"))
         .filter(Activite.utilisateur_id == user_id, Activite.sport.in_(SPORTS_ENDURANCE)))
    for r in q:
        if not r.debut:
            continue
        c = par_an.setdefault(r.debut.year, {"annee": r.debut.year, "seances": 0, "avec_fc": 0, "avec_trace": 0, "avec_flux": 0})
        c["seances"] += 1
        c["avec_fc"] += bool(r.fc_moyenne_bpm)
        c["avec_trace"] += r.id in avec_trace
        c["avec_flux"] += bool(r.flux)
    out = sorted(par_an.values(), key=lambda c: -c["annee"])
    for c in out:
        c["partielle"] = c["seances"] >= 5 and c["avec_flux"] < 0.5 * c["seances"]
    return out


def annees_partielles(db: Session, user_id: int) -> list[int]:
    return sorted(c["annee"] for c in couverture(db, user_id) if c["partielle"])


# ---------------------------------------------------------------------------
# Journal des recalculs
# ---------------------------------------------------------------------------

REPERES = {
    "vma": {"label": "VMA", "unite": "km/h", "seuil": 0.1},
    "allure_critique": {"label": "Allure critique", "unite": "s/km", "seuil": 1},
    "fc_seuil": {"label": "FC au seuil", "unite": "bpm", "seuil": 1},
}
JOURNAL_MAX = 60


def _jour_fr(iso: Optional[str]) -> str:
    try:
        d = date.fromisoformat(iso)
    except (TypeError, ValueError):
        return "date inconnue"
    return f"{d.day}/{d.month:02d}/{d.year}"


def causes_reperes(vma: dict, efforts: dict, seuil: Optional[dict], auj: date) -> dict[str, tuple[float, str, str]]:
    """Valeur du jour de chaque repère, avec la raison si elle monte et la raison si elle baisse."""
    out = {}
    actuelle = (vma or {}).get("actuelle")
    if actuelle and actuelle.get("vma"):
        test = (vma or {}).get("dernier_test")
        recent = test and test.get("date") and (auj - date.fromisoformat(test["date"])).days <= 14
        cause = (f"Test du {_jour_fr(test['date'])} : {test['vma']} km/h." if recent
                 else "Estimation refaite sur les séances des dernières semaines (meilleurs efforts et FC).")
        out["vma"] = (actuelle["vma"], cause, cause)
    vc = (efforts or {}).get("vc")
    if vc and vc.get("allure_sec_km"):
        recents = [(c["actuel"]["date"], c) for c in (efforts.get("courbe") or [])
                   if c.get("actuel") and c["minutes"] in (3, 5, 10, 20)]
        dernier = max(recents, key=lambda x: x[0])[1] if recents else None
        mieux = (f"Meilleur effort de {dernier['label']} le {_jour_fr(dernier['actuel']['date'])}"
                 f"{' (' + dernier['actuel']['titre'] + ')' if dernier['actuel'].get('titre') else ''}."
                 if dernier else "Nouveaux meilleurs efforts sur 90 jours.")
        out["allure_critique"] = (vc["allure_sec_km"], mieux,
                                  "Un meilleur effort est sorti de la fenêtre des 90 derniers jours.")
    if seuil and seuil.get("valeur"):
        titre = f" ({seuil['titre']})" if seuil.get("titre") else ""
        out["fc_seuil"] = (seuil["valeur"], f"Effort soutenu du {_jour_fr(seuil.get('date'))}{titre}.",
                           f"L'effort de référence du {_jour_fr(seuil.get('date'))}{titre} vieillit : l'estimation est dépréciée avec le temps.")
    return out


def journaliser(db: Session, user_id: int, auj: date, reperes: dict[str, tuple[float, str, str]]) -> int:
    """Ajoute une ligne par repère dont la valeur a changé depuis la dernière ligne. Retourne le nombre de lignes."""
    derniers: dict[str, JournalCalcul] = {}
    for l in db.query(JournalCalcul).filter(JournalCalcul.utilisateur_id == user_id).order_by(JournalCalcul.id.desc()).limit(300):
        derniers.setdefault(l.cle, l)
    n = 0
    for cle, (valeur, cause_hausse, cause_baisse) in reperes.items():
        if cle not in REPERES or valeur is None:
            continue
        avant = derniers.get(cle)
        if avant is None:
            db.add(JournalCalcul(utilisateur_id=user_id, jour=auj, cle=cle, ancienne=None, nouvelle=float(valeur),
                                 cause="Première valeur enregistrée dans le journal."))
            n += 1
        elif abs(valeur - avant.nouvelle) >= REPERES[cle]["seuil"] - 1e-9:
            cause = cause_hausse if valeur > avant.nouvelle else cause_baisse
            if cle == "allure_critique":   # une allure qui baisse est un progrès
                cause = cause_hausse if valeur < avant.nouvelle else cause_baisse
            db.add(JournalCalcul(utilisateur_id=user_id, jour=auj, cle=cle, ancienne=avant.nouvelle,
                                 nouvelle=float(valeur), cause=cause[:300]))
            n += 1
    if n:
        db.flush()
    return n


def journal(db: Session, user_id: int) -> list[dict]:
    lignes = (db.query(JournalCalcul).filter(JournalCalcul.utilisateur_id == user_id)
              .order_by(JournalCalcul.id.desc()).limit(JOURNAL_MAX).all())
    return [{"id": l.id, "jour": l.jour.isoformat(), "cle": l.cle, "label": REPERES.get(l.cle, {}).get("label", l.cle),
             "unite": REPERES.get(l.cle, {}).get("unite"), "ancienne": l.ancienne, "nouvelle": l.nouvelle,
             "cause": l.cause} for l in lignes]


# ---------------------------------------------------------------------------
# État des synchros
# ---------------------------------------------------------------------------

SUIVIS = [("vfc", "VFC", ("vfc", "vfc_rmssd")), ("fc_repos", "FC au repos", ("fc_repos",)),
          ("sommeil", "Sommeil", ("sommeil",)), ("pas", "Pas", ("pas",))]
FENETRE_J = 30


def etat_synchros(db: Session, user: Utilisateur, auj: date) -> dict:
    """Ce qui est arrivé sur 30 jours (hier compris, aujourd'hui exclu : la journée n'est pas finie)
    et les jours manquants, pour les seules mesures que le carnet reçoit vraiment."""
    debut = auj - timedelta(days=FENETRE_J)
    jours = [debut + timedelta(days=i) for i in range(FENETRE_J)]
    par_type: dict[str, set[date]] = {}
    derniers: dict[str, date] = {}
    for m in db.query(MesureSante.type, MesureSante.jour).filter(MesureSante.utilisateur_id == user.id,
                                                                 MesureSante.jour >= auj - timedelta(days=90)):
        par_type.setdefault(m.type, set()).add(m.jour)
        if m.type not in derniers or m.jour > derniers[m.type]:
            derniers[m.type] = m.jour
    recus = []
    for cle, label, types in SUIVIS:
        vus = set().union(*(par_type.get(t, set()) for t in types))
        if not vus:
            recus.append({"cle": cle, "label": label, "suivi": False, "jours": 0, "sur": FENETRE_J, "dernier": None, "manquants": []})
            continue
        manquants = [j for j in jours if j not in vus]
        recus.append({"cle": cle, "label": label, "suivi": True, "jours": FENETRE_J - len(manquants), "sur": FENETRE_J,
                      "dernier": max(derniers[t] for t in types if t in derniers).isoformat(),
                      "manquants": [j.isoformat() for j in manquants]})
    pesees = {p.enregistre_le.date() for p in db.query(PoidsUtilisateur.enregistre_le)
              .filter(PoidsUtilisateur.utilisateur_id == user.id) if p.enregistre_le}
    seances = [d for d, in db.query(Activite.debut).filter(
        Activite.utilisateur_id == user.id, Activite.debut >= datetime.combine(debut, datetime.min.time()))]
    derniere = db.query(Activite.debut).filter(Activite.utilisateur_id == user.id).order_by(Activite.debut.desc()).first()
    return {
        "intervals": {"connecte": bool(user.intervals_cle),
                      "derniere_synchro": user.intervals_derniere_synchro.isoformat() + "Z"
                      if user.intervals_derniere_synchro else None},
        "seances": {"jours_30": len(seances), "derniere": derniere[0].isoformat() if derniere and derniere[0] else None},
        "pesees": {"jours_30": len([j for j in pesees if j >= debut]),
                   "derniere": max(pesees).isoformat() if pesees else None},
        "recus": recus,
        "du": debut.isoformat(), "au": (auj - timedelta(days=1)).isoformat(),
    }
