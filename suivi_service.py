"""
Suivi au quotidien : forme du matin (VFC et FC repos comparées à la référence
personnelle), records personnels (course tirée des tracés, muscu tirée des notes)
et notifications push envoyées après la synchro du matin.
"""
from __future__ import annotations

import json
import logging
import os
import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

import analyses_service as an
import carnet_service as cs
from models import Activite, PushSubscription, SeancePrevue, Utilisateur

_log = logging.getLogger(__name__)

try:
    from pywebpush import WebPushException, webpush
    _PUSH_DISPO = True
except ImportError:  # dépendance absente : l'app fonctionne sans notifications
    _PUSH_DISPO = False

VAPID_PUBLIQUE = os.getenv("VAPID_PUBLIC_KEY", "").strip()
_VAPID_PRIVEE = os.getenv("VAPID_PRIVATE_KEY", "").strip()
_VAPID_EMAIL = os.getenv("VAPID_EMAIL", "").strip()

ALERTE_VFC_JOURS = 3   # mesures consécutives sous la normale avant l'alerte


def push_configure() -> bool:
    return _PUSH_DISPO and bool(VAPID_PUBLIQUE and _VAPID_PRIVEE)


def aujourdhui(user: Utilisateur) -> date:
    try:
        tz = ZoneInfo(user.fuseau_horaire or "Europe/Paris")
    except Exception:
        tz = ZoneInfo("Europe/Paris")
    return datetime.now(tz).date()


# ---------------------------------------------------------------------------
# Forme du matin
# ---------------------------------------------------------------------------

NIVEAUX = {
    "vert": ("En forme", "Feu vert : tu peux faire la séance la plus exigeante de la semaine."),
    "orange": ("Normal", "Récupération incomplète : garde l'intensité sous contrôle aujourd'hui."),
    "rouge": ("Fatigue", "Signes de fatigue marqués : allège la séance (endurance facile) ou prends du repos."),
}


def _alerte_vfc(points: list[dict]) -> int:
    """Nombre de mesures consécutives (les plus récentes) sous la normale (référence − 1 écart-type)."""
    n = 0
    for p in reversed(points):
        if p["vfc"] is None:
            continue
        if p.get("vfc_bas") is not None and p["vfc"] < p["vfc_bas"]:
            n += 1
        else:
            break
    return n


def _intensite(p: SeancePrevue) -> float:
    if p.rpe_cible:
        return p.rpe_cible
    t = f"{p.titre} {p.description or ''}".lower()
    if any(m in t for m in ("fraction", "vma", "seuil", "interval", "tempo", "test", "côte", "cote", "fartlek")):
        return 7
    if any(m in t for m in ("facile", "récup", "recup", "endurance", "footing", "mobilit")):
        return 3
    return 5


def forme_du_jour(db: Session, user: Utilisateur, auj: Optional[date] = None) -> dict:
    auj = auj or aujourdhui(user)
    mesures = an._mesures_par_type(db, user.id, auj - timedelta(days=an.REF_RECUP_JOURS + 30))
    rec = an._recuperation(mesures, auj, jours=21)
    pts = rec["points"]
    dernier = next((p for p in reversed(pts) if p["score"] is not None), None)
    frais = dernier if dernier and date.fromisoformat(dernier["jour"]) >= auj - timedelta(days=1) else None

    # Séances de la semaine encore à faire (le plan est hebdomadaire : l'athlète choisit le jour)
    lundi = cs._lundi(auj)
    cs.rapprocher_plan(db, user.id, auj)
    restantes = (db.query(SeancePrevue)
                 .filter(SeancePrevue.utilisateur_id == user.id, SeancePrevue.jour >= lundi,
                         SeancePrevue.jour <= lundi + timedelta(days=6), SeancePrevue.activite_id.is_(None),
                         SeancePrevue.statut != "sautee")
                 .order_by(SeancePrevue.jour, SeancePrevue.ordre, SeancePrevue.id).all())
    faite_auj = db.query(Activite.id).filter(
        Activite.utilisateur_id == user.id,
        Activite.debut >= datetime.combine(auj, datetime.min.time()),
        Activite.debut < datetime.combine(auj + timedelta(days=1), datetime.min.time())).first() is not None

    statut = frais["statut"] if frais else None
    conseil, suggestion = None, None
    if restantes:
        tri = sorted(restantes, key=_intensite)
        if statut == "rouge":
            suggestion = tri[0] if _intensite(tri[0]) <= 4 else None
            conseil = (f"Si tu t'entraînes, choisis « {suggestion.titre} »." if suggestion
                       else "Les séances restantes sont intenses : remplace-les aujourd'hui par de l'endurance facile ou du repos.")
        elif statut == "orange":
            moderees = [p for p in tri if _intensite(p) <= 6]
            suggestion = moderees[-1] if moderees else tri[0]
            conseil = f"Séance conseillée : « {suggestion.titre} »" + ("" if moderees else ", en gardant l'intensité modérée") + "."
        elif statut == "vert":
            suggestion = tri[-1]
            conseil = f"Bon jour pour « {suggestion.titre} »."

    def ecart_pct(v, ref):
        return round((v - ref) / ref * 100) if v is not None and ref else None

    return {
        "jour": auj.isoformat(),
        "statut": statut,
        "label": NIVEAUX[statut][0] if statut else None,
        "message": NIVEAUX[statut][1] if statut else None,
        "mesure_du": frais["jour"] if frais else None,
        "score": frais["score"] if frais else None,
        "vfc": frais["vfc"] if frais else None,
        "vfc_ref": frais.get("vfc_ref") if frais else None,
        "vfc_ecart_pct": ecart_pct(frais["vfc"], frais.get("vfc_ref")) if frais else None,
        "fc_repos": frais["fc_repos"] if frais else None,
        "fc_ref": frais.get("fc_ref") if frais else None,
        "fc_ecart": round(frais["fc_repos"] - frais["fc_ref"]) if frais and frais["fc_repos"] is not None
        and frais.get("fc_ref") is not None else None,
        "derniere_mesure": dernier["jour"] if dernier else None,
        "vfc_basse_jours": _alerte_vfc(pts),
        "historique": [{"jour": p["jour"], "statut": p["statut"]} for p in pts[-7:]],
        "seances_restantes": [{"id": p.id, "titre": p.titre, "sport": p.sport, "duree_min": p.duree_min,
                               "rpe_cible": p.rpe_cible} for p in restantes],
        "suggestion_id": suggestion.id if suggestion else None,
        "conseil": conseil,
        "seance_faite_aujourdhui": faite_auj,
    }


# ---------------------------------------------------------------------------
# Records personnels
# ---------------------------------------------------------------------------

# « Dips 4x8 », « pompes 9 x 8 », « curl 3x12 @ 10 kg », « Développé 4×6 à 12,5 kg »
_RE_SERIES = re.compile(
    r"(?P<nom>[A-Za-zÀ-ÿ'’][A-Za-zÀ-ÿ'’ \-]{1,40}?)(?:\s*\([^)]{0,40}\))?\s*:?\s*(?P<s>\d{1,2})\s*[x×*]\s*(?P<r>\d{1,3})"
    r"(?:\s*(?:@|à|a|avec)?\s*(?P<kg>\d{1,3}(?:[.,]\d{1,2})?)\s*kg)?", re.I)
# « 12 tractions », « Retest 5,5 tractions », « max 30 pompes »
_RE_MAX = re.compile(r"(?:^|[\s,;.(])(?P<n>\d{1,3}(?:[.,]5)?)\s+(?P<nom>[A-Za-zÀ-ÿ'’\-]{4,30})", re.I)
_PAS_EXERCICE = {"emom", "amrap", "force", "min", "minutes", "secondes", "sec", "séries", "series", "tours",
                 "blocs", "km", "kg", "fois", "rounds", "reps", "répétitions", "repetitions", "jours", "semaines"}
_ALIAS = {"traction": "Tractions", "pompe": "Pompes", "dip": "Dips", "australienne": "Australiennes",
          "squat": "Squats", "fente": "Fentes", "bulgare": "Fentes bulgares", "curl": "Curl"}


def _nom_exercice(brut: str) -> Optional[str]:
    nom = re.sub(r"\(.*?\)", "", brut).strip(" -:'’").lower()
    nom = re.sub(r"^(retest|test|max|puis|et|then)\s+", "", nom).strip()
    mots = nom.split()
    if not mots or mots[0] in _PAS_EXERCICE or len(nom) < 3:
        return None
    for cle, joli in _ALIAS.items():
        if mots[0].startswith(cle):
            return joli
    return nom[:1].upper() + nom[1:]


def exercices_muscu(texte: str) -> list[dict]:
    """Séries lues dans un texte libre : [{nom, series, reps, kg}] (reps max seules : series=1)."""
    if not texte:
        return []
    out, pris = [], []
    for m in _RE_SERIES.finditer(texte):
        nom = _nom_exercice(m["nom"].split(",")[-1].split(".")[-1])
        if nom:
            kg = float(m["kg"].replace(",", ".")) if m["kg"] else None
            out.append({"nom": nom, "series": int(m["s"]), "reps": int(m["r"]), "kg": kg})
        pris.append(m.span())
    for m in _RE_MAX.finditer(texte):
        if any(a <= m.start("n") < b for a, b in pris):
            continue
        nom = _nom_exercice(m["nom"])
        if nom:
            out.append({"nom": nom, "series": 1, "reps": float(m["n"].replace(",", ".")), "kg": None, "max": True})
    return out


def _records_muscu(acts: list[Activite]) -> dict:
    muscu = [a for a in acts if a.sport in ("muscu", "hiit")]
    par_ex: dict[str, list[dict]] = defaultdict(list)
    for a in muscu:
        for e in exercices_muscu(f"{a.notes or ''}"):
            par_ex[e["nom"]].append({**e, "date": a.debut.date().isoformat(), "activite_id": a.id, "titre": a.titre})
    exercices = []
    for nom, lignes in par_ex.items():
        lignes.sort(key=lambda x: x["date"])
        meilleur = max(lignes, key=lambda x: (x["reps"], x["kg"] or 0))
        volume = max(lignes, key=lambda x: x["series"] * x["reps"] * (x["kg"] or 1))
        charges = [x for x in lignes if x["kg"]]
        rm = max(charges, key=lambda x: x["kg"] * (1 + x["reps"] / 30)) if charges else None
        # Progression : chaque fois que les répétitions par série ont été battues
        progression, best = [], 0
        for x in lignes:
            if x["reps"] > best:
                best = x["reps"]
                progression.append({"date": x["date"], "reps": x["reps"], "kg": x["kg"]})
        exercices.append({
            "nom": nom, "nb": len(lignes), "derniere": lignes[-1]["date"],
            "meilleure_serie": {"reps": meilleur["reps"], "kg": meilleur["kg"], "date": meilleur["date"],
                                "activite_id": meilleur["activite_id"]},
            "meilleur_volume": {"series": volume["series"], "reps": volume["reps"], "kg": volume["kg"],
                                "total": round(volume["series"] * volume["reps"]), "date": volume["date"],
                                "activite_id": volume["activite_id"]},
            "rm_estime": {"kg": round(rm["kg"] * (1 + rm["reps"] / 30), 1), "date": rm["date"],
                          "activite_id": rm["activite_id"]} if rm else None,
            "progression": progression,
        })
    exercices.sort(key=lambda e: (-e["nb"], e["nom"]))

    semaines = defaultdict(int)
    for a in muscu:
        semaines[cs._lundi(a.debut.date())] += 1
    longue = max(muscu, key=lambda a: a.duree_sec or 0, default=None)
    sem = max(semaines.items(), key=lambda kv: (kv[1], kv[0]), default=None)
    return {
        "exercices": exercices,
        "nb_seances": len(muscu),
        "nb_notees": sum(1 for a in muscu if exercices_muscu(a.notes or "")),
        "plus_longue": {"duree_sec": longue.duree_sec, "duree_str": cs.fmt_duree(longue.duree_sec),
                        "date": longue.debut.date().isoformat(), "activite_id": longue.id, "titre": longue.titre}
        if longue and longue.duree_sec else None,
        "meilleure_semaine": {"semaine": sem[0].isoformat(), "seances": sem[1]} if sem else None,
    }


def _historique_records(acts: list[Activite]) -> dict[str, list[dict]]:
    """Pour chaque distance, la suite des records successifs (date, temps)."""
    hist: dict[str, list[dict]] = {}
    pied = sorted((a for a in acts if a.sport in cs.SPORTS_PIED), key=lambda a: a.debut)
    for label, d in an.EFFORTS:
        best, suite = None, []
        for a in pied:
            t = (cs._details_dict(a).get("efforts") or {}).get(label)
            if t and (best is None or t < best):
                best = t
                suite.append({"date": a.debut.date().isoformat(), "temps_sec": t, "temps_str": cs.fmt_duree(t),
                              "allure_str": cs.fmt_allure(t / (d / 1000)), "activite_id": a.id, "titre": a.titre})
        hist[label] = suite
    return hist


def records(db: Session, user: Utilisateur) -> dict:
    acts = (db.query(Activite).filter(Activite.utilisateur_id == user.id).order_by(Activite.debut).all())
    an.maj_efforts(db, user.id, acts)
    course = an._course(acts, aujourdhui(user))
    stats = cs.calculer_stats(acts)
    return {
        "course": {
            "distances": [l for l, _ in an.EFFORTS],
            "records": course["records"],
            "top": course["top"],
            "historique": _historique_records(acts),
            "evolution": course["evolution"],
        },
        "officiels": stats["records"]["distances"],
        "autres": stats["records"]["autres"],
        "muscu": _records_muscu(acts),
    }


def records_recents(db: Session, user: Utilisateur, depuis: datetime) -> list[str]:
    """Records battus par les séances ajoutées depuis `depuis` (pour la notification)."""
    acts = (db.query(Activite).filter(Activite.utilisateur_id == user.id).order_by(Activite.debut).all())
    an.maj_efforts(db, user.id, acts)
    nouvelles = {a.id for a in acts if a.cree_le and a.cree_le >= depuis}
    if not nouvelles:
        return []
    msgs = []
    for label, suite in _historique_records(acts).items():
        if len(suite) >= 2 and suite[-1]["activite_id"] in nouvelles:
            gain = suite[-2]["temps_sec"] - suite[-1]["temps_sec"]
            msgs.append(f"{label} en {suite[-1]['temps_str']} (−{cs.fmt_duree(gain)})")
    for e in _records_muscu(acts)["exercices"]:
        prog = e["progression"]
        if len(prog) >= 2 and e["meilleure_serie"]["activite_id"] in nouvelles:
            msgs.append(f"{e['nom']} : {prog[-1]['reps']:g} répétitions (avant {prog[-2]['reps']:g})")
    return msgs


# ---------------------------------------------------------------------------
# Notifications push
# ---------------------------------------------------------------------------

def envoyer(db: Session, user_id: int, titre: str, corps: str, url: str = "/", tag: str = "carnet") -> int:
    """Envoie une notification à tous les appareils abonnés. Retourne le nombre d'envois réussis."""
    if not push_configure():
        return 0
    n = 0
    for s in db.query(PushSubscription).filter(PushSubscription.utilisateur_id == user_id).all():
        try:
            webpush(subscription_info={"endpoint": s.endpoint, "keys": {"p256dh": s.p256dh, "auth": s.auth}},
                    data=json.dumps({"title": titre, "body": corps, "url": url, "tag": tag}),
                    vapid_private_key=_VAPID_PRIVEE, vapid_claims={"sub": f"mailto:{_VAPID_EMAIL}"
                                                                   if _VAPID_EMAIL and not _VAPID_EMAIL.startswith("mailto:")
                                                                   else _VAPID_EMAIL or "mailto:carnet@example.com"},
                    timeout=10)
            n += 1
        except WebPushException as e:
            code = getattr(getattr(e, "response", None), "status_code", None)
            if code in (404, 410):  # abonnement expiré (appli désinstallée, autorisation retirée)
                db.delete(s)
            else:
                _log.warning("Notification push refusée (%s)", code)
        except Exception:
            _log.exception("Envoi de notification push en échec")
    db.flush()
    return n


def notifications_matin(db: Session, user: Utilisateur, depuis: Optional[datetime] = None) -> dict:
    """Après la synchro du matin : forme du jour + séance conseillée, alerte VFC, records battus."""
    if not push_configure() or not db.query(PushSubscription.id).filter(
            PushSubscription.utilisateur_id == user.id).first():
        return {"envoyees": 0}
    envoyees = 0
    f = forme_du_jour(db, user)
    if f["seances_restantes"] or f["label"]:
        titre = f"Forme du matin : {f['label']}" if f["label"] else "Ta semaine d'entraînement"
        n = len(f["seances_restantes"])
        reste = f"{n} séance{'s' if n > 1 else ''} à faire cette semaine." if n else "Plan de la semaine bouclé."
        corps = " ".join(x for x in [f["conseil"], reste] if x)
        envoyees += envoyer(db, user.id, titre, corps, "/", "forme")
    if f["vfc_basse_jours"] >= ALERTE_VFC_JOURS:
        envoyees += envoyer(db, user.id, "VFC en baisse",
                            f"Ta VFC est sous ta normale depuis {f['vfc_basse_jours']} mesures d'affilée : "
                            "fatigue, stress ou maladie qui couve. Lève le pied quelques jours.", "/stats", "vfc")
    recs = records_recents(db, user, depuis or datetime.utcnow() - timedelta(hours=26))
    if recs:
        envoyees += envoyer(db, user.id, "Nouveau record 🎉" if len(recs) == 1 else f"{len(recs)} nouveaux records 🎉",
                            " · ".join(recs), "/records", "record")
    return {"envoyees": envoyees, "statut": f["statut"], "records": len(recs)}
