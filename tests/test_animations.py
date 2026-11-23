"""Démonstrations 3D : muscles sollicités et corps derrière la barre."""
import animations as an


def test_chaque_exercice_du_catalogue_montre_ses_muscles():
    sans = [k for k, a in an.BASE.items() if not a.get("muscles")]
    assert sans == ["short foot"]   # travail du pied : aucune des zones du corps


def test_muscles_deduits_du_nom():
    assert an.avec_muscles("tractions supination", {})["muscles"] == ["dos", "biceps", "avant-bras"]
    assert an.avec_muscles("abduction hanche", {})["muscles"] == ["fessiers"]
    assert an.avec_muscles("pompes diamant", {})["muscles"][0] == "triceps"
    # Les muscles fournis par le plan priment, un nom inconnu reste sans surbrillance
    assert an.avec_muscles("squat", {"muscles": ["mollets"]})["muscles"] == ["mollets"]
    assert "muscles" not in an.avec_muscles("exercice inconnu", {})


def test_le_buste_recule_derriere_la_barre_de_traction():
    anim = {"decor": [an.BARRE_TRACTION], "poses": {
        "bas": {"epaules": [0, 1.735, 0], "bassin": [-0.03, 1.215, 0]},
        "haut": {"epaules": [-0.1, 2.08, 0], "bassin": [-0.15, 1.57, 0]}}}
    r = an.derriere_la_barre(anim)["poses"]
    assert r["bas"] == anim["poses"]["bas"]                    # tête sous la barre : rien ne bouge
    assert r["haut"]["epaules"] == [-0.24, 2.08, 0] and r["haut"]["bassin"] == [-0.29, 1.57, 0]
    # Le catalogue de base est déjà réglé, et une barre basse n'est pas concernée
    for k, a in an.BASE.items():
        assert an.derriere_la_barre(a)["poses"] == a["poses"], k
