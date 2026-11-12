"""
Diagnostic de la connexion montre → Intervals.icu → carnet.

Chaque point de contrôle dit ce qui arrive (ou pas) et, si quelque chose manque, quoi faire
selon la montre choisie dans l'assistant. Le calcul (`controles`) ne fait aucun appel réseau :
la route lui passe les listes lues sur Intervals.icu, ce qui le rend testable.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional

MONTRES = {
    "apple": "Apple Watch",
    "garmin": "Garmin",
    "coros": "Coros",
    "polar": "Polar",
    "suunto": "Suunto",
    "android": "Montre Android",
    "autre": "Autre montre",
}
MARQUES_CONNECTEES = ("garmin", "coros", "polar", "suunto")  # liaison directe dans Intervals.icu › Connections

JOURS_SEANCES = 30
JOURS_FORME = 14


def _nom(montre: Optional[str]) -> str:
    return MONTRES.get(montre or "", "ta montre")


def conseil_seances(montre: Optional[str]) -> str:
    if montre == "apple":
        return ("Ouvre l'app Intervals.icu Companion sur l'iPhone et vérifie que l'envoi des entraînements "
                "Apple → Intervals.icu est activé. iOS ne laisse pas lire Santé quand l'iPhone est verrouillé : "
                "ouvre Companion quelques secondes après ta séance.")
    if montre in MARQUES_CONNECTEES:
        return (f"Sur intervals.icu (version web) : Settings › Connections › connecte ton compte {_nom(montre)}. "
                f"Les séances arrivent quelques minutes après la synchro de la montre avec l'app {_nom(montre)}.")
    if montre == "android":
        return ("Installe Health Sync sur le téléphone et choisis Intervals.icu comme destination "
                "(ou connecte directement la marque de ta montre dans intervals.icu › Settings › Connections).")
    return ("Sur intervals.icu : Settings › Connections, connecte le service de ta montre. "
            "Vérifie ensuite que tes dernières séances apparaissent dans le calendrier d'Intervals.icu.")


def conseil_forme(montre: Optional[str]) -> str:
    if montre == "apple":
        return ("Dans Réglages iPhone › Santé › Accès aux données › Intervals.icu Companion, autorise la lecture "
                "du sommeil, de la fréquence cardiaque, de la VFC et des pas, puis ouvre Companion.")
    if montre in MARQUES_CONNECTEES:
        return (f"Sur intervals.icu : Settings › Connections › {_nom(montre)}, vérifie que l'import des données "
                "de bien-être (sommeil, FC au repos, VFC) est activé. Toutes les marques n'envoient pas tout.")
    return ("Ces données viennent du champ « Wellness » d'Intervals.icu : vérifie dans Settings › Connections "
            "que le service de ta montre envoie le sommeil et la fréquence cardiaque.")


def _point(id_: str, titre: str, statut: str, detail: str, conseil: Optional[str] = None,
           action: Optional[str] = None, facultatif: bool = False) -> dict:
    """statut : ok, partiel, absent, erreur. action : bouton proposé par l'interface (« synchro »)."""
    return {"id": id_, "titre": titre, "statut": statut, "detail": detail,
            "conseil": conseil if statut != "ok" else None, "action": action if statut != "ok" else None,
            "facultatif": facultatif}


def _jours(n: int) -> str:
    return f"{n} jour{'s' if n > 1 else ''}"


def _date_fr(d: date) -> str:
    mois = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]
    return f"{d.day} {mois[d.month - 1]}"


def controles(montre: Optional[str], activites: list, wellness: list, ids_carnet: set[str],
              derniere_synchro: Optional[datetime], maintenant: Optional[datetime] = None) -> list[dict]:
    """activites / wellness : réponses d'Intervals.icu (30 et 14 derniers jours).
    ids_carnet : identifiants Intervals des séances déjà dans le carnet."""
    maintenant = maintenant or datetime.utcnow()
    points: list[dict] = []
    acts = [a for a in activites or [] if isinstance(a, dict) and a.get("id") and not a.get("deleted")]

    # 1. Séances reçues par Intervals.icu
    if not acts:
        points.append(_point("seances", "Séances sur Intervals.icu", "absent",
                             f"Aucune séance reçue par Intervals.icu ces {JOURS_SEANCES} derniers jours.",
                             conseil_seances(montre)))
    else:
        derniere = max(str(a.get("start_date_local") or a.get("start_date") or "")[:10] for a in acts)
        try:
            txt = f", la dernière le {_date_fr(date.fromisoformat(derniere))}"
        except ValueError:
            txt = ""
        points.append(_point("seances", "Séances sur Intervals.icu", "ok",
                             f"{len(acts)} séance{'s' if len(acts) > 1 else ''} en {JOURS_SEANCES} jours{txt}."))

    # 2. Séances arrivées dans le carnet
    if acts:
        manquantes = [a for a in acts if str(a["id"]) not in ids_carnet]
        if not manquantes:
            points.append(_point("carnet", "Séances dans le carnet", "ok", "Toutes les séances d'Intervals.icu sont dans le carnet."))
        else:
            points.append(_point("carnet", "Séances dans le carnet", "partiel",
                                 f"{len(manquantes)} séance{'s' if len(manquantes) > 1 else ''} d'Intervals.icu pas encore "
                                 "dans le carnet (ou supprimée(s) du carnet).",
                                 "Lance une synchronisation : elle récupère les séances manquantes.", action="synchro"))

    # 3. Tracé GPS et FC des séances
    dehors = [a for a in acts if (a.get("distance") or 0) > 500 and not a.get("trainer")]
    if dehors:
        avec_gps = sum(1 for a in dehors if "latlng" in (a.get("stream_types") or []))
        statut = "ok" if avec_gps == len(dehors) else ("absent" if avec_gps == 0 else "partiel")
        points.append(_point("gps", "Tracé GPS", statut,
                             f"{avec_gps} séance{'s' if avec_gps > 1 else ''} en extérieur sur {len(dehors)} avec un tracé.",
                             "Vérifie que le GPS de la montre est activé pour la course et le vélo en extérieur"
                             + (" (et, sur iPhone, que Companion a accès aux itinéraires d'entraînement dans Santé)." if montre == "apple" else ".")))
    if acts:
        avec_fc = sum(1 for a in acts if a.get("average_heartrate"))
        statut = "ok" if avec_fc == len(acts) else ("absent" if avec_fc == 0 else "partiel")
        points.append(_point("fc", "Fréquence cardiaque des séances", statut,
                             f"{avec_fc} séance{'s' if avec_fc > 1 else ''} sur {len(acts)} avec la FC.",
                             "Porte la montre bien serrée pendant l'effort, et vérifie que la fréquence cardiaque est "
                             "partagée avec Intervals.icu."))

    # 4. Données de forme (14 derniers jours)
    jours = [w for w in wellness or [] if isinstance(w, dict)]

    def compter(*cles) -> int:
        n = 0
        for w in jours:
            champs = {k.lower().replace("_", ""): v for k, v in w.items()}
            if any(isinstance(champs.get(c), (int, float)) and champs[c] > 0 for c in cles):
                n += 1
        return n

    for id_, titre, cles, facultatif in (
        ("sommeil", "Sommeil", ("sleepsecs",), False),
        ("phases", "Phases de sommeil", ("deepsleep", "lightsleep", "remsleep"), True),
        ("fc_repos", "FC au repos", ("restinghr",), False),
        ("vfc", "Variabilité cardiaque (VFC)", ("hrv", "hrvsdnn"), True),
        ("pas", "Pas", ("steps",), True),
        ("poids", "Poids", ("weight",), True),
    ):
        n = compter(*cles)
        seuil = JOURS_FORME // 2
        statut = "ok" if n >= seuil else ("absent" if n == 0 else "partiel")
        detail = f"{_jours(n)} sur les {JOURS_FORME} derniers." if n else f"Rien reçu ces {JOURS_FORME} derniers jours."
        if id_ == "poids":
            conseil = "Facultatif : pèse-toi avec une balance reliée à Intervals.icu, ou note ton poids dans le carnet."
            statut = "ok" if n else "absent"
            detail = f"{_jours(n)} sur les {JOURS_FORME} derniers." if n else "Aucune pesée reçue (tu peux la noter dans le carnet)."
        elif id_ == "phases" and montre == "apple":
            conseil = ("Les phases arrivent par des champs personnalisés d'Intervals.icu (DeepSleep, LightSleep, REMSleep) "
                       "remplis par Companion : vérifie dans ses réglages que l'envoi des phases de sommeil est activé.")
        elif id_ == "sommeil" or id_ == "phases":
            conseil = conseil_forme(montre) + " Porte la montre la nuit."
        else:
            conseil = conseil_forme(montre)
        points.append(_point(id_, titre, statut, detail, conseil, facultatif=facultatif))

    # 5. Dernière synchro du carnet
    if derniere_synchro is None:
        points.append(_point("synchro", "Synchronisation du carnet", "absent", "Aucune synchro encore faite.",
                             "Lance la première synchronisation.", action="synchro"))
    else:
        age = maintenant - derniere_synchro
        heures = int(age.total_seconds() // 3600)
        detail = ("Il y a moins d'une heure." if heures < 1 else
                  f"Il y a {heures} h." if heures < 48 else f"Il y a {age.days} jours.")
        points.append(_point("synchro", "Synchronisation du carnet", "ok" if age < timedelta(hours=36) else "partiel",
                             detail, "Le carnet se synchronise à chaque ouverture et chaque matin : lance-la à la main.",
                             action="synchro"))
    return points


def resume(points: list[dict]) -> dict:
    """Bilan global : les points facultatifs absents ne comptent pas comme un problème."""
    bloquants = [p for p in points if p["statut"] in ("absent", "erreur") and not p["facultatif"]]
    partiels = [p for p in points if p["statut"] == "partiel" or (p["statut"] == "absent" and p["facultatif"])]
    if bloquants:
        return {"etat": "probleme", "texte": f"{len(bloquants)} point{'s' if len(bloquants) > 1 else ''} à régler"}
    if partiels:
        return {"etat": "partiel", "texte": "Ça marche, avec quelques données en moins"}
    return {"etat": "ok", "texte": "Tout arrive bien"}
