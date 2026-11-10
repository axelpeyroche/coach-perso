"""
Protocoles de test (piste 2.3) : catalogue, planification dans le plan,
reconnaissance des séances réalisées et comparaison au test précédent.

Aucune table dédiée : un test planifié est une séance prévue dont l'id_externe
vaut « test-<clé>-<jour> ». Une séance réalisée est reconnue comme test si elle
est rapprochée d'une telle séance prévue (rapprochement habituel de la synchro)
ou si son titre contient le nom du test.
"""
from __future__ import annotations

import unicodedata
from datetime import date, timedelta
from typing import Optional

from sqlalchemy.orm import Session

import carnet_service as cs
from models import Activite, SeancePrevue, Utilisateur

PREFIXE = "test-"

PROTOCOLES = [
    {
        "cle": "demi_cooper", "titre": "Demi-Cooper", "sous_titre": "6 min à fond", "sport": "course",
        "duree_min": 35, "rpe": 9.5, "refaire_j": 56, "mesure": "VMA", "sens": "hausse",
        "mots": ("demi-cooper", "demi cooper", "cooper", "test vma"),
        "sert": "Mesure ta VMA, dont découlent toutes tes allures d'entraînement.",
        "etapes": [
            "Échauffement : 15 à 20 min de footing facile, puis 3 lignes droites progressives.",
            "Test : 6 min à fond sur piste ou terrain plat, en partant juste en dessous de ton maximum pour finir fort.",
            "Retour au calme : 10 min de footing très lent.",
        ],
        "conseil": "Fais-le reposé, par temps calme, sur terrain plat. La VMA vaut la distance parcourue en 6 min, divisée par 100.",
    },
    {
        "cle": "seuil_30", "titre": "30 min au seuil", "sous_titre": "30 min seul, le plus vite possible", "sport": "course",
        "duree_min": 55, "rpe": 8.5, "refaire_j": 56, "mesure": "Allure et FC au seuil", "sens": "baisse",
        "mots": ("test seuil", "30 min seuil", "30 min au seuil", "test 30 min"),
        "sert": "Donne ton allure et ta fréquence cardiaque au seuil, pour caler tes zones.",
        "etapes": [
            "Échauffement : 15 min de footing facile et 2 accélérations.",
            "Test : 30 min à l'allure la plus rapide que tu peux tenir régulièrement, seul, sans à-coups.",
            "Retour au calme : 10 min très faciles.",
        ],
        "conseil": "Pars prudemment : les 10 premières minutes doivent sembler presque trop faciles. Enregistre le test comme une séance à part si tu veux la FC moyenne exacte.",
    },
    {
        "cle": "cs_3_10", "titre": "Allure critique", "sous_titre": "3 min puis 10 min à fond", "sport": "course",
        "duree_min": 70, "rpe": 9.5, "refaire_j": 84, "mesure": "Allure critique et réserve D′", "sens": "hausse",
        "mots": ("allure critique", "vitesse critique", "3 min + 10", "3+10", "test cs"),
        "sert": "Deux efforts maximaux suffisent à tracer ta courbe allure–durée : allure tenable longtemps et réserve au-dessus.",
        "etapes": [
            "Échauffement : 15 à 20 min de footing facile, puis 3 lignes droites.",
            "Premier effort : 3 min à fond.",
            "Récupération : 30 min, en marchant puis en trottinant très doucement.",
            "Second effort : 10 min à fond, allure régulière.",
            "Retour au calme : 10 min très faciles.",
        ],
        "conseil": "Les deux efforts doivent être réellement maximaux, sur le même terrain plat, dans la même séance.",
    },
    {
        "cle": "sortie_longue", "titre": "Dérive aérobie", "sous_titre": "75 min à allure constante", "sport": "course",
        "duree_min": 75, "rpe": 4, "refaire_j": 42, "mesure": "Dérive cardiaque", "sens": "baisse",
        "mots": ("test derive", "derive aerobie", "test aerobie", "derive cardiaque"),
        "sert": "Vérifie que ton endurance fondamentale est bien réglée : le cœur doit rester stable à allure égale.",
        "etapes": [
            "75 min sur terrain plat ou peu vallonné, à ton allure d'endurance habituelle.",
            "Garde la même allure du début à la fin, sans accélérer ni finir fort.",
            "Bois normalement ; évite la grosse chaleur, qui fausse la mesure.",
        ],
        "conseil": "Sous 5 % de dérive, l'allure est bien en endurance fondamentale. Au-dessus, ralentis tes sorties faciles.",
    },
    {
        "cle": "traction_max", "titre": "Tractions max", "sous_titre": "une série jusqu'à l'échec", "sport": "muscu",
        "duree_min": 20, "rpe": 9, "refaire_j": 28, "mesure": "Répétitions", "sens": "hausse",
        "mots": ("test tractions", "tractions max", "max tractions", "test traction"),
        "sert": "Ton repère de force du haut du corps, à suivre mois après mois.",
        "etapes": [
            "Échauffement : mobilité des épaules, 2 séries faciles de 3 à 5 tractions, 2 min de repos.",
            "Test : une seule série, amplitude complète (bras tendus en bas, menton au-dessus de la barre), jusqu'à l'échec.",
            "Note le nombre de répétitions propres dans la séance.",
        ],
        "conseil": "Toujours la même prise et la même amplitude, sinon les tests ne se comparent pas.",
    },
]
PAR_CLE = {p["cle"]: p for p in PROTOCOLES}


def _plat(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", (s or "").lower()) if unicodedata.category(c) != "Mn")


def _fr(x: float, n: int = 1) -> str:
    return f"{x:.{n}f}".replace(".", ",")


def _mmss(sec: float) -> str:
    sec = round(sec)
    return f"{sec // 60}:{sec % 60:02d}"


def _signe(v: float, n: int = 1) -> str:
    return ("+" if v > 0 else "−" if v < 0 else "") + _fr(abs(v), n)


def seance(cle: str, jour: date) -> Optional[dict]:
    """Séance prévue correspondant à un test, prête pour `enregistrer_plan`."""
    p = PAR_CLE.get(cle)
    if not p:
        return None
    description = "\n".join([p["sert"], ""] + [f"- {e}" for e in p["etapes"]] + ["", p["conseil"]])
    return {"jour": jour, "sport": p["sport"], "titre": f"Test : {p['titre']} ({p['sous_titre']})", "description": description,
            "duree_min": p["duree_min"], "distance_km": None, "dplus_m": None, "rpe_cible": p["rpe"], "ordre": 0,
            "id_externe": f"{PREFIXE}{cle}-{jour.isoformat()}", "objectif_id": None}


def _cle_prevue(p: SeancePrevue) -> Optional[str]:
    ext = p.id_externe or ""
    if not ext.startswith(PREFIXE):
        return None
    cle = ext[len(PREFIXE):].rsplit("-", 3)[0]
    return cle if cle in PAR_CLE else None


# ---------------------------------------------------------------------------
# Résultat d'une séance selon le protocole
# ---------------------------------------------------------------------------

def _demi_cooper(a: Activite, par: dict) -> Optional[dict]:
    from analyses_service import fraction_vma
    if a.duree_sec and a.distance_km and 330 <= a.duree_sec <= 390:
        v, base = a.distance_km * 10, "distance parcourue en 6 min"
    elif par.get(300):
        v, base = par[300] / 300 * 3.6 / fraction_vma(5), "meilleures 5 min du tracé"
    else:
        return None
    return {"valeur": round(v, 1), "texte": f"{_fr(v)} km/h", "detail": f"VMA d'après la {base}." if base.startswith("d")
            else f"VMA d'après les {base}."}


def _seuil_30(a: Activite, par: dict) -> Optional[dict]:
    if par.get(1800):
        allure = 1800 / (par[1800] / 1000)
    elif a.duree_sec and a.distance_km and 1680 <= a.duree_sec <= 2400:
        allure = a.duree_sec / a.distance_km
    else:
        return None
    fc = a.fc_moyenne_bpm if a.fc_moyenne_bpm and a.duree_sec and a.duree_sec <= 2700 else None
    return {"valeur": round(allure), "texte": f"{_mmss(allure)}/km" + (f" · {fc} bpm" if fc else ""),
            "detail": "Allure moyenne des 30 meilleures minutes" + (", FC moyenne de la séance." if fc else
                                                                   " ; FC non retenue (la séance contient l'échauffement)."),
            "fc": fc}


def _cs(a: Activite, par: dict) -> Optional[dict]:
    d3, d10 = par.get(180), par.get(600)
    if not d3 or not d10 or d3 / 180 <= d10 / 600:
        return None
    v = (d10 - d3) / 420
    if v <= 0:
        return None
    reserve = d3 - v * 180
    return {"valeur": round(v * 3.6, 1), "texte": f"{_fr(v * 3.6)} km/h · {_mmss(1000 / v)}/km",
            "detail": f"Réserve D′ : {round(reserve)} m au-dessus de l'allure critique.", "reserve_m": round(reserve)}


def _derive(a: Activite, par: dict) -> Optional[dict]:
    det = cs._details_dict(a)
    d = det.get("derive_fc")
    if d is None or not a.duree_sec or a.duree_sec < 3000:
        return None
    dur = det.get("durabilite_pct")
    return {"valeur": round(d, 1), "texte": f"{_fr(d)} % de dérive",
            "detail": ("Cœur stable : l'allure est bien en endurance fondamentale." if d < 5 else
                       "Le cœur a dérivé : l'allure était au-dessus de l'endurance fondamentale, ou il faisait chaud.")
            + (f" Perte d'efficacité en fin de sortie : {_fr(dur)} %." if dur is not None else "")}


CALCULS = {"demi_cooper": _demi_cooper, "seuil_30": _seuil_30, "cs_3_10": _cs, "sortie_longue": _derive}
UNITES = {"demi_cooper": ("km/h", 1), "seuil_30": ("s/km", 0), "cs_3_10": ("km/h", 1), "sortie_longue": ("pt", 1),
          "traction_max": ("", 0)}


def _ecart(cle: str, v: float, avant: float) -> dict:
    unite, n = UNITES[cle]
    d = round(v - avant, n)
    sens = PAR_CLE[cle]["sens"]
    mieux = None if d == 0 else (d > 0) == (sens == "hausse")
    return {"ecart": d, "ecart_texte": "identique" if d == 0 else f"{_signe(d, n)}{' ' + unite if unite else ''}", "mieux": mieux}


def calculer(db: Session, user: Utilisateur, acts: list[Activite], vma: dict, musculation: Optional[dict], auj: date) -> dict:
    import capacites_avancees as cav
    par_id = {a.id: a for a in acts}

    # Séances prévues qui sont des tests : rattachées (résultat) ou à venir (prochain)
    lies: dict[str, set[int]] = {c: set() for c in PAR_CLE}
    jours_prevus: dict[str, set[date]] = {c: set() for c in PAR_CLE}
    prochains: dict[str, dict] = {}
    for p in (db.query(SeancePrevue).filter(SeancePrevue.utilisateur_id == user.id,
                                            SeancePrevue.id_externe.like(PREFIXE + "%")).order_by(SeancePrevue.jour)):
        cle = _cle_prevue(p)
        if not cle:
            continue
        if p.activite_id and p.activite_id in par_id:
            lies[cle].add(p.activite_id)
            jours_prevus[cle].add(par_id[p.activite_id].debut.date())
        elif p.jour >= auj and p.statut != "sautee" and cle not in prochains:
            prochains[cle] = {"id": p.id, "jour": p.jour.isoformat(), "dans_j": (p.jour - auj).days}
        elif p.jour < auj:
            jours_prevus[cle].add(p.jour)

    res = []
    for proto in PROTOCOLES:
        cle = proto["cle"]
        lignes: dict[str, dict] = {}
        if cle == "traction_max":
            ex = next((e for e in (musculation or {}).get("exercices", []) if e["nom"] == "Tractions"), None)
            for h in (ex or {}).get("historique", []):
                jour = date.fromisoformat(h["date"])
                if h.get("reps") and (h.get("test") or jour in jours_prevus[cle]):
                    lignes[h["date"]] = {"date": h["date"], "valeur": round(h["reps"]), "texte": f"{round(h['reps'])} tractions",
                                         "detail": None, "activite_id": None, "titre": None}
        else:
            if cle == "demi_cooper":
                for t in vma.get("tests") or []:
                    lignes[t["date"]] = {"date": t["date"], "valeur": t["vma"], "texte": f"{_fr(t['vma'])} km/h", "detail": None,
                                         "activite_id": t.get("activite_id"), "titre": t.get("titre")}
            for a in acts:
                if a.sport not in cs.SPORTS_PIED or a.debut.date() > auj:
                    continue
                titre = _plat(a.titre or "")
                if a.id not in lies[cle] and not any(m in titre for m in proto["mots"]):
                    continue
                jour = a.debut.date().isoformat()
                if jour in lignes and cle == "demi_cooper":
                    continue
                r = CALCULS[cle](a, cav._par_duree(a))
                if r:
                    lignes[jour] = {"date": jour, "activite_id": a.id, "titre": a.titre, **r}
        resultats = sorted(lignes.values(), key=lambda x: x["date"])
        for i, r in enumerate(resultats):
            r.update(_ecart(cle, r["valeur"], resultats[i - 1]["valeur"]) if i else {"ecart": None, "ecart_texte": None, "mieux": None})
        dernier = resultats[-1] if resultats else None
        age = (auj - date.fromisoformat(dernier["date"])).days if dernier else None
        res.append({
            **{k: proto[k] for k in ("cle", "titre", "sous_titre", "sport", "duree_min", "mesure", "sert", "etapes", "conseil",
                                     "refaire_j")},
            "resultats": resultats[-8:][::-1], "nb": len(resultats), "dernier": dernier, "age_j": age,
            "a_refaire": age is None or age > proto["refaire_j"], "prochain": prochains.get(cle),
        })
    return {"protocoles": res, "a_refaire": [p["titre"] for p in res if p["a_refaire"] and not p["prochain"]],
            "min_jour": auj.isoformat(), "max_jour": (auj + timedelta(days=120)).isoformat()}


def resume(t: Optional[dict]) -> Optional[dict]:
    if not t:
        return None
    return {"protocoles": [{"titre": p["titre"], "prochain": p["prochain"],
                            "dernier": p["dernier"] and {k: p["dernier"].get(k) for k in ("date", "texte", "ecart_texte")}}
                           for p in t["protocoles"]], "a_refaire": t["a_refaire"]}


def markdown(t: Optional[dict]) -> list[str]:
    if not t:
        return []
    faits = [f"{p['titre']} {p['dernier']['texte']} le {p['dernier']['date']}"
             + (f" ({p['dernier']['ecart_texte']} par rapport au précédent)" if p["dernier"].get("ecart_texte") else "")
             for p in t["protocoles"] if p["dernier"]]
    prevus = [f"{p['titre']} le {p['prochain']['jour']}" for p in t["protocoles"] if p["prochain"]]
    l = []
    if faits:
        l.append("- Derniers tests : " + " ; ".join(faits) + ".")
    if prevus:
        l.append("- Tests déjà planifiés : " + ", ".join(prevus) + ".")
    if t["a_refaire"]:
        l.append("- Tests à (re)faire, jamais faits ou trop anciens : " + ", ".join(t["a_refaire"]) + ".")
    return l
