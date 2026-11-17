"""
Respect du plan, étape par étape, pour les séances d'intensité (fartlek, fractionné, seuil, côtes).

Quand une séance réalisée est reliée à une séance du plan dont le contenu est minuté
(« 20' d'échauffement, 6 × 1' · 1'30 de trot entre chaque, 10' de retour au calme »), on retrouve
dans l'enregistrement chacune des étapes prévues et on compare, pour chacune, ce qui était prévu
et ce qui a été fait : durée, distance, allure, fréquence cardiaque.

Trois façons de retrouver les étapes, de la plus sûre à la moins sûre :
- « tours » : la montre a suivi la séance, un tour par étape ;
- « allure » : les efforts sont repérés à l'allure (passages nettement plus rapides que le reste),
  puis rapprochés des efforts prévus dans l'ordre ;
- « theorique » : rien ne ressort, l'enregistrement est découpé aux durées prévues.

Les sorties faciles (endurance, récupération, sortie longue) ne sont pas analysées ainsi.
Formulations neutres : des constats, jamais de conseil.
"""
from __future__ import annotations

import hashlib
import json
import re
from bisect import bisect_left
from statistics import median
from types import SimpleNamespace
from typing import Optional

import blocs_service as bl
import carnet_service as cs
import decoupage as dc
import seance_service as ss

VERSION = 2
TYPES_INTENSES = ss.TYPES_INTENSES
TYPES_FACILES = ("footing", "recuperation", "sortie_longue")

ECART_MIN = 1.10          # les efforts doivent être au moins 10 % plus rapides que le reste
PAUSE_FLUX_S = 15         # flux à la seconde : au-delà, la montre était en pause
PAUSE_TRACE_S = 300       # tracé GPS (un point tous les 10 m) : un arrêt sur place reste compté
MARGE_ALLURE = 3          # s/km de tolérance autour de l'allure visée
MARGE_FC = 2              # battements de tolérance autour de la FC visée
POIDS = {"effort": 3.0, "recup": 1.5, "echauffement": 1.0, "retour": 1.0}
LIBELLES = {"echauffement": "Échauffement", "effort": "Effort", "recup": "Récupération", "retour": "Retour au calme"}

_FACILE = re.compile(r"\b(?:footing|trot\w*|facile|tranquille|ef|endurance|marche\w*|recup\w*|souple|lent\w*|decrassage)\b")


# ---------------------------------------------------------------------------
# Ce qui était prévu
# ---------------------------------------------------------------------------

def etapes_plan(p) -> list[dict]:
    """Étapes minutées de la séance prévue : blocs de l'éditeur, sinon lecture de la description."""
    structure = bl.lire_structure(getattr(p, "structure", None))
    if structure and structure.get("type") == "endurance":
        return structure.get("etapes") or []
    return bl.etapes_depuis_description(getattr(p, "description", None) or "")


def _allure_s(texte: Optional[str]) -> Optional[int]:
    m = re.match(r"^(\d{1,2}):(\d{2})$", texte or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def _cibles(e: dict) -> dict:
    allures = sorted(x for x in (_allure_s(e.get("allure_min")), _allure_s(e.get("allure_max"))) if x)
    return {"allure": [allures[0], allures[-1]] if allures else None,
            "fc_min": e.get("fc_min"), "fc_max": e.get("fc_max"), "zone": e.get("zone"), "rpe": e.get("rpe")}


def derouler(etapes: list[dict], recup_finale: bool = False) -> list[dict]:
    """Séance prévue mise à plat : une ligne par étape à faire, dans l'ordre.
    `recup_finale` : la récupération suit aussi le dernier effort (ce que fait une montre guidée)."""
    seq: list[dict] = []
    for k, e in enumerate(etapes):
        duree, dist = e.get("duree_s") or None, e.get("distance_m") or None
        n = int(e.get("repetitions") or 1)
        genre, texte = e.get("genre"), (e.get("texte") or "").strip()
        cibles = _cibles(e)
        if not duree and not dist:
            if e.get("libre") and genre == "retour" and k == len(etapes) - 1 and seq:
                # retour au calme « jusqu’à la fin » : tout ce qui suit le dernier effort
                seq.append({"role": "retour", "groupe": k, "rep": 1, "sur": 1, "libelle": texte,
                            "duree_s": None, "distance_m": None, "libre": True, **cibles})
            continue
        if n > 1:
            recup = e.get("recup_s") or e.get("recup_m")
            for i in range(n):
                seq.append({"role": "effort", "groupe": k, "rep": i + 1, "sur": n, "libelle": texte,
                            "duree_s": duree, "distance_m": dist, **cibles})
                if recup and (i < n - 1 or recup_finale):
                    seq.append({"role": "recup", "groupe": k, "rep": i + 1, "sur": n,
                                "libelle": (e.get("recup_texte") or "").strip(),
                                "duree_s": e.get("recup_s") or None, "distance_m": e.get("recup_m") or None,
                                **_cibles({})})
            continue
        if genre in ("echauffement", "retour", "recup"):
            role = genre
        else:  # corps de séance : un effort, sauf s'il est décrit comme un passage facile sans allure visée
            role = "recup" if not cibles["allure"] and _FACILE.search(ss._plat(texte)) else "effort"
        seq.append({"role": role, "groupe": k, "rep": 1, "sur": 1, "libelle": texte,
                    "duree_s": duree, "distance_m": dist, **cibles})
    return seq


def concerne(p, seq: list[dict]) -> bool:
    """Vrai pour une séance à pied avec de l'intensité minutée ; jamais pour une sortie facile."""
    if getattr(p, "sport", None) not in cs.SPORTS_PIED:
        return False
    efforts = [e for e in seq if e["role"] == "effort"]
    if not efforts:
        return False
    t = ss.type_du_texte(p.titre, p.description)
    if t in TYPES_INTENSES:
        return True
    if t in TYPES_FACILES:
        return False
    return any(e["sur"] > 1 for e in efforts)


def empreinte(p) -> str:
    brut = "\x1f".join(str(x or "") for x in (p.titre, p.description, getattr(p, "structure", None)))
    return hashlib.sha1(brut.encode("utf-8")).hexdigest()[:12]


# ---------------------------------------------------------------------------
# Ce qui a été fait : repères dans l'enregistrement
# ---------------------------------------------------------------------------

def _vitesses(s: dc.Seance, demi_s: float = 5.0) -> list:
    """Vitesse en chaque point (m/s), lissée sur ±5 s. Ramenée au plat en trail seulement : sur route,
    le bruit de la mesure de pente ferait passer un faux plat pour un effort."""
    plat = s.gap and s.sport == "trail"
    n, a, b, sortie = s.n, 0, 0, []
    for i in range(n):
        while s.temps[i] - s.temps[a] > demi_s:
            a += 1
        while b < n - 1 and s.temps[b + 1] - s.temps[i] <= demi_s:
            b += 1
        dt = s.temps[b] - s.temps[a]
        v = (s.dist[b] - s.dist[a]) / dt if 0 < dt <= 4 * demi_s else 0.0
        sortie.append(v * dc.facteur_pente(s.pente[i]) if plat else v)
    return sortie


class _Flux:
    """Enregistrement prêt à être découpé : vitesse lissée et chrono de la montre (pauses retirées)."""

    def __init__(self, s: dc.Seance):
        self.s, self.n = s, s.n
        self.vit = _vitesses(s)
        ecarts = [s.temps[i] - s.temps[i - 1] for i in range(1, s.n)]
        tri = sorted(ecarts)
        pause = PAUSE_FLUX_S if tri and tri[len(tri) // 2] <= 3 else PAUSE_TRACE_S
        self.pas = [0.0] + [dt if 0 < dt <= pause else 0.0 for dt in ecarts]
        self.chrono = [0.0] * s.n
        for i in range(1, s.n):
            self.chrono[i] = self.chrono[i - 1] + self.pas[i]

    def duree(self, a: int, b: int) -> float:
        return self.chrono[b] - self.chrono[a]

    def distance(self, a: int, b: int) -> float:
        return self.s.dist[b] - self.s.dist[a]

    def i_chrono(self, t: float) -> int:
        return min(self.n - 1, bisect_left(self.chrono, t))

    def apres(self, a: int, e: dict) -> int:
        """Point atteint en partant de `a` une fois la durée (ou la distance) prévue écoulée."""
        if e.get("duree_s"):
            return self.i_chrono(self.chrono[a] + e["duree_s"])
        return min(self.n - 1, bisect_left(self.s.dist, self.s.dist[a] + e["distance_m"]))


def _prevu_s(e: dict, vitesse: float) -> float:
    """Durée prévue d'une étape ; pour une distance, estimée à la vitesse donnée."""
    return float(e["duree_s"]) if e.get("duree_s") else e["distance_m"] / max(vitesse, 0.5)


def _tours(f: _Flux, intervalles: Optional[list]) -> list[tuple[int, int]]:
    tours = []
    for iv in intervalles or []:
        a, b = iv.get("start_index"), iv.get("end_index")
        if not isinstance(a, int) or not isinstance(b, int):
            continue
        a, b = max(0, a), min(f.n - 1, b)
        if b > a and f.duree(a, b) >= 5:
            tours.append((a, b))
    return sorted(tours)


def _par_tours(f: _Flux, seq: list[dict], tours: list[tuple[int, int]]) -> Optional[list]:
    """Un tour de montre par étape, si les tours suivent bien la séance prévue."""
    efforts = [i for i, e in enumerate(seq) if e["role"] == "effort"]
    if not efforts or not efforts[-1] + 1 <= len(tours) <= len(seq) + 1:
        return None
    justes = 0
    for i in efforts:
        e, (a, b) = seq[i], tours[i]
        if e.get("duree_s"):
            justes += abs(f.duree(a, b) - e["duree_s"]) <= max(10, 0.2 * e["duree_s"])
        else:
            justes += abs(f.distance(a, b) - e["distance_m"]) <= max(30, 0.1 * e["distance_m"])
    if justes < 0.7 * len(efforts):
        return None
    plages: list = list(tours[:len(seq)]) + [None] * max(0, len(seq) - len(tours))
    if len(tours) == len(seq) + 1:  # tour libre après la dernière étape : il prolonge celle-ci
        plages[-1] = (plages[-1][0], tours[-1][1])
    return plages


def _seuil(f: _Flux, seq: list[dict]) -> Optional[tuple[float, float, float]]:
    """(vitesse du reste, vitesse des efforts, seuil entre les deux), cherchés au cœur de la séance."""
    premier = next(i for i, e in enumerate(seq) if e["role"] == "effort")
    dernier = max(i for i, e in enumerate(seq) if e["role"] == "effort")
    avant = sum(e["duree_s"] or 0 for e in seq[:premier])
    apres = sum(e["duree_s"] or 0 for e in seq[dernier + 1:])
    a, b = f.i_chrono(0.5 * avant), f.i_chrono(f.chrono[-1] - 0.5 * apres)
    if f.duree(a, b) < 120:
        a, b = 0, f.n - 1
    vals = [f.vit[i] for i in range(a + 1, b + 1) if f.pas[i] > 0]
    poids = [f.pas[i] for i in range(a + 1, b + 1) if f.pas[i] > 0]
    groupes = ss._deux_groupes(vals, poids)
    if not groupes:
        return None
    lent, rapide = groupes[0], groupes[1]
    if lent <= 0 or rapide / lent < ECART_MIN:
        return None
    return lent, rapide, (lent + rapide) / 2


def _blocs_rapides(f: _Flux, seuil: float, trou_s: float, mini_s: float) -> list[tuple[int, int]]:
    """Passages au-dessus du seuil ; un ralentissement plus court que `trou_s` ne les coupe pas."""
    blocs, debut, fin = [], None, None
    for i in range(1, f.n):
        if f.pas[i] > 0 and f.vit[i] >= seuil:
            if debut is None:
                debut = i - 1
            elif f.s.temps[i] - f.s.temps[fin] > trou_s:
                blocs.append((debut, fin))
                debut = i - 1
            fin = i
    if debut is not None:
        blocs.append((debut, fin))
    return [(a, b) for a, b in blocs if f.duree(a, b) >= mini_s]


def _apparier(f: _Flux, efforts: list[dict], blocs: list[tuple[int, int]], repere_s: float) -> list[Optional[int]]:
    """Rapproche dans l'ordre les efforts prévus des passages rapides trouvés (alignement de séquences) :
    un passage en trop est ignoré, un effort introuvable est laissé sans passage."""
    n, m = len(efforts), len(blocs)

    def ecart(e: dict, bloc: tuple[int, int]) -> float:
        a, b = bloc
        if e.get("duree_s"):
            return abs(f.duree(a, b) - e["duree_s"]) / e["duree_s"]
        return abs(f.distance(a, b) - e["distance_m"]) / e["distance_m"]

    saut = [1.5 + 0.5 * min(1.0, f.duree(a, b) / repere_s) for a, b in blocs]
    inf = float("inf")
    cout = [[inf] * (m + 1) for _ in range(n + 1)]
    choix = [[0] * (m + 1) for _ in range(n + 1)]
    cout[0][0] = 0.0
    for i in range(n + 1):
        for j in range(m + 1):
            if i and j:
                c = cout[i - 1][j - 1] + 0.9 * min(1.0, ecart(efforts[i - 1], blocs[j - 1]))
                if c < cout[i][j]:
                    cout[i][j], choix[i][j] = c, 1
            if i and cout[i - 1][j] + 1.0 < cout[i][j]:
                cout[i][j], choix[i][j] = cout[i - 1][j] + 1.0, 2
            if j and cout[i][j - 1] + saut[j - 1] < cout[i][j]:
                cout[i][j], choix[i][j] = cout[i][j - 1] + saut[j - 1], 3
    liens: list[Optional[int]] = [None] * n
    i, j = n, m
    while i or j:
        c = choix[i][j]
        if c == 1:
            liens[i - 1] = j - 1
            i, j = i - 1, j - 1
        elif c == 2:
            i -= 1
        else:
            j -= 1
    return liens


def _repartir(f: _Flux, etapes: list[dict], a: int, b: int) -> list:
    """Partage [a, b] entre des étapes qui se suivent : chacune prend sa durée prévue, la dernière
    prend ce qui reste ; une étape pour laquelle il ne reste rien est absente (None)."""
    plages, curseur = [], a
    for k, e in enumerate(etapes):
        if curseur >= b:
            plages.append(None)
            continue
        fin = b if k == len(etapes) - 1 else min(b, f.apres(curseur, e))
        plages.append((curseur, fin) if fin > curseur else None)
        curseur = max(curseur, fin)
    return plages


def _par_allure(f: _Flux, seq: list[dict]) -> Optional[list]:
    """Efforts repérés à l'allure, puis tout le reste placé autour d'eux."""
    seuils = _seuil(f, seq)
    if not seuils:
        return None
    lent, rapide, seuil = seuils
    pos = [i for i, e in enumerate(seq) if e["role"] == "effort"]
    efforts = [seq[i] for i in pos]
    durees = [_prevu_s(e, rapide) for e in efforts]
    recups = [e["duree_s"] for e in seq if e["role"] == "recup" and e.get("duree_s")]
    court = min(durees)
    trou = min(20.0, max(8.0, 0.25 * court))
    if recups:
        trou = max(4.0, min(trou, 0.25 * min(recups)))
    blocs = _blocs_rapides(f, seuil, trou, max(8.0, 0.2 * court))
    if not blocs:
        return None
    # Plus de passages rapides que prévu : on garde les plus marqués (temps passé × vitesse en plus),
    # et jamais un passage sans commune mesure avec les autres (une relance, un faux plat)
    poids = [sum((f.vit[i] - lent) * f.pas[i] for i in range(a + 1, b + 1)) for a, b in blocs]
    gardes = sorted(range(len(blocs)), key=lambda i: -poids[i])[:len(efforts)]
    plancher = 0.2 * median(poids[i] for i in gardes)
    blocs = [blocs[i] for i in sorted(gardes) if poids[i] >= plancher]
    liens = _apparier(f, efforts, blocs, median(durees))
    if sum(1 for x in liens if x is not None) < max(1, (len(efforts) + 1) // 2):
        return None
    plages: list = [None] * len(seq)
    for i, lien in zip(pos, liens):
        if lien is not None:
            plages[i] = blocs[lien]
    # Les étapes entre deux efforts se partagent l'intervalle qui les sépare
    curseur, i = 0, 0
    while i < len(seq):
        if seq[i]["role"] == "effort":
            if plages[i]:
                curseur = plages[i][1]
            i += 1
            continue
        j = i
        while j < len(seq) and seq[j]["role"] != "effort":
            j += 1
        suivant = next((plages[k][0] for k in range(j, len(seq)) if plages[k]), None)
        orphelin = i > 0 and plages[i - 1] is None and suivant is not None  # suit un effort introuvable
        if not orphelin:
            fin = suivant if suivant is not None else f.n - 1
            plages[i:j] = _repartir(f, seq[i:j], curseur, fin)
            curseur = max(curseur, fin)
        i = j
    return plages


def _theorique(f: _Flux, seq: list[dict]) -> list:
    return _repartir(f, seq, 0, f.n - 1)


# ---------------------------------------------------------------------------
# Comparaison étape par étape
# ---------------------------------------------------------------------------

def _mesure(f: _Flux, a: int, b: int) -> dict:
    s = f.s
    duree, dist = f.duree(a, b), f.distance(a, b)
    bilan = s.bilan(a, b)
    fc_s = fc_t = 0.0
    fc_haut = None
    if s.fc:
        for i in range(a + 1, b + 1):
            x = s.fc[i]
            if dc._num(x):
                if f.pas[i] > 0:
                    fc_s += x * f.pas[i]
                    fc_t += f.pas[i]
                fc_haut = x if fc_haut is None else max(fc_haut, x)
    return {
        "debut_sec": round(s.temps[a] - s.temps[0]), "fin_sec": round(s.temps[b] - s.temps[0]),
        "debut_km": round(s.dist[a] / 1000, 3), "fin_km": round(s.dist[b] / 1000, 3),
        "duree_sec": round(duree), "distance_m": round(dist),
        "allure_sec_km": round(duree / dist * 1000, 1) if dist >= 20 and duree > 0 else None,
        "gap_sec_km": bilan.get("gap_sec_km") if bilan else None,
        "fc": round(fc_s / fc_t) if fc_t else None,
        "fc_max": round(fc_haut) if fc_haut is not None else None,
    }


def _tolerance(role: str, prevu: float, mode: str, distance: bool) -> float:
    if distance:
        return max(20.0, 0.08 * prevu)
    if role == "effort":
        return max(3.0, 0.05 * prevu) if mode == "tours" else max(8.0, 0.10 * prevu)
    if role == "recup":
        return max(5.0, 0.08 * prevu) if mode == "tours" else max(10.0, 0.15 * prevu)
    return max(60.0, 0.10 * prevu)


def _comparer(e: dict, fait: Optional[dict], mode: str, sport: str) -> dict:
    prevu = {"duree_sec": e.get("duree_s"), "distance_m": e.get("distance_m"), "libre": bool(e.get("libre")),
             "allure": e.get("allure"),
             "fc_min": e.get("fc_min"), "fc_max": e.get("fc_max"), "zone": e.get("zone"), "rpe": e.get("rpe")}
    ligne = {"role": e["role"], "libelle": e.get("libelle") or "", "rep": e["rep"], "sur": e["sur"], "groupe": e["groupe"],
             "prevu": prevu, "fait": fait, "etat": "absent", "ecart_sec": None, "ecart_m": None,
             "etat_allure": None, "ecart_allure": None, "etat_fc": None, "note": 0}
    if not fait:
        return ligne
    notes = []
    if e.get("libre"):  # sans durée fixée : ce qui a été fait convient
        ligne["etat"] = "ok"
        notes.append(100.0)
    else:
        if e.get("duree_s"):
            ecart, base = fait["duree_sec"] - e["duree_s"], float(e["duree_s"])
            ligne["ecart_sec"] = ecart
        else:
            ecart, base = fait["distance_m"] - e["distance_m"], float(e["distance_m"])
            ligne["ecart_m"] = ecart
        tol = _tolerance(e["role"], base, mode, not e.get("duree_s"))
        ligne["etat"] = "ok" if abs(ecart) <= tol else "plus" if ecart > 0 else "moins"
        notes.append(max(0.0, 100 - max(0.0, abs(ecart) - tol) / base * 150))
    allure = (fait.get("gap_sec_km") if sport == "trail" else None) or fait.get("allure_sec_km")
    if e.get("allure") and allure:
        rapide, lent = e["allure"]
        hors = rapide - allure if allure < rapide else allure - lent if allure > lent else 0.0
        ligne["ecart_allure"] = round(-hors if allure < rapide else hors)
        ligne["etat_allure"] = "ok" if hors <= MARGE_ALLURE else "rapide" if allure < rapide else "lent"
        notes.append(max(0.0, 100 - max(0.0, hors - MARGE_ALLURE) * 4))
    fc = fait.get("fc")
    if fc and (e.get("fc_max") or e.get("fc_min")):
        court = e["role"] == "effort" and fait["duree_sec"] < 120  # le cœur n'a pas le temps de monter
        if e.get("fc_max") and fc > e["fc_max"] + MARGE_FC:
            ligne["etat_fc"] = "haut"
            notes.append(max(0.0, 100 - (fc - e["fc_max"] - MARGE_FC) * 5))
        elif e.get("fc_min") and fc < e["fc_min"] - MARGE_FC and not court:
            ligne["etat_fc"] = "bas"
            notes.append(max(0.0, 100 - (e["fc_min"] - MARGE_FC - fc) * 5))
        else:
            ligne["etat_fc"] = "ok"
            notes.append(100.0)
    ligne["note"] = round(sum(notes) / len(notes))
    return ligne


# ---------------------------------------------------------------------------
# Résumé et phrases
# ---------------------------------------------------------------------------

def _duree(sec: float) -> str:
    sec = int(round(sec))
    if sec >= 3600:
        h, reste = divmod(sec, 3600)
        return f"{h} h {reste // 60:02d}"
    if sec < 60:
        return f"{sec} s"
    m, s = divmod(sec, 60)
    return f"{m} min {s:02d}" if s else f"{m} min"


def _signe(x: float, unite: str) -> str:
    x = int(round(x))
    return ("+" if x > 0 else "−") + (_duree(abs(x)) if unite == "s" else f"{abs(x)} m")


def _mesure_prevue(prevu: dict) -> str:
    if prevu.get("duree_sec"):
        return _duree(prevu["duree_sec"])
    return f"{prevu['distance_m']} m" if prevu.get("distance_m") else "jusqu’à la fin"


def _cv(valeurs: list[float]) -> float:
    moy = sum(valeurs) / len(valeurs)
    return (sum((x - moy) ** 2 for x in valeurs) / len(valeurs)) ** 0.5 / moy if moy else 0.0


def _nombre(x: float) -> str:
    return f"{x:.1f}".replace(".", ",")


def _allure_efforts(faits: list[dict], sport: str) -> Optional[float]:
    """Allure d'ensemble des efforts (temps total / distance totale ; ramenée au plat en trail)."""
    if sport == "trail" and faits and all(x.get("gap_sec_km") for x in faits):
        dist = sum(x["distance_m"] for x in faits)
        return round(sum(x["gap_sec_km"] * x["distance_m"] for x in faits) / dist, 1) if dist else None
    dist = sum(x["distance_m"] for x in faits)
    return round(sum(x["duree_sec"] for x in faits) / dist * 1000, 1) if dist >= 20 else None


def _plage(allure) -> str:
    rapide, lent = allure
    if rapide == lent:
        return cs.fmt_allure(rapide)
    return f"{cs.fmt_allure(rapide).replace('/km', '')}–{cs.fmt_allure(lent)}"


def _resume(lignes: list[dict], mode: str, sport: str) -> tuple[dict, list[str]]:
    efforts = [x for x in lignes if x["role"] == "effort"]
    faits = [x for x in efforts if x["fait"]]
    recups = [x for x in lignes if x["role"] == "recup" and x["fait"]]
    vises = [x for x in faits if x["etat_allure"]]
    allures = [x["fait"]["allure_sec_km"] for x in faits if x["fait"]["allure_sec_km"]]
    fcs = [x["fait"]["fc"] for x in faits if x["fait"]["fc"]]
    ecarts_r = [x["ecart_sec"] for x in recups if x["ecart_sec"] is not None]
    tiers = max(1, len(allures) // 3)
    poids = sum(POIDS[x["role"]] for x in lignes)
    resume = {
        "efforts_prevus": len(efforts), "efforts_faits": len(faits),
        "efforts_mesure_ok": sum(1 for x in faits if x["etat"] == "ok"),
        "efforts_vises": len(vises),
        "efforts_allure_ok": sum(1 for x in vises if x["etat_allure"] == "ok"),
        "efforts_rapides": sum(1 for x in vises if x["etat_allure"] == "rapide"),
        "efforts_lents": sum(1 for x in vises if x["etat_allure"] == "lent"),
        "effort_allure_sec_km": _allure_efforts([x["fait"] for x in faits], sport),
        "effort_duree_sec": round(median(x["fait"]["duree_sec"] for x in faits)) if faits else None,
        "effort_fc": round(sum(fcs) / len(fcs)) if fcs else None,
        "regularite_pct": round(_cv(allures) * 100, 1) if len(allures) >= 3 else None,
        # > 0 : les derniers efforts sont plus lents que les premiers
        "baisse_pct": round((sum(allures[-tiers:]) / sum(allures[:tiers]) - 1) * 100, 1) if len(allures) >= 3 else None,
        "recups_faites": len(recups),
        "recup_duree_sec": round(sum(x["fait"]["duree_sec"] for x in recups) / len(recups)) if recups else None,
        "recup_ecart_sec": round(sum(ecarts_r) / len(ecarts_r)) if ecarts_r else None,
        "etapes_prevues": len(lignes), "etapes_ok": sum(1 for x in lignes if x["etat"] == "ok"),
        "note": round(sum(x["note"] * POIDS[x["role"]] for x in lignes) / poids) if poids else None,
    }
    note = resume["note"] or 0
    if mode == "theorique":
        resume["note"], resume["verdict"] = None, "Étapes non repérées dans l'enregistrement"
    else:
        resume["verdict"] = ("Plan suivi de près" if note >= 85 else "Plan suivi dans l'ensemble" if note >= 65
                             else "Plan suivi en partie" if note >= 40 else "Séance différente du plan")
    return resume, _phrases(lignes, resume, mode, sport)


def _phrase_bord(nom: str, lignes: list[dict]) -> Optional[str]:
    """Échauffement ou retour au calme : durée faite contre durée prévue, FC si elle était visée."""
    if not lignes:
        return None
    presentes = [x for x in lignes if x["fait"]]
    absentes = [x for x in lignes if not x["fait"]]
    prevu = sum(x["prevu"]["duree_sec"] or 0 for x in lignes)
    if not presentes:
        return f"{nom} : rien dans l'enregistrement" + (f" ({_duree(prevu)} prévues)." if prevu else ".")
    fait = sum(x["fait"]["duree_sec"] for x in presentes)
    phrase = f"{nom} : {_duree(fait)}" + (f" pour {_duree(prevu)} prévues" if prevu else "")
    vise = next((x for x in presentes if x["fait"]["fc"] and (x["prevu"]["fc_max"] or x["prevu"]["fc_min"])), None)
    if vise:
        bas, haut = vise["prevu"]["fc_min"], vise["prevu"]["fc_max"]
        cible = f"{bas}–{haut}" if bas and haut else f"moins de {haut}" if haut else f"plus de {bas}"
        phrase += f", FC moyenne {vise['fait']['fc']} pour {cible} visé"
    if absentes and presentes:
        noms = ", ".join(f"« {x['libelle'] or LIBELLES[x['role']].lower()} » ({_mesure_prevue(x['prevu'])})" for x in absentes)
        phrase += f" ; pas de trace de {noms} dans l'enregistrement"
    return phrase + "."


def _phrases(lignes: list[dict], r: dict, mode: str, sport: str) -> list[str]:
    efforts = [x for x in lignes if x["role"] == "effort"]
    faits = [x for x in efforts if x["fait"]]
    phrases = []
    n, k = r["efforts_prevus"], r["efforts_faits"]
    pn, pk = ("s" if n > 1 else ""), ("s" if k > 1 else "")
    if mode == "tours":
        tete = f"{k} effort{pk} sur {n} prévu{pn}, suivi{pk} tour par tour à la montre"
    elif mode == "allure":
        tete = f"{k} effort{pk} repéré{pk} à l'allure sur {n} prévu{pn}"
    else:
        tete = (f"Aucun changement d'allure net dans l'enregistrement : les {len(lignes)} étapes sont découpées "
                "aux durées prévues, à titre indicatif")
    if mode != "theorique" and faits:
        mesures = {_mesure_prevue(x["prevu"]) for x in faits}
        ecarts = [x for x in faits if x["etat"] != "ok"]
        quoi = "la durée prévue" if all(x["prevu"]["duree_sec"] for x in faits) else "la distance prévue"
        tete += f" ; {r['efforts_mesure_ok']} dans {quoi}" + (f" ({next(iter(mesures))})" if len(mesures) == 1 else "")
        if ecarts:
            liste = ", ".join(_signe(x["ecart_sec"], "s") if x["ecart_sec"] is not None else _signe(x["ecart_m"], "m")
                              for x in ecarts[:6])
            tete += f", {'les autres' if len(ecarts) > 1 else 'un autre'} à {liste}" + ("…" if len(ecarts) > 6 else "")
    phrases.append(tete + ".")
    if r["effort_allure_sec_km"] and mode != "theorique":
        nom = "Allure des efforts ramenée au plat" if sport == "trail" else "Allure moyenne des efforts"
        phrase = f"{nom} : {cs.fmt_allure(r['effort_allure_sec_km'])}"
        cibles = {tuple(x["prevu"]["allure"]) for x in faits if x["prevu"]["allure"]}
        if r["efforts_vises"]:
            if len(cibles) == 1:
                phrase += f" pour {_plage(next(iter(cibles)))} visé"
            detail = []
            if r["efforts_allure_ok"]:
                detail.append(f"{r['efforts_allure_ok']} dans la cible")
            if r["efforts_rapides"]:
                detail.append(f"{r['efforts_rapides']} plus rapide{'s' if r['efforts_rapides'] > 1 else ''}")
            if r["efforts_lents"]:
                detail.append(f"{r['efforts_lents']} plus lent{'s' if r['efforts_lents'] > 1 else ''}")
            phrase += " ; " + ", ".join(detail)
        elif r["regularite_pct"] is not None:
            phrase += f", {_nombre(r['regularite_pct'])} % d'écart de l'un à l'autre"
        if r["effort_fc"]:
            phrase += f" ; FC moyenne {r['effort_fc']}"
        phrases.append(phrase + ".")
    recups = [x for x in lignes if x["role"] == "recup" and x["fait"] and x["sur"] > 1]
    if recups and mode != "theorique":
        moy = sum(x["fait"]["duree_sec"] for x in recups) / len(recups)
        prevues = {x["prevu"]["duree_sec"] for x in recups if x["prevu"]["duree_sec"]}
        phrase = f"Récupérations : {_duree(moy)} en moyenne"
        if len(prevues) == 1:
            phrase += f" pour {_duree(next(iter(prevues)))} prévues"
        allures = [x["fait"]["allure_sec_km"] for x in recups if x["fait"]["allure_sec_km"]]
        if allures and len(allures) == len(recups):
            phrase += f", à {cs.fmt_allure(median(allures))}"
        phrases.append(phrase + ".")
    if mode != "theorique":
        premier = next((i for i, x in enumerate(lignes) if x["role"] == "effort"), 0)
        dernier = max((i for i, x in enumerate(lignes) if x["role"] == "effort"), default=len(lignes) - 1)
        for nom, part in (("Échauffement", lignes[:premier]), ("Retour au calme", lignes[dernier + 1:])):
            phrase = _phrase_bord(nom, part)
            if phrase:
                phrases.append(phrase)
    return phrases


# ---------------------------------------------------------------------------
# Analyse complète
# ---------------------------------------------------------------------------

def analyser(p, seance: dc.Seance, intervalles: Optional[list] = None, source: Optional[str] = None) -> Optional[dict]:
    """Comparaison étape par étape de la séance prévue `p` et de l'enregistrement `seance`.
    None si la séance prévue n'est pas une séance d'intensité minutée, ou si l'enregistrement est trop court."""
    etapes = etapes_plan(p)
    seq = derouler(etapes)
    if not concerne(p, seq) or seance is None or seance.n < 30 or seance.dist[-1] < 300:
        return None
    f = _Flux(seance)
    if f.chrono[-1] < 120:
        return None
    mode, plages = None, None
    tours = _tours(f, intervalles)
    if tours:
        # Avec ou sans récupération après le dernier effort : on garde la lecture qui colle le mieux au plan
        meilleure = None
        for variante in (seq, derouler(etapes, recup_finale=True)):
            essai = _par_tours(f, variante, tours)
            if not essai:
                continue
            notes = [_comparer(e, _mesure(f, *pl) if pl else None, "tours", seance.sport)["note"] * POIDS[e["role"]]
                     for e, pl in zip(variante, essai)]
            note = sum(notes) / sum(POIDS[e["role"]] for e in variante)
            if meilleure is None or note > meilleure[0]:
                meilleure = (note, variante, essai)
        if meilleure:
            mode, seq, plages = "tours", meilleure[1], meilleure[2]
    if not plages:
        plages = _par_allure(f, seq)
        mode = "allure" if plages else None
    if not plages:
        plages, mode = _theorique(f, seq), "theorique"
    lignes = [_comparer(e, _mesure(f, *pl) if pl else None, mode, seance.sport) for e, pl in zip(seq, plages)]
    resume, phrases = _resume(lignes, mode, seance.sport)
    cle = ss.type_du_plan(p)
    return {
        "v": VERSION, "prevue_id": getattr(p, "id", None), "empreinte": empreinte(p), "source": source,
        "mode": mode, "type": cle, "type_label": cs.TYPES_SEANCE.get(cle) if cle else None,
        "titre": p.titre, "etapes": lignes, "resume": resume, "phrases": phrases,
        "consigne_suivie": bool(getattr(p, "suivie", False)),
    }


def consigne_suivie(a) -> Optional[str]:
    """Consigne réellement suivie ce jour-là, quand elle diffère de celle du plan (saisie sur la fiche)."""
    t = cs._details_dict(a).get("consigne_suivie")
    return t.strip() if isinstance(t, str) and t.strip() else None


def plan_suivi(a, p, texte: Optional[str] = None):
    """Séance prévue `p` telle qu’elle a été suivie : la consigne propre à l’activité remplace celle du plan.
    La séance du plan elle-même n’est jamais modifiée."""
    t = texte if texte is not None else consigne_suivie(a)
    if p is None or not t:
        return p
    return SimpleNamespace(id=p.id, titre=p.titre, description=t, structure=None, sport=p.sport, suivie=True)


def stockee(a, p) -> Optional[dict]:
    """Analyse déjà enregistrée sur l'activité, si elle correspond encore à la séance prévue `p`."""
    if p is None:
        return None
    r = cs._details_dict(a).get("execution") or {}
    if r.get("v") == VERSION and r.get("prevue_id") == p.id and r.get("empreinte") == empreinte(p):
        return r
    return None


def pour_activite(db, user, a, p) -> Optional[dict]:
    """Respect du plan pour l'activité `a` reliée à la séance prévue `p` ; None si rien à vérifier.
    Calculée une fois puis gardée dans le champ d'analyse `execution` ; refaite si le plan a changé,
    ou si elle venait du tracé GPS alors que l'enregistrement complet d'Intervals est disponible."""
    import intervals_service as iv
    from models import TraceGPS
    p = plan_suivi(a, p)
    if p is None or a.sport not in cs.SPORTS_PIED or not concerne(p, derouler(etapes_plan(p))):
        return None
    det = cs._details_dict(a)
    complet = bool(det.get("intervals_id") and user.intervals_cle and not det.get("montre_hs"))
    deja = stockee(a, p)
    if deja and (deja.get("source") == "intervals" or not complet):
        return deja
    t = db.query(TraceGPS).filter(TraceGPS.activite_id == a.id).first()
    try:
        brut = iv.seance_brute(user, a, json.loads(t.points) if t else None)
    except Exception:  # mesures illisibles : on garde ce qui est déjà enregistré
        brut = None
    if not brut:
        return deja
    r = analyser(p, brut[0], brut[1], brut[2])
    if not r:
        return deja
    cs.fusionner_details(a, {"execution": r}, ecraser=True)
    return r


def nom_etape(x: dict) -> str:
    nom = {"echauffement": "Échauffement", "effort": "Effort", "recup": "Récupération", "retour": "Retour au calme"}[x["role"]]
    return f"{nom} {x['rep']}/{x['sur']}" if x["sur"] > 1 else nom


def texte_markdown(r: dict) -> list[str]:
    """Lignes Markdown d’une analyse : verdict, phrases, puis le tableau étape par étape."""
    res = r.get("resume") or {}
    note = f" ({res['note']}/100)" if res.get("note") is not None else ""
    lignes = [f"### {r.get('jour', '')} — {cs._cell(r.get('titre'))} ({r.get('type_label') or 'Intensité'}) : "
              f"{res.get('verdict', '')}{note}", ""]
    if r.get("consigne_suivie"):
        lignes.append("- Comparée à la consigne réellement suivie ce jour-là, différente de celle du plan.")
    lignes += [f"- {p}" for p in r.get("phrases") or []]
    if r.get("mode") == "theorique":
        return lignes
    lignes += ["", "| Étape | Consigne | Prévu | Fait | Écart | Allure | Allure visée | FC |", "|---|---|---|---|---|---|---|---|"]
    for x in r.get("etapes") or []:
        prevu, fait = x["prevu"], x.get("fait")
        visee = ""
        if prevu.get("allure"):
            a, b = prevu["allure"]
            visee = cs.fmt_allure(a) if a == b else f"{cs.fmt_allure(a).replace('/km', '')}–{cs.fmt_allure(b)}"
        if not fait:
            lignes.append(f"| {nom_etape(x)} | {cs._cell(x['libelle'])} | {_mesure_prevue(prevu)} | non repérée | | | {visee} | |")
            continue
        if prevu.get("libre"):
            mesure, ecart = _duree(fait["duree_sec"]), ""
        elif x["ecart_sec"] is not None:
            mesure, ecart = _duree(fait["duree_sec"]), (_signe(x["ecart_sec"], "s") if x["ecart_sec"] else "0")
        else:
            mesure, ecart = f"{fait['distance_m']} m", (_signe(x["ecart_m"], "m") if x["ecart_m"] else "0")
        allure = cs.fmt_allure(fait["allure_sec_km"]) if fait.get("allure_sec_km") else ""
        if x.get("etat_allure") in ("rapide", "lent"):
            allure += f" (trop {x['etat_allure']})"
        lignes.append(f"| {nom_etape(x)} | {cs._cell(x['libelle'])} | {_mesure_prevue(prevu)} | {mesure} | {ecart} | "
                      f"{allure} | {visee} | {fait.get('fc') or ''} |")
    return lignes
