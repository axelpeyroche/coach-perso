"""
Lecture d'une séance : type reconnu (footing, fractionné, seuil, côtes, sortie longue…),
répétitions détectées dans le tracé, bilan en trois phrases et comparaison au prévu.

Tout est fait par règles, sans IA. Le type et le résumé des répétitions sont calculés une
fois par tracé et gardés dans `details["seance"]` ; le détail par répétition (avec la FC)
est recalculé à la demande avec les courbes de la fiche.
"""
import json
import re
import unicodedata
from datetime import timedelta
from statistics import median
from typing import Optional

from sqlalchemy.orm import Session

import carnet_service as cs
import decoupage as dc
from models import Activite, SeancePrevue, TraceGPS, Utilisateur

VERSION_SEANCE = 2

TYPES = cs.TYPES_SEANCE

VITESSE_MARCHE = 1.9      # m/s (≈ 8:45/km à plat) : en dessous, ce n'est pas de la course
ECART_MIN = 1.16          # le travail doit aller au moins 16 % plus vite que la récupération
ECART_COTE = 1.22         # …et 22 % en côte, où le relief fait déjà varier l'allure ramenée au plat
REP_MIN_S = 20            # une répétition dure au moins 20 s…
REP_MAX_S = 25 * 60       # …et au plus 25 min
TROU_MAX_S = 8            # un ralentissement plus court ne coupe pas une répétition
BORD_S = 25               # délai laissé pour passer de l'allure de travail à celle de récupération
PENTE_COTE = 0.04         # pente moyenne à partir de laquelle une répétition est une côte


# ---------------------------------------------------------------------------
# Détection des répétitions
# ---------------------------------------------------------------------------

def _vitesses(s: dc.Seance, demi_s: float = 6.0) -> list:
    """Vitesse en chaque point (m/s), lissée sur ±6 s et ramenée au plat pour la course et le trail."""
    n, a, b, sortie = s.n, 0, 0, []
    for i in range(n):
        while s.temps[i] - s.temps[a] > demi_s:
            a += 1
        while b < n - 1 and s.temps[b + 1] - s.temps[i] <= demi_s:
            b += 1
        dt = s.temps[b] - s.temps[a]
        v = (s.dist[b] - s.dist[a]) / dt if dt > 0 else 0.0
        if dt > 4 * demi_s:  # montre en pause dans la fenêtre
            v = 0.0
        sortie.append(v * dc.facteur_pente(s.pente[i]) if s.gap else v)
    return sortie


def _vitesse_a(s: dc.Seance, vit: list, i: int, decalage_s: float) -> float:
    """Vitesse `decalage_s` secondes avant (négatif) ou après le point i ; 0 hors de la séance."""
    cible, pas = s.temps[i] + decalage_s, 1 if decalage_s > 0 else -1
    while 0 <= i + pas < s.n and (s.temps[i] - cible) * pas < 0:
        i += pas
    return vit[i] if (s.temps[i] - cible) * pas >= 0 else 0.0


def _deux_groupes(valeurs: list, poids: list) -> Optional[tuple[float, float, float]]:
    """Sépare les vitesses en deux groupes (k-moyennes à une dimension, pondérées par le temps).
    Retourne (centre lent, centre rapide, part du temps dans le groupe rapide)."""
    if len(valeurs) < 30:
        return None
    tri = sorted(valeurs)
    bas, haut = tri[len(tri) // 5], tri[-max(1, len(tri) // 10)]
    if haut <= bas:
        return None
    for _ in range(25):
        seuil = (bas + haut) / 2
        sb = pb = sh = ph = 0.0
        for v, p in zip(valeurs, poids):
            if v < seuil:
                sb, pb = sb + v * p, pb + p
            else:
                sh, ph = sh + v * p, ph + p
        if not pb or not ph:
            return None
        nb, nh = sb / pb, sh / ph
        if abs(nb - bas) < 1e-3 and abs(nh - haut) < 1e-3:
            break
        bas, haut = nb, nh
    return bas, haut, ph / (pb + ph)


def _cv(v: list) -> float:
    if len(v) < 2:
        return 0.0
    m = sum(v) / len(v)
    return (sum((x - m) ** 2 for x in v) / len(v)) ** 0.5 / m if m else 0.0


def detecter_intervalles(s: dc.Seance) -> Optional[dict]:
    """Répétitions d'une séance fractionnée : {reps: [bilan par répétition], resume: {...}}, ou None.
    Une répétition est un passage nettement plus rapide que le reste (allure ramenée au plat :
    les côtes ressortent aussi), d'au moins 20 s ; il en faut trois de durée comparable."""
    if s.n < 60 or s.dist[-1] < 1500 or s.temps[-1] - s.temps[0] < 8 * 60:
        return None
    vit = _vitesses(s)
    pas = [max(0.0, min(15.0, s.temps[i] - s.temps[i - 1])) if i else 0.0 for i in range(s.n)]
    couru = [(v, p) for v, p in zip(vit, pas) if v >= VITESSE_MARCHE and p > 0]
    groupes = _deux_groupes([v for v, _ in couru], [p for _, p in couru])
    if not groupes:
        return None
    lent, rapide, part = groupes
    if rapide / lent < ECART_MIN or not 0.04 <= part <= 0.8:
        return None
    seuil = (lent + rapide) / 2
    # Blocs au-dessus du seuil, les trous de moins de 8 s recollés
    blocs, debut, fin = [], None, None
    for i in range(1, s.n):
        if vit[i] >= seuil:
            if debut is None:
                debut = i - 1
            elif fin is not None and s.temps[i] - s.temps[fin] > TROU_MAX_S:
                blocs.append((debut, fin))
                debut = i - 1
            fin = i
    if debut is not None:
        blocs.append((debut, fin))
    blocs = [(a, b) for a, b in blocs if REP_MIN_S <= s.temps[b] - s.temps[a] <= REP_MAX_S]
    if len(blocs) < 3:
        return None
    # Une répétition démarre et s'arrête franchement : 25 s avant et après, l'allure est déjà
    # retombée vers celle de la récupération. Écarte les ondulations d'un footing vallonné.
    calme = (lent + seuil) / 2
    francs = sum(1 for a, b in blocs if _vitesse_a(s, vit, a, -BORD_S) <= calme and _vitesse_a(s, vit, b, BORD_S) <= calme)
    if francs < 0.7 * len(blocs):
        return None
    # Ne garder que les blocs de durée comparable à la médiane (écarte une accélération isolée)
    med = median(s.temps[b] - s.temps[a] for a, b in blocs)
    blocs = [(a, b) for a, b in blocs if 0.45 * med <= s.temps[b] - s.temps[a] <= 2.2 * med]
    if len(blocs) < 3:
        return None
    reps = []
    for k, (a, b) in enumerate(blocs):
        bl = s.bilan(a, b)
        if not bl:
            continue
        fcs = [x for x in (s.fc[a:b + 1] if s.fc else []) if dc._num(x)]
        suivant = blocs[k + 1][0] if k + 1 < len(blocs) else None
        recup = round(s.temps[suivant] - s.temps[b]) if suivant is not None else None
        pente = (s.alt[b] - s.alt[a]) / (s.dist[b] - s.dist[a]) if s.alt and s.dist[b] > s.dist[a] else 0.0
        reps.append({
            "numero": len(reps) + 1,
            "debut_sec": round(s.temps[a] - s.temps[0]), "fin_sec": round(s.temps[b] - s.temps[0]),
            "debut_km": bl["debut_km"], "fin_km": bl["fin_km"],
            "duree_sec": round(s.temps[b] - s.temps[a]),
            "distance_m": round(bl["distance_km"] * 1000),
            "allure_sec_km": bl["allure_sec_km"], "gap_sec_km": bl.get("gap_sec_km"),
            "fc": bl["fc"], "fc_max": round(max(fcs)) if fcs else None,
            "dplus_m": bl["dplus_m"], "pente_pct": round(pente * 100, 1),
            "recup_sec": recup,
        })
    if len(reps) < 3:
        return None
    durees = [r["duree_sec"] for r in reps]
    if _cv(durees) > 0.45:
        return None
    allures = [r["allure_sec_km"] for r in reps]
    # Le travail doit vraiment trancher sur les récupérations
    recups = [s.bilan(blocs[k][1], blocs[k + 1][0]) for k in range(len(blocs) - 1)]
    all_recup = [r["gap_sec_km"] if r.get("gap_sec_km") else r["allure_sec_km"] for r in recups if r]
    all_trav = [r["gap_sec_km"] or r["allure_sec_km"] for r in reps]
    if all_recup and median(all_recup) / median(all_trav) < ECART_MIN:
        return None
    dist_tot = sum(r["distance_m"] for r in reps)
    duree_tot = sum(r["duree_sec"] for r in reps)
    cotes = median(r["pente_pct"] for r in reps) >= PENTE_COTE * 100
    # En côte, le relief suffit à faire onduler l'allure ramenée au plat : n'y voir des répétitions
    # que si elles sont bien calibrées (mêmes durées) et nettement plus appuyées que le retour
    if cotes and (_cv(durees) > 0.25 or not all_recup or median(all_recup) / median(all_trav) < ECART_COTE):
        return None
    fc_reps = [r["fc"] for r in reps if r["fc"]]
    rec = [r["recup_sec"] for r in reps if r["recup_sec"] is not None]
    gaps = [r["gap_sec_km"] for r in reps if r["gap_sec_km"]]
    tiers = max(1, len(reps) // 3)
    resume = {
        "n": len(reps),
        "duree_sec": round(median(durees)),
        "distance_m": round(median(r["distance_m"] for r in reps)),
        "allure_sec_km": round(duree_tot / (dist_tot / 1000), 1) if dist_tot else None,
        "gap_sec_km": round(median(gaps), 1) if gaps and cotes else None,
        "meilleure_sec_km": min(allures),
        "regularite_pct": round(_cv(allures) * 100, 1),
        # > 0 : les dernières répétitions sont plus lentes que les premières
        "baisse_pct": round((sum(allures[-tiers:]) / tiers / (sum(allures[:tiers]) / tiers) - 1) * 100, 1),
        "recup_sec": round(median(rec)) if rec else None,
        "fc": round(sum(fc_reps) / len(fc_reps)) if fc_reps else None,
        "cotes": cotes,
        "pente_pct": round(median(r["pente_pct"] for r in reps), 1) if cotes else None,
        "travail_sec": duree_tot,
    }
    return {"reps": reps, "resume": resume}


def seance_depuis_trace(points: list, sport: str) -> Optional[dc.Seance]:
    """Tracé [[lat, lon, alt, secondes], …] → Seance (sans FC)."""
    pts = [p for p in points if len(p) >= 4 and isinstance(p[3], (int, float))]
    if len(pts) < 10:
        return None
    temps, dist, alt, cumul = [], [], [], 0.0
    for i, p in enumerate(pts):
        if i:
            cumul += cs._distance_m(pts[i - 1], p)
        temps.append(p[3])
        dist.append(cumul)
        alt.append(p[2])
    return dc.Seance(temps, dist, alt, sport=sport)


# ---------------------------------------------------------------------------
# Type de séance
# ---------------------------------------------------------------------------

def _plat(texte: Optional[str]) -> str:
    t = unicodedata.normalize("NFD", (texte or "").lower())
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


_MOTS = (
    ("test", r"\btest\b|\bcooper\b"),
    ("cotes", r"\bcotes?\b"),
    ("fractionne_court", r"\bvma\b|\bfractionne\b|\b30\s*/\s*30\b|\b\d+\s*[x×]\s*(?:[1-9]\d?\s*(?:''|\"|s\b|sec)|1\s*(?:'|min)|[1-4]00\s*m)"),
    ("fractionne_long", r"\b\d+\s*[x×]\s*(?:[2-7]\s*(?:'|min)|(?:[6-9]00|1[0-9]00|2000)\s*m)"),
    ("seuil", r"\bseuil\b|\btempo\b|\ballure (?:semi|10 ?km|marathon)\b|\b\d+\s*[x×]\s*(?:[89]|1\d|20)\s*(?:'|min)"),
    ("sortie_longue", r"\bsortie longue\b|\bsl\b|\blongue\b"),
    ("recuperation", r"\brecup\w*\b|\bdecrassage\b"),
    ("footing", r"\bfooting\b|\bef\b|\bendurance\b"),
)


def type_du_texte(*textes: Optional[str]) -> Optional[str]:
    """Type annoncé par un titre ou une description (plan, nom donné à la séance)."""
    for texte in textes:
        t = _plat(texte)
        if not t:
            continue
        for cle, motif in _MOTS:
            if re.search(motif, t):
                return cle
    return None


def _contexte(a: Activite, acts: list[Activite]) -> dict:
    """Habitudes des 8 semaines d'avant : durée, FC et allure médianes des sorties à pied."""
    debut = a.debut - timedelta(days=56)
    avant = [x for x in acts if x.sport in cs.SPORTS_PIED and debut <= x.debut < a.debut and x.id != a.id
             and x.duree_sec and x.duree_sec >= 15 * 60]
    med = lambda v: median(v) if len(v) >= 3 else None
    return {
        "n": len(avant),
        "duree": med([x.duree_sec for x in avant]),
        "fc": med([x.fc_moyenne_bpm for x in avant if x.fc_moyenne_bpm]),
        "allure": med([al for x in avant if (al := cs.allure_sec_km(x))]),
        # Mètres parcourus par battement : la même allure avec moins de battements = meilleure efficacité
        "efficacite": med([_efficacite(x) for x in avant if _efficacite(x) and _roulant(x)]),
    }


def _roulant(a: Activite) -> bool:
    return bool(a.distance_km) and (a.dplus_m or 0) / a.distance_km <= 15


def _efficacite(a: Activite) -> Optional[float]:
    d = cs.duree_mouvement(a)
    if not (d and a.distance_km and a.fc_moyenne_bpm and a.distance_km > 1):
        return None
    return a.distance_km * 1000 / (d / 60) / a.fc_moyenne_bpm


def classer(a: Activite, reps: Optional[dict], ctx: dict) -> Optional[str]:
    """Type d'une séance à pied. `reps` = résumé des répétitions détectées, s'il y en a."""
    if a.sport not in cs.SPORTS_PIED:
        return None
    det = cs._details_dict(a)
    titre = type_du_texte(a.titre)
    if a.est_competition:
        return "course"
    if titre == "test":
        return "test"
    # Un titre qui annonce une sortie facile l'emporte sur des variations d'allure prises pour des répétitions
    if reps and titre not in ("footing", "recuperation", "sortie_longue"):
        if reps.get("cotes"):
            return "cotes"
        d = reps.get("duree_sec") or 0
        return "fractionne_court" if d < 120 else "fractionne_long" if d < 8 * 60 else "seuil"
    if titre in ("cotes", "fractionne_court", "fractionne_long", "seuil"):
        return titre
    duree = cs.duree_mouvement(a) or 0
    zones = det.get("zones_fc") or []
    if len(zones) == 5:
        haut = sum((z.get("min_passees") or 0) for z in zones[3:])
        total = sum((z.get("min_passees") or 0) for z in zones)
        if haut >= 15 and total and haut / total >= 0.3:
            return "seuil"
    if titre in ("sortie_longue", "recuperation"):
        return titre
    if duree >= 90 * 60 or (duree >= 75 * 60 and ctx.get("duree") and duree >= 1.5 * ctx["duree"]):
        return "sortie_longue"
    fc_basse = a.fc_moyenne_bpm and ctx.get("fc") and a.fc_moyenne_bpm <= 0.93 * ctx["fc"]
    if 0 < duree <= 40 * 60 and (fc_basse or (a.rpe is not None and a.rpe <= 2)):
        return "recuperation"
    return "footing"


def type_seance(a: Activite) -> Optional[dict]:
    return cs.type_seance(cs._details_dict(a))


def maj_types_page(db: Session, user_id: int, items: list[Activite]) -> int:
    """Reconnaît le type des séances d'une page du carnet qui n'en ont pas encore."""
    manquants = [a for a in items if a.sport in cs.SPORTS_PIED
                 and (cs._details_dict(a).get("seance") or {}).get("v") != VERSION_SEANCE]
    if not manquants:
        return 0
    debut, fin = min(a.debut for a in manquants), max(a.debut for a in manquants)
    acts = (db.query(Activite).filter(Activite.utilisateur_id == user_id, Activite.sport.in_(list(cs.SPORTS_PIED)),
                                      Activite.debut >= debut - timedelta(days=57), Activite.debut <= fin).all())
    return maj_types(db, user_id, acts, limite=len(manquants), cibles={a.id for a in manquants})


def maj_types(db: Session, user_id: int, acts: list[Activite], limite: int = 150,
              cibles: Optional[set] = None) -> int:
    """Reconnaît (une fois par tracé) le type des séances à pied et leurs répétitions.
    Au plus `limite` séances par appel, les plus récentes d'abord. Retourne le nombre calculé.
    `cibles` restreint le calcul à ces séances ; les autres ne servent qu'à situer l'habitude."""
    pied = {a.id: a for a in acts if a.sport in cs.SPORTS_PIED and (cibles is None or a.id in cibles)}
    if not pied:
        return 0
    traces = dict(db.query(TraceGPS.activite_id, TraceGPS.id)
                  .filter(TraceGPS.utilisateur_id == user_id, TraceGPS.activite_id.in_(list(pied))).all())

    def a_jour(a: Activite) -> bool:
        s = cs._details_dict(a).get("seance") or {}
        return s.get("v") == VERSION_SEANCE and s.get("trace") == traces.get(a.id)

    a_faire = sorted((a for a in pied.values() if not a_jour(a)), key=lambda a: a.debut, reverse=True)[:limite]
    if not a_faire:
        return 0
    tids = [traces[a.id] for a in a_faire if a.id in traces]
    points = {}
    for i in range(0, len(tids), 50):
        for t in db.query(TraceGPS).filter(TraceGPS.id.in_(tids[i:i + 50])):
            try:
                points[t.activite_id] = json.loads(t.points)
            except ValueError:
                points[t.activite_id] = []
    tous = sorted(acts, key=lambda a: a.debut)
    for a in a_faire:
        reps = None
        if a.id in points:
            s = seance_depuis_trace(points[a.id], a.sport)
            trouve = detecter_intervalles(s) if s else None
            reps = trouve["resume"] if trouve else None
        cle = classer(a, reps, _contexte(a, tous))
        cs.fusionner_details(a, {"seance": {"v": VERSION_SEANCE, "trace": traces.get(a.id), "type": cle,
                                            **({"reps": reps} if reps else {})}}, ecraser=True)
    db.flush()
    return len(a_faire)


# ---------------------------------------------------------------------------
# Prévu contre réalisé
# ---------------------------------------------------------------------------

_ALLURE = re.compile(r"(\d{1,2})\s*[:'’′]\s*(\d{2})\s*(?:''|\"|”|″)?"
                     r"(?:\s*(?:-|–|—|à|a)\s*(\d{1,2})\s*[:'’′]\s*(\d{2})\s*(?:''|\"|”|″)?)?\s*/\s*km", re.I)
_FC_MAX = re.compile(r"fc\s*(?:<|≤|sous|max(?:imale)?|inferieure a|en dessous de|sous les)\s*(\d{2,3})")
_ZONE = re.compile(r"\bz(?:one)?\s*([1-5])\b")


def allures_visees(texte: Optional[str]) -> list[tuple[int, int]]:
    """Fourchettes d'allure (s/km) écrites dans une description : « 4'55-5'00/km », « 6:00/km »."""
    sortie = []
    for m in _ALLURE.finditer(texte or ""):
        a = int(m.group(1)) * 60 + int(m.group(2))
        b = int(m.group(3)) * 60 + int(m.group(4)) if m.group(3) else a
        if 150 <= a <= 900 and 150 <= b <= 900:
            sortie.append((min(a, b), max(a, b)))
    return sortie


def _note_ecart(ecart_pct: float, tolerance: float, pente: float) -> float:
    return max(0.0, 100 - max(0.0, abs(ecart_pct) - tolerance) * pente)


def _ligne(cle, label, prevu, realise, unite, tolerance=10.0, pente=2.5, poids=1.0, fmt=None):
    ecart = (realise - prevu) / prevu * 100 if prevu else 0.0
    f = fmt or (lambda v: f"{cs_nombre(v)} {unite}".strip())
    return {
        "cle": cle, "label": label, "prevu": f(prevu), "realise": f(realise),
        "ecart_pct": round(ecart), "etat": "ok" if abs(ecart) <= tolerance else "plus" if ecart > 0 else "moins",
        "note": round(_note_ecart(ecart, tolerance, pente)), "poids": poids,
    }


def cs_nombre(v) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".").replace(".", ",") if isinstance(v, float) else str(v)


def prevu_realise(a: Activite, p: SeancePrevue) -> dict:
    """Comparaison point par point d'une séance prévue et de sa réalisation, avec une note sur 100."""
    det = cs._details_dict(a)
    reps = (det.get("seance") or {}).get("reps")
    lignes = []
    duree = cs.duree_mouvement(a)
    if p.duree_min and duree:
        lignes.append(_ligne("duree", "Durée", p.duree_min, round(duree / 60), "min", poids=3,
                             fmt=lambda v: cs.fmt_duree(v * 60)))
    if p.distance_km and a.distance_km:
        lignes.append(_ligne("distance", "Distance", round(p.distance_km, 1), round(a.distance_km, 1), "km", poids=2))
    if p.dplus_m and a.dplus_m is not None:
        lignes.append(_ligne("dplus", "Dénivelé", p.dplus_m, a.dplus_m, "m", tolerance=20, pente=1.5))
    if p.rpe_cible and a.rpe is not None:
        e = a.rpe - p.rpe_cible
        lignes.append({"cle": "rpe", "label": "Effort ressenti", "prevu": f"{cs_nombre(float(p.rpe_cible))}/10",
                       "realise": f"{cs_nombre(float(a.rpe))}/10", "ecart_pct": None,
                       "etat": "ok" if abs(e) <= 1 else "plus" if e > 0 else "moins",
                       "note": round(max(0, 100 - max(0, abs(e) - 1) * 30)), "poids": 1.5})
    # Type annoncé par le plan contre type reconnu
    prevu_type, fait = type_du_texte(p.titre, p.description), type_seance(a)
    if prevu_type and fait:
        familles = {"footing": "facile", "recuperation": "facile", "sortie_longue": "long",
                    "fractionne_court": "intense", "fractionne_long": "intense", "seuil": "intense",
                    "cotes": "intense", "course": "course", "test": "test"}
        meme = prevu_type == fait["cle"]
        proche = familles[prevu_type] == familles[fait["cle"]]
        lignes.append({"cle": "type", "label": "Type de séance", "prevu": TYPES[prevu_type], "realise": fait["label"],
                       "ecart_pct": None, "etat": "ok" if meme or proche else "autre",
                       "note": 100 if meme else 80 if proche else 30, "poids": 2})
    # Allure visée : la plus rapide pour les répétitions, la plus lente pour une séance continue
    cibles = allures_visees(p.description) or allures_visees(p.titre)
    allure = cs.allure_sec_km(a)
    if cibles and a.sport in cs.SPORTS_PIED:
        if reps and reps.get("allure_sec_km") and not reps.get("cotes"):
            cible, reel, label = min(cibles), reps["allure_sec_km"], "Allure des répétitions"
        else:
            cible, reel, label = max(cibles), allure, "Allure"
        if reel:
            bas, haut = cible
            ecart = 0.0 if bas - 3 <= reel <= haut + 3 else (reel - (haut if reel > haut else bas)) / ((bas + haut) / 2) * 100
            visee = cs.fmt_allure(bas) if bas == haut else f"{cs.fmt_allure(bas)[:-3]}–{cs.fmt_allure(haut)}"
            lignes.append({"cle": "allure", "label": label, "prevu": visee, "realise": cs.fmt_allure(reel),
                           "ecart_pct": round(ecart, 1),
                           # écart > 0 = plus lent que prévu
                           "etat": "ok" if abs(ecart) <= 2 else "lent" if ecart > 0 else "rapide",
                           "note": round(_note_ecart(ecart, 2, 8)), "poids": 3})
    # FC plafond ou zone visée
    texte = _plat(f"{p.titre} {p.description or ''}")
    m = _FC_MAX.search(texte)
    if m and a.fc_moyenne_bpm:
        plafond = int(m.group(1))
        e = (a.fc_moyenne_bpm - plafond) / plafond * 100
        lignes.append({"cle": "fc", "label": "FC moyenne", "prevu": f"sous {plafond} bpm",
                       "realise": f"{a.fc_moyenne_bpm} bpm", "ecart_pct": round(e, 1) if e > 0 else 0,
                       "etat": "ok" if e <= 0 else "plus", "note": round(_note_ecart(max(0.0, e), 0, 12)), "poids": 2})
    else:
        zones = det.get("zones_fc") or []
        z = _ZONE.search(texte)
        total = sum((x.get("min_passees") or 0) for x in zones) if len(zones) == 5 else 0
        if z and total and familles_facile(prevu_type):
            cible_z = int(z.group(1))
            dedans = sum((x.get("min_passees") or 0) for x in zones[:cible_z]) / total * 100
            lignes.append({"cle": "zone", "label": f"Temps en zone {cible_z} ou moins", "prevu": "au moins 80 %",
                           "realise": f"{round(dedans)} %", "ecart_pct": None,
                           "etat": "ok" if dedans >= 80 else "plus",
                           "note": round(min(100.0, dedans / 80 * 100)), "poids": 2})
    poids = sum(l["poids"] for l in lignes)
    note = round(sum(l["note"] * l["poids"] for l in lignes) / poids) if poids else None
    return {
        "prevue": {"id": p.id, "titre": p.titre, "jour": p.jour.isoformat(), "description": p.description},
        "lignes": [{k: v for k, v in l.items() if k != "poids"} for l in lignes],
        "note": note,
        "verdict": None if note is None else "Conforme au plan" if note >= 85 else "Proche du plan" if note >= 65
        else "Différente du plan",
    }


def familles_facile(prevu_type: Optional[str]) -> bool:
    return prevu_type in (None, "footing", "recuperation", "sortie_longue")


# ---------------------------------------------------------------------------
# Bilan en trois phrases
# ---------------------------------------------------------------------------

def _duree_rep(sec: float) -> str:
    sec = int(round(sec))
    if sec < 60:
        return f"{sec} s"
    m, s = divmod(sec, 60)
    return f"{m} min {s:02d}" if s else f"{m} min"


def _chrono(sec: float) -> str:
    h, r = divmod(int(round(sec)), 3600)
    m, s = divmod(r, 60)
    return f"{h}h{m:02d}'{s:02d}" if h else f"{m}'{s:02d}"


def _phrase_fait(a: Activite, typ: Optional[dict], reps: Optional[dict]) -> str:
    duree = cs.fmt_duree(cs.duree_mouvement(a)) or "durée inconnue"
    allure = cs.fmt_allure(cs.allure_sec_km(a))
    dist = f"{cs_nombre(round(a.distance_km, 1))} km" if a.distance_km else None
    if a.sport not in cs.SPORTS_PIED:
        label = cs.SPORTS.get(a.sport, cs.SPORTS["autre"])["label"]
        bouts = [x for x in (dist, f"{a.dplus_m} m de dénivelé" if a.dplus_m else None,
                             f"FC moyenne {a.fc_moyenne_bpm}" if a.fc_moyenne_bpm else None) if x]
        return f"{label} de {duree}" + (f" : {', '.join(bouts)}." if bouts else ".")
    cle = typ["cle"] if typ else "footing"
    label = TYPES.get(cle, "Séance")
    if reps and cle in ("fractionne_court", "fractionne_long", "seuil", "cotes"):
        quoi = f"{reps['n']} × {_duree_rep(reps['duree_sec'])}"
        if reps.get("cotes"):
            quoi += f" en côte ({cs_nombre(float(reps['pente_pct']))} % de pente, {reps['distance_m']} m)"
            if reps.get("gap_sec_km"):
                quoi += f", soit {cs.fmt_allure(reps['gap_sec_km'])} ramené au plat"
        elif reps.get("allure_sec_km"):
            quoi += f" à {cs.fmt_allure(reps['allure_sec_km'])}"
        if reps.get("recup_sec"):
            quoi += f", récupération {_duree_rep(reps['recup_sec'])}"
        return f"{label} : {quoi}, dans une sortie de {duree}" + (f" et {dist}." if dist else ".")
    bouts = [x for x in (dist, f"à {allure}" if allure else None) if x]
    phrase = f"{label} de {duree}" + (f", {' '.join(bouts)}" if bouts else "")
    if a.dplus_m and a.distance_km and a.dplus_m / a.distance_km >= 15:
        phrase += f", {a.dplus_m} m de dénivelé"
    if a.fc_moyenne_bpm:
        phrase += f", FC moyenne {a.fc_moyenne_bpm}"
    return phrase + "."


def _phrase_plan(pr: dict) -> str:
    ecarts = []
    for l in pr["lignes"]:
        if l["etat"] == "ok":
            continue
        if l["cle"] in ("duree", "distance", "dplus"):
            ecarts.append(f"{l['label'].lower()} {l['realise']} au lieu de {l['prevu']}")
        elif l["cle"] == "allure":
            ecarts.append(f"allure {l['realise']} plus {'lente' if l['etat'] == 'lent' else 'rapide'} que la cible {l['prevu']}")
        elif l["cle"] == "type":
            ecarts.append(f"{l['realise'].lower()} au lieu de {l['prevu'].lower()}")
        elif l["cle"] == "rpe":
            ecarts.append(f"effort ressenti {l['realise']} pour {l['prevu']} visé")
        elif l["cle"] == "fc":
            ecarts.append(f"FC moyenne {l['realise']} pour un plafond {l['prevu'][5:]}")
        elif l["cle"] == "zone":
            ecarts.append(f"seulement {l['realise']} du temps dans la zone visée")
    titre = pr["prevue"]["titre"]
    if not pr["lignes"]:
        return f"Elle correspond à « {titre} » du plan, sans cible chiffrée à comparer."
    if not ecarts:
        return f"Conforme à « {titre} » du plan ({pr['note']}/100) : tout est dans la cible."
    return f"{pr['verdict']} « {titre} » ({pr['note']}/100) : {', '.join(ecarts[:2])}."


def _phrase_habitude(a: Activite, typ: Optional[dict], ctx: dict) -> Optional[str]:
    if a.sport not in cs.SPORTS_PIED or ctx.get("n", 0) < 3 or (typ or {}).get("cle") in ("course", "test"):
        return None
    duree, bouts = cs.duree_mouvement(a), []
    if duree and ctx.get("duree"):
        e = (duree - ctx["duree"]) / ctx["duree"] * 100
        bouts.append(f"{abs(round(e))} % plus {'longue' if e > 0 else 'courte'}" if abs(e) >= 15 else "d'une durée habituelle")
    allure = cs.allure_sec_km(a)
    if allure and ctx.get("allure") and _roulant(a) and (typ or {}).get("cle") in ("footing", "sortie_longue", "recuperation"):
        e = allure - ctx["allure"]
        bouts.append(f"{abs(round(e))} s/km plus {'lente' if e > 0 else 'rapide'}" if abs(e) >= 8 else "à ton allure habituelle")
    if not bouts:
        return None
    return f"Aucune séance du plan à lui comparer ; par rapport à tes sorties des 8 dernières semaines, elle est {' et '.join(bouts)}."


def _faits_notables(db: Session, a: Activite, typ: Optional[dict], reps: Optional[dict], ctx: dict) -> list[str]:
    """Faits marquants, du plus au moins important."""
    det, faits = cs._details_dict(a), []
    eff = det.get("efforts") or {}
    if a.sport in cs.SPORTS_PIED and eff:
        annee = (db.query(Activite).filter(Activite.utilisateur_id == a.utilisateur_id,
                                           Activite.debut >= a.debut.replace(month=1, day=1, hour=0, minute=0, second=0),
                                           Activite.debut < a.debut, Activite.sport.in_(list(cs.SPORTS_PIED))).all())
        for label in ("10 km", "5 km", "1 km"):
            t = eff.get(label)
            autres = [x for x in ((cs._details_dict(o).get("efforts") or {}).get(label) for o in annee) if x]
            if t and len(autres) >= 3 and t < min(autres):
                faits.append(f"Meilleur {label} de l'année : {_chrono(t)}, soit {round(min(autres) - t)} s de mieux.")
                break
    if reps:
        if reps["regularite_pct"] <= 3 and abs(reps["baisse_pct"]) <= 3:
            faits.append(f"Répétitions très régulières : {cs_nombre(float(reps['regularite_pct']))} % d'écart d'allure de l'une à l'autre.")
        elif reps["baisse_pct"] >= 5:
            faits.append(f"Les dernières répétitions sont {cs_nombre(float(reps['baisse_pct']))} % plus lentes que les premières : "
                         "départ un peu rapide ou récupération trop courte.")
        elif reps["baisse_pct"] <= -4:
            faits.append(f"Tu as fini plus vite que tu n'as commencé ({cs_nombre(float(-reps['baisse_pct']))} % de mieux sur les dernières répétitions).")
    derive = det.get("derive_fc")
    if isinstance(derive, (int, float)) and not reps:
        if derive > 5:
            faits.append(f"Le cœur a dérivé de {cs_nombre(round(float(derive), 1))} % à allure égale : au-delà de 5 %, "
                         "l'endurance de base, la chaleur ou l'hydratation sont en cause.")
        elif 0 <= derive <= 3 and (cs.duree_mouvement(a) or 0) >= 60 * 60:
            faits.append(f"Cœur très stable sur la durée : {cs_nombre(round(float(derive), 1))} % de dérive seulement.")
    ef = _efficacite(a)
    if ef and ctx.get("efficacite") and _roulant(a) and (typ or {}).get("cle") in ("footing", "sortie_longue", "recuperation"):
        e = (ef / ctx["efficacite"] - 1) * 100
        if e <= -5:
            faits.append(f"FC plus haute que d'habitude à cette allure (efficacité {round(e)} %) : fatigue, chaleur ou terrain.")
        elif e >= 5:
            faits.append(f"FC plus basse que d'habitude à cette allure (efficacité +{round(e)} %) : bon signe de forme.")
    temp = (det.get("meteo") or {}).get("temperature") if isinstance(det.get("meteo"), dict) else None
    if isinstance(temp, (int, float)) and temp >= 25:
        faits.append(f"Séance par {round(temp)} °C : la chaleur coûte quelques secondes au kilomètre et fait monter le cœur.")
    dur = det.get("durabilite_pct")
    if isinstance(dur, (int, float)) and dur <= -8 and not reps:
        faits.append(f"L'allure a baissé de {cs_nombre(round(abs(float(dur)), 1))} % en fin de séance à FC égale.")
    zones = det.get("zones_fc") or []
    if len(zones) == 5:
        total = sum((z.get("min_passees") or 0) for z in zones)
        if total:
            bas = sum((z.get("min_passees") or 0) for z in zones[:2]) / total * 100
            haut = sum((z.get("min_passees") or 0) for z in zones[3:]) / total * 100
            cle = (typ or {}).get("cle")
            if haut >= 20:
                faits.append(f"{round(haut)} % du temps en zones 4 et 5" + ("." if cle in ("course", "test") else
                                                                         " : une vraie séance d'intensité."))
            elif cle in ("course", "test", "seuil", "fractionne_court", "fractionne_long", "cotes"):
                parts = [(z.get("min_passees") or 0) / total * 100 for z in zones]
                k = max(range(5), key=lambda i: parts[i])
                faits.append(f"La zone {k + 1} domine : {round(parts[k])} % du temps.")
            else:
                faits.append(f"{round(bas)} % du temps en zones 1 et 2" + (" : c'est bien une séance facile." if bas >= 80 else
                                                                         ", le reste plus haut : un peu soutenu pour de l'endurance."
                                                                         if (typ or {}).get("cle") in ("footing", "recuperation", "sortie_longue") else "."))
    return faits


def bilan(db: Session, user: Utilisateur, a: Activite) -> dict:
    """Bilan automatique d'une séance : type, trois phrases, répétitions, prévu contre réalisé."""
    acts = (db.query(Activite).filter(Activite.utilisateur_id == user.id, Activite.sport.in_(list(cs.SPORTS_PIED)),
                                      Activite.debut >= a.debut - timedelta(days=57), Activite.debut <= a.debut).all())
    if a.sport in cs.SPORTS_PIED:
        maj_types(db, user.id, [a] + [x for x in acts if x.id != a.id], cibles={a.id})
    det = cs._details_dict(a)
    typ = type_seance(a)
    reps = (det.get("seance") or {}).get("reps")
    if typ and typ["cle"] in ("footing", "recuperation", "sortie_longue"):  # sortie facile : pas de répétitions
        reps = None
    ctx = _contexte(a, acts)
    prevue = (db.query(SeancePrevue).filter(SeancePrevue.utilisateur_id == user.id, SeancePrevue.activite_id == a.id)
              .order_by(SeancePrevue.id).first())
    pr = prevu_realise(a, prevue) if prevue else None
    phrases = [_phrase_fait(a, typ, reps)]
    deux = _phrase_plan(pr) if pr else _phrase_habitude(a, typ, ctx)
    if deux:
        phrases.append(deux)
    phrases += _faits_notables(db, a, typ, reps, ctx)[:3 - len(phrases)]
    return {
        "type": typ,
        "types": [{"cle": k, "label": v} for k, v in TYPES.items()] if a.sport in cs.SPORTS_PIED else [],
        "phrases": phrases,
        "repetitions": reps,
        "prevu": pr,
    }
