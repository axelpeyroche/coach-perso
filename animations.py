"""
Animations 3D des exercices de muscu (séance guidée → « Voir le mouvement »).

Un mannequin d'artiste (frontend/src/mannequin.js) prend des poses décrites ici en
JSON et passe de l'une à l'autre en douceur. Repère : mètres, y vers le haut, sol en
y = 0 ; debout face à +x, la droite de la personne est en +z.

    {"poses": {"haut": {...}, "bas": {...}},          # 8 poses max
     "phases": [["bas", 2, "Descente · 2 s"], ...],   # pose visée, durée (s), libellé
     "consignes": ["…"],                              # 4 max
     "decor": [{"type": "barre", "a": [x,y,z], "b": [x,y,z]}, ...],
     "camera": {"az": 0.6, "el": 0.2}}                # facultatif

Le cycle part de la pose de la dernière phase ; répéter une pose = la tenir.
Clés d'une pose : bassin, epaules (points du tronc), devant (direction de la
poitrine), flexion (0 à 1, dos arrondi), tete (direction), mg/md (poignets), pg/pd
(chevilles), coude_g/d et genou_g/d (côté vers lequel l'articulation plie),
doigts_g/d, prise_g/d (largeur de la main = axe de l'haltère), orteils_g/d (pointe
du pied). Raccourcis m, p, coude, genou, doigts, prise, orteils : valeur pour la
droite, la gauche en miroir (z → -z). Les poses suivantes héritent de la première.
Décor : barre {a, b, poteaux?}, boite {c, t}, tapis {c, t}, chaise {c, dossier?},
haltere {main: "g" | "d" | "gd"} ou {c, axe}.

Même rapprochement que les pictogrammes : tous les mots de la clé dans le nom de
l'exercice, la clé la plus précise l'emporte, celles de l'utilisateur d'abord.
"""

from __future__ import annotations

import json
import math
import re

from sqlalchemy.orm import Session

from models import Animation
from pictogrammes import PRECISIONS, cle, exercices, mots, trouver

MAX_POSES, MAX_PHASES, MAX_DECOR, MAX_CONSIGNES = 8, 12, 12, 4
CLES_POSE = {"bassin", "epaules", "devant", "flexion", "tete", "mg", "md", "pg", "pd", "coude_g", "coude_d",
             "genou_g", "genou_d", "doigts_g", "doigts_d", "prise_g", "prise_d", "orteils_g", "orteils_d",
             "m", "p", "coude", "genou", "doigts", "prise", "orteils"}
DECOR = {"barre": {"a", "b", "poteaux"}, "boite": {"c", "t"}, "tapis": {"c", "t"}, "chaise": {"c", "dossier"},
         "haltere": {"main", "c", "axe"}}


# --- Petits outils de construction des poses ---

def _r(v):
    return [round(x, 3) for x in v]


def _tronc(bassin, inclinaison_deg=0.0):
    """Épaules au-dessus du bassin, buste penché vers l'avant (+x) de l'angle donné."""
    a = math.radians(inclinaison_deg)
    return _r([bassin[0] + 0.52 * math.sin(a), bassin[1] + 0.52 * math.cos(a), 0])


def _hanches(bassin):
    """Mains posées sur les hanches."""
    return _r([bassin[0] - 0.02, bassin[1] + 0.03, 0.21])


TAPIS = {"type": "tapis", "c": [0.75, 0.004, 0], "t": [1.9, 0.008, 0.65]}
TAPIS_DOS = {"type": "tapis", "c": [0, 0.004, 0], "t": [1.9, 0.008, 0.65]}
DEUX_HALTERES = [{"type": "haltere", "main": "g"}, {"type": "haltere", "main": "d"}]
BARRE_TRACTION = {"type": "barre", "a": [0, 2.3, -0.7], "b": [0, 2.3, 0.7]}
PARALLELES = [{"type": "barre", "a": [-0.35, 1.15, z], "b": [0.35, 1.15, z]} for z in (-0.26, 0.26)]
DEBOUT = {"bassin": [0, 0.95, 0], "epaules": [0, 1.47, 0], "p": [0, 0.08, 0.1]}


# --- Poussée ---

def _pompes(mains, doigts, prise, coude=None, consignes=None):
    haut = {"bassin": [0.85, 0.41, 0], "epaules": [1.34, 0.58, 0], "devant": [0.33, -0.94, 0],
            "m": mains, "doigts": doigts, "prise": prise, "p": [0, 0.12, 0.1], "orteils": [0.03, 0.015, 0.1]}
    if coude:
        haut["coude"] = coude
    return {
        "poses": {"haut": haut, "bas": {"bassin": [0.897, 0.18, 0], "epaules": [1.416, 0.22, 0], "devant": [0.077, -0.997, 0]}},
        "phases": [["bas", 1.8, "Descente · 2 s"], ["bas", 0.3, "Pause en bas"],
                   ["haut", 1.0, "Poussée · 1 s"], ["haut", 0.5, "Bras tendus, corps gainé"]],
        "consignes": consignes,
        "decor": [TAPIS],
    }


POMPES = _pompes([1.32, 0.04, 0.27], [1, 0, 0], [0, 0, 1], consignes=[
    "Une seule ligne des talons à la tête",
    "Coudes à 45° du buste, pas à l'équerre",
    "Poitrine à un poing du sol, puis pousse",
])

POMPES_DIAMANT = _pompes([1.30, 0.04, 0.05], [0.7, 0, -0.7], [0.7, 0, 0.7], coude=[-0.96, 0.3, 0.3], consignes=[
    "Mains jointes sous le sternum, pouces et index en losange",
    "Coudes serrés le long du buste, vers l'arrière",
    "Corps gainé d'un bloc, fessiers serrés",
])

DIPS = {
    "poses": {
        "haut": {"epaules": [0, 1.73, 0], "bassin": [-0.09, 1.22, 0], "m": [-0.04, 1.18, 0.26],
                 "doigts": [1, 0, 0], "prise": [0, 0, 1], "coude": [-1, 0, 0.2], "p": [-0.4, 0.8, 0.1]},
        "bas": {"epaules": [0.05, 1.40, 0], "bassin": [-0.17, 0.93, 0], "p": [-0.45, 0.52, 0.1]},
    },
    "phases": [["bas", 2.0, "Descente · 2 s"], ["bas", 0.3, "Épaules au niveau des coudes"],
               ["haut", 1.0, "Poussée · 1 s"], ["haut", 0.5, "Bras tendus, épaules basses"]],
    "consignes": [
        "Épaules loin des oreilles pendant tout le mouvement",
        "Buste légèrement penché, coudes vers l'arrière",
        "Descends jusqu'à ce que les épaules passent au niveau des coudes",
    ],
    "decor": PARALLELES,
}


def _developpe(dy, assis=False):
    poses = {
        "bas": {"m": [0.09, 1.69 - dy, 0.47], "coude": [0.3, -0.3, 1], "prise": [0, 0, 1]},
        "haut": {"m": [0.04, 2.02 - dy, 0.24]},
    }
    if assis:
        poses["bas"].update({"bassin": [-0.05, 0.53, 0], "epaules": [-0.05, 1.05, 0], "p": [0.42, 0.08, 0.17]})
        for p in poses.values():
            p["m"][0] -= 0.05
    else:
        poses["bas"].update(DEBOUT)
    return {
        "poses": poses,
        "phases": [["haut", 1.0, "Poussée · 1 s"], ["haut", 0.3, "Bras tendus au-dessus de la tête"],
                   ["bas", 2.0, "Descente · 2 s"], ["bas", 0.3, "Haltères à hauteur d'oreilles"]],
        "consignes": [
            "Abdos et fessiers serrés, pas de cambrure",
            "Coudes légèrement devant le buste",
            "Les haltères montent en se rapprochant au-dessus de la tête",
        ] + (["Dos calé contre le dossier"] if assis else []),
        "decor": DEUX_HALTERES + ([{"type": "chaise", "c": [-0.05, 0, 0]}] if assis else []),
    }


ELEVATIONS_LATERALES = {
    "poses": {
        "bas": {**DEBOUT, "m": [0.04, 0.93, 0.26], "prise": [1, 0, 0], "coude": [-0.5, 0.5, 0.3]},
        "haut": {"m": [0.08, 1.45, 0.73]},
    },
    "phases": [["haut", 1.0, "Montée · 1 s"], ["haut", 0.3, "Bras à l'horizontale"],
               ["bas", 2.0, "Descente · 2 s"], ["bas", 0.3, "Sans poser les haltères"]],
    "consignes": [
        "Coudes très légèrement fléchis, figés",
        "Monte jusqu'à l'horizontale, pas plus haut",
        "Épaules basses, sans élan du buste",
    ],
    "decor": DEUX_HALTERES,
    "camera": {"az": 1.1, "el": 0.2},
}

EXTENSION_COUCHE = {
    "poses": {
        "haut": {"bassin": [0, 0.11, 0], "epaules": [-0.52, 0.13, 0], "devant": [0, 1, 0], "p": [0.42, 0.08, 0.15],
                 "m": [-0.58, 0.68, 0.17], "coude": [0.3, 1, 0], "prise": [1, 0, 0]},
        "bas": {"m": [-0.80, 0.24, 0.18]},
    },
    "phases": [["bas", 2.0, "Descente vers le front · 2 s"], ["bas", 0.3, "Coudes pointés au plafond"],
               ["haut", 1.0, "Extension · 1 s"], ["haut", 0.4, "Bras tendus"]],
    "consignes": [
        "Les coudes restent fixes, seuls les avant-bras bougent",
        "Haltères qui descendent de part et d'autre de la tête",
        "Bas du dos plaqué au sol",
    ],
    "decor": [TAPIS_DOS] + DEUX_HALTERES,
}

EXTENSION_DESSUS = {
    "poses": {
        "haut": {**DEBOUT, "m": [0, 2.0, 0.04], "coude": [0.3, 1, 0.3]},
        "bas": {"m": [-0.18, 1.55, 0.05]},
    },
    "phases": [["bas", 2.0, "Descente derrière la tête · 2 s"], ["bas", 0.3, "Étirement du triceps"],
               ["haut", 1.0, "Extension · 1 s"], ["haut", 0.4, "Bras tendus"]],
    "consignes": [
        "Coudes serrés, pointés vers le plafond",
        "Abdos serrés, pas de cambrure",
        "Haltère tenu à deux mains par le disque du haut",
    ],
    "decor": [{"type": "haltere", "main": "gd"}],
    "camera": {"az": 0.9, "el": 0.2},
}

# Buste penché, main gauche en appui sur une chaise (rowing, kickback)
BUSTE_PENCHE = {"bassin": [-0.05, 0.85, 0], "epaules": [0.44, 1.03, 0], "devant": [0.34, -0.94, 0],
                "mg": [0.55, 0.50, -0.22], "doigts_g": [1, 0, 0], "prise_g": [0, 0, 1],
                "pg": [0.15, 0.08, -0.15], "pd": [-0.25, 0.08, 0.15]}
CHAISE_APPUI = {"type": "chaise", "c": [0.6, 0, -0.2], "dossier": [1, 0, 0]}

KICKBACK = {
    "poses": {
        "bas": {**BUSTE_PENCHE, "md": [0.158, 0.658, 0.19], "coude_d": [-0.3, 1, 0], "prise_d": [1, 0, 0]},
        "haut": {"md": [-0.096, 0.836, 0.19]},
    },
    "phases": [["haut", 1.0, "Extension · bras tendu vers l'arrière"], ["haut", 0.4, "Contraction du triceps"],
               ["bas", 1.6, "Retour · 2 s"], ["bas", 0.3, "Coude fixe, collé au buste"]],
    "consignes": [
        "Bras collé au buste, seul l'avant-bras bouge",
        "Dos plat, main libre en appui",
        "Tends complètement le bras et serre le triceps",
    ],
    "decor": [CHAISE_APPUI, {"type": "haltere", "main": "d"}],
}


# --- Tirage ---

def _tractions(main_z, coude, haut_epaules=(-0.10, 2.08), tete=(-0.2, 1, 0), negatives=False, consignes=None):
    poses = {
        "bas": {"epaules": [0, 1.735, 0], "bassin": [-0.03, 1.215, 0], "p": [-0.06, 0.34, 0.1],
                "m": [0, 2.245, main_z], "doigts": [0, 1, 0], "prise": [0, 0, 1], "coude": coude},
        "haut": {"epaules": [haut_epaules[0], haut_epaules[1], 0],
                 "bassin": [haut_epaules[0] - 0.05, haut_epaules[1] - 0.51, 0], "tete": list(tete), "p": [-0.15, 0.7, 0.1]},
    }
    decor = [BARRE_TRACTION]
    if negatives:
        poses["sol"] = {"p": [-0.3, 0.48, 0.1]}
        phases = [["haut", 1.0, "Menton au-dessus de la barre"], ["bas", 4.0, "Descente lente · 4 s"],
                  ["sol", 0.6, "Pieds sur la box"], ["haut", 1.0, "Remonte d'un saut"]]
        decor = decor + [{"type": "boite", "c": [-0.32, 0.2, 0], "t": [0.4, 0.4, 0.5]}]
    else:
        phases = [["haut", 1.2, "Tirage · menton au-dessus de la barre"], ["haut", 0.4, "Pause en haut"],
                  ["bas", 2.0, "Descente contrôlée · 2 s"], ["bas", 0.5, "Bras tendus, épaules engagées"]]
    return {"poses": poses, "phases": phases, "consignes": consignes, "decor": decor}


TRACTIONS_LARGE = _tractions(0.40, [-0.2, -0.5, 1], consignes=[
    "Mains plus larges que les épaules, paumes vers l'avant",
    "Tire les coudes vers les hanches, poitrine vers la barre",
    "Pas de balancier, jambes gainées",
])
TRACTIONS_SERREE = _tractions(0.12, [0.7, -0.6, 0.25], haut_epaules=(-0.10, 2.10), tete=(-0.15, 1, 0), consignes=[
    "Mains à largeur de poing, paumes vers soi",
    "Coudes devant, tire jusqu'au menton au-dessus de la barre",
    "Descente complète, bras tendus",
])
TRACTIONS_STRICTES = _tractions(0.24, [-0.2, -0.5, 1], consignes=[
    "Départ bras tendus, aucun élan",
    "Menton au-dessus de la barre à chaque répétition",
    "Descente contrôlée jusqu'en bas",
])
NEGATIVES_TRACTIONS = _tractions(0.30, [-0.2, -0.5, 1], negatives=True, consignes=[
    "Monte d'un saut ou depuis la box, menton au-dessus de la barre",
    "Freine la descente le plus longtemps possible",
    "Épaules engagées jusqu'aux bras tendus",
])

AUSTRALIENNES = {
    "poses": {
        "bas": {"bassin": [-0.309, 0.373, 0], "epaules": [0.183, 0.542, 0], "devant": [-0.326, 0.946, 0],
                "p": [-1.16, 0.08, 0.1], "orteils": [-1.206, 0.212, 0.1],
                "m": [0.02, 1.045, 0.26], "doigts": [0, 1, 0], "prise": [1, 0, 0], "coude": [-0.5, -1, 0.4]},
        "haut": {"bassin": [-0.432, 0.609, 0], "epaules": [-0.011, 0.915, 0], "devant": [-0.588, 0.809, 0],
                 "orteils": [-1.242, 0.193, 0.1]},
    },
    "phases": [["haut", 1.0, "Tirage · poitrine vers les barres"], ["haut", 0.4, "Pause, omoplates serrées"],
               ["bas", 1.8, "Descente contrôlée · 2 s"], ["bas", 0.4, "Bras tendus, corps gainé"]],
    "consignes": [
        "Corps droit des talons aux épaules, fessiers serrés",
        "Tire la poitrine vers les barres, coudes vers l'arrière",
        "Pieds plus en avant = plus difficile",
    ],
    "decor": [{"type": "barre", "a": [-0.35, 1.1, z], "b": [0.35, 1.1, z]} for z in (-0.26, 0.26)],
}

ROWING = {
    "poses": {
        "bas": {**BUSTE_PENCHE, "md": [0.44, 0.48, 0.2], "prise_d": [1, 0, 0]},
        "haut": {"md": [0.28, 0.88, 0.2], "coude_d": [-0.5, 1, 0.1]},
    },
    "phases": [["haut", 1.0, "Tirage · coude vers la hanche"], ["haut", 0.4, "Pause, omoplate serrée"],
               ["bas", 1.6, "Descente contrôlée · 2 s"], ["bas", 0.4, "Bras tendu, dos plat"]],
    "consignes": [
        "Dos plat, main et genou libres en appui stable",
        "Tire le coude vers la hanche, pas vers le plafond",
        "Le buste ne tourne pas",
    ],
    "decor": [CHAISE_APPUI, {"type": "haltere", "main": "d"}],
}


def _curl(prise, consignes):
    bas = {**DEBOUT, "m": [0.02, 0.92, 0.22]}
    if prise:
        bas["prise"] = prise
    return {
        "poses": {"bas": bas, "haut": {"m": [0.12, 1.42, 0.22], "coude": [-0.3, -1, 0.15]}},
        "phases": [["haut", 1.0, "Montée · 1 s"], ["haut", 0.3, "Contraction"],
                   ["bas", 2.0, "Descente · 2 s"], ["bas", 0.4, "Bras tendus, coudes fixes"]],
        "consignes": consignes,
        "decor": DEUX_HALTERES,
    }


CURL_MARTEAU = _curl(None, [
    "Pouces vers le haut pendant tout le mouvement",
    "Coudes collés au buste, épaules immobiles",
    "Pas d'élan du buste",
])
CURL_BICEPS = _curl([0, 0, 1], [
    "Paumes vers le haut",
    "Coudes collés au buste, épaules immobiles",
    "Descente lente jusqu'aux bras tendus",
])


# --- Jambes, kiné ---

def _bulgare(leste):
    haut_b, bas_b = [-0.05, 0.90, 0], [-0.12, 0.52, 0]
    haut = {"bassin": haut_b, "epaules": _tronc(haut_b, 10), "pd": [0.25, 0.08, 0.12],
            "pg": [-0.62, 0.52, -0.08], "orteils_g": [-0.76, 0.47, -0.08], "genou_g": [0, -1, 0]}
    bas = {"bassin": bas_b, "epaules": _tronc(bas_b, 10)}
    if not leste:
        haut["m"], bas["m"] = _hanches(haut_b), _hanches(bas_b)
    return {
        "poses": {"haut": haut, "bas": bas},
        "phases": [["bas", 2.0, "Descente · 2 s"], ["bas", 0.4, "Genou arrière vers le sol"],
                   ["haut", 1.2, "Remontée par le talon avant"], ["haut", 0.5, "Genou avant dans l'axe du pied"]],
        "consignes": [
            "Pied arrière posé sur la chaise, lacets en appui",
            "Le genou avant reste au-dessus du pied, sans rentrer",
            "Buste légèrement penché, poids sur la jambe avant",
        ],
        "decor": [{"type": "chaise", "c": [-0.75, 0, -0.08]}] + (DEUX_HALTERES if leste else []),
    }


FENTES_ARRIERE = {
    "poses": {
        "haut": {**DEBOUT, "m": _hanches(DEBOUT["bassin"])},
        "bas": {"bassin": [-0.25, 0.56, 0], "epaules": [-0.25, 1.08, 0], "m": _hanches([-0.25, 0.56, 0]),
                "pg": [-0.62, 0.12, -0.1], "orteils_g": [-0.50, 0.02, -0.1], "genou_g": [0.3, -1, 0]},
    },
    "phases": [["bas", 1.6, "Grand pas en arrière, descente"], ["bas", 0.4, "Genou arrière près du sol"],
               ["haut", 1.2, "Pousse sur le talon avant"], ["haut", 0.5, "Retour debout"]],
    "consignes": [
        "Buste droit, regard devant",
        "Genou avant au-dessus de la cheville",
        "Descends jusqu'à frôler le sol du genou arrière",
    ],
}

PISTOL_BOX = {
    "poses": {
        "haut": {"bassin": [0, 0.95, 0], "epaules": [0, 1.47, 0], "pd": [0, 0.08, 0.1], "pg": [0.75, 0.6, -0.08],
                 "m": [0.55, 1.45, 0.18]},
        "bas": {"bassin": [-0.22, 0.56, 0], "epaules": [0.04, 1.01, 0], "pg": [0.6, 0.3, -0.1], "m": [0.6, 1.05, 0.18]},
    },
    "phases": [["bas", 2.5, "Descente lente sur une jambe · 3 s"], ["bas", 0.4, "Fesses touchent la box"],
               ["haut", 1.2, "Remontée sans élan"], ["haut", 0.5, "Genou dans l'axe du pied"]],
    "consignes": [
        "Bras tendus devant pour l'équilibre",
        "Le genou suit l'axe du pied, sans rentrer",
        "Effleure la box sans t'asseoir",
    ],
    "decor": [{"type": "boite", "c": [-0.28, 0.22, 0], "t": [0.36, 0.44, 0.4]}],
}

MARCHE = {"type": "boite", "c": [0.15, 0.09, 0], "t": [0.3, 0.18, 0.8]}


def _mollets_haut(bassin_y):
    return {"bassin": [-0.02, bassin_y, 0], "epaules": [0, bassin_y + 0.52, 0],
            "p": [-0.03, 0.33, 0.1], "orteils": [0.08, 0.2, 0.1]}


PIED_LEVE = {"pg": [-0.25, 0.55, -0.1], "orteils_g": [-0.12, 0.5, -0.1]}
MOLLETS_EXCENTRIQUES = {
    "poses": {
        "haut2": _mollets_haut(1.20),
        "haut1": PIED_LEVE,
        "bas1": {"bassin": [-0.06, 1.09, 0], "epaules": [-0.04, 1.61, 0], "pd": [-0.07, 0.22, 0.1],
                 "orteils_d": [0.07, 0.2, 0.1], **PIED_LEVE},
        "bas2": {"bassin": [-0.06, 1.09, 0], "epaules": [-0.04, 1.61, 0], "p": [-0.07, 0.22, 0.1], "orteils": [0.07, 0.2, 0.1]},
    },
    "phases": [["haut2", 1.0, "Montée sur deux pieds"], ["haut1", 0.6, "Lève un pied"],
               ["bas1", 3.5, "Descente lente sur une jambe · 4 s"], ["bas2", 0.6, "Talon sous la marche, repose le pied"]],
    "consignes": [
        "Avant du pied sur le bord de la marche, talons dans le vide",
        "Monte à deux pieds, descends sur un seul",
        "Descente très lente jusqu'à l'étirement du mollet",
    ],
    "decor": [MARCHE],
    "camera": {"az": 0.9, "el": 0.15},
}

MOLLETS_GENOUX_FLECHIS = {
    "poses": {
        "bas": {"bassin": [-0.12, 1.0, 0], "epaules": [-0.07, 1.52, 0], "p": [-0.07, 0.22, 0.1], "orteils": [0.07, 0.2, 0.1]},
        "haut": {"bassin": [-0.10, 1.11, 0], "epaules": [-0.05, 1.63, 0], "p": [-0.03, 0.33, 0.1], "orteils": [0.08, 0.2, 0.1]},
    },
    "phases": [["haut", 1.0, "Montée sur la pointe"], ["haut", 0.4, "Genoux fléchis, tenue"],
               ["bas", 3.0, "Descente lente · 3 s"], ["bas", 0.5, "Étirement en bas"]],
    "consignes": [
        "Genoux fléchis et figés pendant tout le mouvement",
        "Monte le plus haut possible sur l'avant du pied",
        "Descente lente, talons sous le niveau de la marche",
    ],
    "decor": [MARCHE],
    "camera": {"az": 0.9, "el": 0.15},
}

ALLONGE_DOS = {"bassin": [0, 0.11, 0], "epaules": [-0.52, 0.13, 0], "devant": [0, 1, 0]}
MAINS_AU_SOL = {"m": [-0.05, 0.05, 0.28], "doigts": [1, 0, 0], "prise": [0, 0, 1]}

PONT_FESSIER = {
    "poses": {
        "bas": {**ALLONGE_DOS, **MAINS_AU_SOL, "pd": [0.40, 0.08, 0.13], "pg": [0.80, 0.40, -0.1]},
        "haut": {"bassin": [0.02, 0.45, 0], "epaules": [-0.5, 0.10, 0], "pg": [0.85, 0.65, -0.1]},
    },
    "phases": [["haut", 1.0, "Montée · bassin haut"], ["haut", 0.8, "Serre les fessiers"],
               ["bas", 1.5, "Descente contrôlée"], ["bas", 0.3, "Effleure le sol"]],
    "consignes": [
        "Pousse dans le talon au sol",
        "Bassin aligné avec les épaules et le genou en haut",
        "Le bassin ne bascule pas d'un côté",
    ],
    "decor": [TAPIS_DOS],
}

ABDUCTION_HANCHE = {
    "poses": {
        "bas": {"bassin": [0, 0.19, 0], "epaules": [-0.52, 0.23, 0], "devant": [0, 0, -1],
                "mg": [-1.05, 0.06, -0.05], "md": [-0.35, 0.04, -0.25], "doigts_d": [0, 0, -1], "prise_d": [1, 0, 0],
                "pg": [0.88, 0.06, 0], "pd": [0.88, 0.14, 0], "orteils_d": [0.9, 0.14, -0.13]},
        "haut": {"pd": [0.80, 0.62, 0], "orteils_d": [0.84, 0.6, -0.13]},
    },
    "phases": [["haut", 1.0, "Lève la jambe du dessus"], ["haut", 0.5, "Pause, pointe du pied vers l'avant"],
               ["bas", 1.5, "Descente lente · 2 s"], ["bas", 0.3, "Sans poser la jambe"]],
    "consignes": [
        "Allongé sur le côté, corps bien aligné",
        "Jambe tendue, légèrement en arrière, talon qui mène",
        "Le bassin ne roule pas vers l'arrière",
    ],
    "decor": [TAPIS_DOS],
    "camera": {"az": 2.45, "el": 0.3},
}

SHORT_FOOT = {
    "poses": {
        "detendu": {"bassin": [-0.05, 0.53, 0], "epaules": [-0.05, 1.05, 0], "m": [0.25, 0.6, 0.2],
                    "p": [0.4, 0.08, 0.15], "orteils": [0.54, 0.02, 0.15]},
        "contracte": {"p": [0.4, 0.095, 0.15], "orteils": [0.51, 0.02, 0.15]},
    },
    "phases": [["contracte", 1.0, "Raccourcis le pied, orteils à plat"], ["contracte", 4.0, "Tiens la voûte creusée · 5 s"],
               ["detendu", 1.0, "Relâche"], ["detendu", 1.0, ""]],
    "consignes": [
        "Rapproche la base du gros orteil du talon",
        "Les orteils restent longs et à plat, sans griffer",
        "Le talon et l'avant du pied ne quittent pas le sol",
    ],
    "decor": [{"type": "chaise", "c": [-0.05, 0, 0]}],
    "camera": {"cible": [0.42, 0.1, 0], "az": 0.95, "el": 0.4, "R": 1.1},
}


# --- Gainage, abdos ---

PLANCHE = {
    "poses": {
        "a": {"bassin": [0.887, 0.272, 0], "epaules": [1.40, 0.36, 0], "devant": [0, -1, 0],
              "m": [1.67, 0.05, 0.17], "coude": [-0.3, -1, 0], "doigts": [1, 0, 0], "prise": [0, 0, 1],
              "p": [0, 0.12, 0.1], "orteils": [0.03, 0.015, 0.1]},
        "b": {"bassin": [0.887, 0.28, 0]},
    },
    "phases": [["a", 2.0, "Corps gainé, une seule ligne"], ["b", 2.0, "Respire, sans creuser le dos"]],
    "consignes": [
        "Coudes sous les épaules",
        "Fessiers et abdos serrés, bassin ni haut ni bas",
        "Regard vers le sol, nuque dans l'axe",
    ],
    "decor": [TAPIS],
}

PLANCHE_LATERALE = {
    "poses": {
        "a": {"epaules": [-0.52, 0.55, 0], "bassin": [-0.027, 0.385, 0], "devant": [0, 0, -1],
              "mg": [-0.58, 0.05, -0.27], "coude_g": [0, -1, 0], "md": [0.02, 0.55, -0.06],
              "pg": [0.80, 0.06, 0], "pd": [0.80, 0.15, 0]},
        "b": {"bassin": [-0.027, 0.395, 0]},
    },
    "phases": [["a", 2.0, "Coude sous l'épaule, corps aligné"], ["b", 2.0, "Bassin haut, respire"]],
    "consignes": [
        "Coude juste sous l'épaule",
        "Une ligne droite des pieds à la tête",
        "Le bassin ne s'affaisse pas",
    ],
    "decor": [TAPIS_DOS],
    "camera": {"az": 2.6, "el": 0.2},
}

HOLLOW = {
    "poses": {
        "a": {"bassin": [0, 0.11, 0], "epaules": [-0.50, 0.26, 0], "devant": [0, 1, 0], "flexion": 0.4,
              "p": [0.86, 0.30, 0.05], "orteils": [1.0, 0.33, 0.05], "m": [-1.05, 0.42, 0.16]},
        "b": {"epaules": [-0.50, 0.27, 0], "p": [0.86, 0.31, 0.05], "orteils": [1.0, 0.34, 0.05]},
    },
    "phases": [["a", 2.5, "Bas du dos plaqué au sol"], ["b", 2.5, "Bras et jambes tendus, respire"]],
    "consignes": [
        "Bas du dos collé au sol en permanence",
        "Épaules décollées, bras tendus derrière la tête",
        "Jambes plus hautes si le dos se décolle",
    ],
    "decor": [TAPIS_DOS],
}


def _mains_croisees(bassin, epaules, devant):
    """Poignets croisés sur la poitrine pour un tronc donné."""
    B = bassin
    u = [epaules[i] - B[i] for i in range(3)]
    lu = math.sqrt(sum(x * x for x in u))
    u = [x / lu for x in u]
    d = sum(devant[i] * u[i] for i in range(3))
    n = [devant[i] - d * u[i] for i in range(3)]
    ln = math.sqrt(sum(x * x for x in n))
    n = [x / ln for x in n]
    E = [B[i] + 0.52 * u[i] for i in range(3)]
    # droite = n × u (selon z ici), poignet droit posé côté gauche
    return {"md": _r([E[0] - 0.15 * u[0] + 0.14 * n[0], E[1] - 0.15 * u[1] + 0.14 * n[1], -0.07]),
            "mg": _r([E[0] - 0.12 * u[0] + 0.15 * n[0], E[1] - 0.12 * u[1] + 0.15 * n[1], 0.07]),
            "coude": [0.2, -0.3, 1]}


def _sit_up(epaules, devant, flexion):
    return {"epaules": epaules, "devant": devant, "flexion": flexion, **_mains_croisees([0, 0.11, 0], epaules, devant)}


SIT_UPS = {
    "poses": {
        "bas": {"bassin": [0, 0.11, 0], "p": [0.45, 0.08, 0.13], "genou": [0.2, 1, 0], **_sit_up([-0.52, 0.13, 0], [0, 1, 0], 0)},
        "mi": _sit_up([-0.4, 0.45, 0], [0.6, 0.8, 0], 0.6),
        "haut": _sit_up([-0.1, 0.62, 0], [1, 0.2, 0], 0.3),
    },
    "phases": [["mi", 0.8, "Enroule le buste"], ["haut", 0.6, "Buste vertical, sans tirer sur la nuque"],
               ["mi", 0.9, "Déroule vertèbre par vertèbre"], ["bas", 0.7, "Omoplates au sol"]],
    "consignes": [
        "Pieds à plat, genoux fléchis",
        "Mains croisées sur la poitrine, jamais derrière la nuque",
        "Descente contrôlée, sans retomber",
    ],
    "decor": [TAPIS_DOS],
}


BASE: dict[str, dict] = {
    "tractions prise large": TRACTIONS_LARGE,
    "tractions prise serree": TRACTIONS_SERREE,
    "tractions strictes": TRACTIONS_STRICTES,
    "negatives tractions": NEGATIVES_TRACTIONS,
    "australiennes": AUSTRALIENNES,
    "rowing haltere": ROWING,
    "curl marteau": CURL_MARTEAU,
    "curl biceps": CURL_BICEPS,
    "dips": DIPS,
    "pompes": POMPES,
    "pompes diamant": POMPES_DIAMANT,
    "developpe militaire": _developpe(0),
    "developpe militaire assis": _developpe(0.42, assis=True),
    "elevations laterales": ELEVATIONS_LATERALES,
    "extension triceps dessus": EXTENSION_DESSUS,
    "extension triceps couche": EXTENSION_COUCHE,
    "kickback": KICKBACK,
    "squat bulgare": _bulgare(False),
    "squat bulgare leste": _bulgare(True),
    "fentes arriere": FENTES_ARRIERE,
    "pistol box": PISTOL_BOX,
    "mollets excentriques": MOLLETS_EXCENTRIQUES,
    "mollets genoux flechis": MOLLETS_GENOUX_FLECHIS,
    "soleaire": MOLLETS_GENOUX_FLECHIS,
    "pont fessier": PONT_FESSIER,
    "abduction hanche": ABDUCTION_HANCHE,
    "short foot": SHORT_FOOT,
    "planche": PLANCHE,
    "planche laterale": PLANCHE_LATERALE,
    "hollow": HOLLOW,
    "sit ups": SIT_UPS,
}


# --- Validation (animations envoyées par le plan hebdomadaire) ---

def _vecteur(v, quoi):
    if not (isinstance(v, list) and len(v) == 3 and all(isinstance(x, (int, float)) and not isinstance(x, bool)
                                                         and math.isfinite(x) and abs(x) <= 5 for x in v)):
        raise ValueError(f"{quoi} : 3 nombres entre -5 et 5 attendus")
    return [float(x) for x in v]


def _texte(t, n, quoi):
    if not isinstance(t, str) or len(t) > n:
        raise ValueError(f"{quoi} : texte de {n} caractères max")
    return t


def valider(anim) -> dict:
    """Animation nettoyée (seules les clés connues, nombres bornés) ou ValueError."""
    if not isinstance(anim, dict):
        raise ValueError("objet JSON attendu")
    poses = anim.get("poses")
    if not isinstance(poses, dict) or not 1 <= len(poses) <= MAX_POSES:
        raise ValueError(f"de 1 à {MAX_POSES} poses attendues")
    propres = {}
    for nom, pose in poses.items():
        _texte(nom, 30, "nom de pose")
        if not isinstance(pose, dict):
            raise ValueError(f"pose « {nom} » : objet attendu")
        p = {}
        for k, v in pose.items():
            if k not in CLES_POSE:
                raise ValueError(f"pose « {nom} » : clé inconnue « {k} »")
            if k == "flexion":
                if not isinstance(v, (int, float)) or isinstance(v, bool) or not 0 <= v <= 1:
                    raise ValueError(f"pose « {nom} » : flexion entre 0 et 1")
                p[k] = float(v)
            else:
                p[k] = _vecteur(v, f"pose « {nom} », {k}")
        propres[nom] = p
    if "bassin" not in next(iter(propres.values())):
        raise ValueError("la première pose doit donner le bassin")
    phases = anim.get("phases")
    if not isinstance(phases, list) or not 1 <= len(phases) <= MAX_PHASES:
        raise ValueError(f"de 1 à {MAX_PHASES} phases attendues")
    ph = []
    for x in phases:
        if not (isinstance(x, list) and 2 <= len(x) <= 3 and x[0] in propres
                and isinstance(x[1], (int, float)) and not isinstance(x[1], bool) and 0.1 <= x[1] <= 10):
            raise ValueError("phase : [pose existante, durée de 0,1 à 10 s, libellé]")
        ph.append([x[0], float(x[1]), _texte(x[2] if len(x) > 2 else "", 60, "libellé de phase")])
    consignes = anim.get("consignes") or []
    if not isinstance(consignes, list) or len(consignes) > MAX_CONSIGNES:
        raise ValueError(f"{MAX_CONSIGNES} consignes max")
    res = {"poses": propres, "phases": ph, "consignes": [_texte(c, 120, "consigne") for c in consignes]}
    decor = anim.get("decor") or []
    if not isinstance(decor, list) or len(decor) > MAX_DECOR:
        raise ValueError(f"{MAX_DECOR} éléments de décor max")
    res["decor"] = []
    for d in decor:
        if not isinstance(d, dict) or d.get("type") not in DECOR:
            raise ValueError(f"décor : type parmi {', '.join(DECOR)}")
        e = {"type": d["type"]}
        for k, v in d.items():
            if k == "type":
                continue
            if k not in DECOR[d["type"]]:
                raise ValueError(f"décor {d['type']} : clé inconnue « {k} »")
            if k == "poteaux":
                e[k] = bool(v)
            elif k == "main":
                if v not in ("g", "d", "gd"):
                    raise ValueError("haltère : main g, d ou gd")
                e[k] = v
            else:
                e[k] = _vecteur(v, f"décor {d['type']}, {k}")
        res["decor"].append(e)
    cam = anim.get("camera")
    if cam is not None:
        if not isinstance(cam, dict) or set(cam) - {"cible", "az", "el", "R"}:
            raise ValueError("caméra : cible, az, el, R")
        c = {}
        for k, v in cam.items():
            if k == "cible":
                c[k] = _vecteur(v, "caméra, cible")
            elif not isinstance(v, (int, float)) or isinstance(v, bool) or not -7 <= v <= 7:
                raise ValueError(f"caméra, {k} : nombre attendu")
            else:
                c[k] = float(v)
        res["camera"] = c
    return res


def catalogue(db: Session, utilisateur_id: int) -> dict[str, dict]:
    """Catalogue de base + animations de l'utilisateur (prioritaires)."""
    res = dict(BASE)
    for a in db.query(Animation).filter(Animation.utilisateur_id == utilisateur_id).all():
        res[a.cle] = json.loads(a.donnees)
    return res


def enregistrer(db: Session, utilisateur_id: int, anims: dict[str, dict]) -> int:
    n = 0
    for nom, anim in anims.items():
        k = cle(nom)
        if not k:
            continue
        try:
            propre = valider(anim)
        except ValueError as e:
            raise ValueError(f"Animation « {nom} » : {e}") from None
        a = db.query(Animation).filter(Animation.utilisateur_id == utilisateur_id, Animation.cle == k).first()
        if a:
            a.donnees = json.dumps(propre)
        else:
            db.add(Animation(utilisateur_id=utilisateur_id, cle=k, nom=nom[:200], donnees=json.dumps(propre)))
        n += 1
    db.flush()
    return n


def a_verifier(db: Session, utilisateur_id: int, descriptions: list[str | None]) -> tuple[list[str], list[dict]]:
    """Exercices sans animation, et ceux qui empruntent celle d'un exercice voisin."""
    cat = catalogue(db, utilisateur_id)
    vus, manquants, approchants = set(), [], []
    for d in descriptions:
        for nom in exercices(d):
            k = cle(nom)
            if not k or k in vus:
                continue
            vus.add(k)
            trouve = trouver(nom, cat)
            essentiel = set(mots(re.split(r"\s*[,(—–:]", nom, maxsplit=1)[0]))
            if not trouve:
                manquants.append(nom)
            elif essentiel - set(trouve.split()) - PRECISIONS:
                approchants.append({"nom": nom, "animation": trouve})
    return manquants, approchants


# Les animations du catalogue doivent passer la même validation que celles du plan
for _k, _a in BASE.items():
    BASE[_k] = valider(_a)
