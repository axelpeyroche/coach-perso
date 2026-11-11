"""Jeux d'essai figés des calculs : une régression ici fausserait toutes les analyses sans bruit."""
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

import calculs
import carnet_service as cs
import suivi_service as sv
import zones_service as zs


# ── Charge et forme ──────────────────────────────────────────────────────────

def test_charge_minutes_fois_rpe():
    assert cs.charge(SimpleNamespace(duree_sec=3600, rpe=7)) == 420
    assert cs.charge(SimpleNamespace(duree_sec=3600, rpe=None)) == 300   # RPE manquant : effort modéré (5)
    assert cs.charge(SimpleNamespace(duree_sec=None, rpe=8)) == 0


def test_courbe_forme_une_seance_puis_repos():
    j = date(2026, 1, 1)
    serie = calculs.courbe_forme({j: 100.0}, j + timedelta(days=2))
    assert [p["jour"] for p in serie] == ["2026-01-01", "2026-01-02", "2026-01-03"]
    # Jour de la séance : la fraîcheur (TSB) est celle de la veille, la forme monte de 100/42, la fatigue de 100/7
    assert serie[0] == {"jour": "2026-01-01", "charge": 100, "ctl": 2.4, "atl": 14.3, "tsb": 0.0}
    # Lendemain : TSB = forme − fatigue de la veille ; les deux retombent
    assert serie[1] == {"jour": "2026-01-02", "charge": 0, "ctl": 2.3, "atl": 12.2, "tsb": -11.9}
    assert serie[2]["tsb"] == -9.9


def test_courbe_forme_charge_constante_converge():
    j = date(2025, 1, 1)
    serie = calculs.courbe_forme({j + timedelta(days=i): 300.0 for i in range(400)}, j + timedelta(days=399))
    assert serie[-1]["ctl"] == 300.0 and serie[-1]["atl"] == 300.0 and serie[-1]["tsb"] == 0.0


def test_courbe_forme_vide():
    assert calculs.courbe_forme({}, date(2026, 1, 1)) == []


@pytest.mark.parametrize("ctl, tsb, code", [
    (3, 0, "neutre"),            # pas assez d'historique
    (50, 15, "frais_plus"),      # +30 %
    (50, 5, "frais"),            # +10 %
    (50, 0, "neutre"),
    (50, -10, "productif"),      # −20 %
    (50, -20, "surcharge"),      # −40 %
])
def test_etat_forme(ctl, tsb, code):
    assert calculs.etat_forme(ctl, tsb)["code"] == code


# ── Allure critique, VMA ─────────────────────────────────────────────────────

def test_vitesse_critique_droite_exacte():
    # distance = 4 m/s × t + 200 m
    assert calculs.vitesse_critique({3: 920, 5: 1400, 10: 2600, 20: 5000}) == {
        "vitesse_ms": 4.0, "allure_sec_km": 250, "dprime_m": 200, "n": 4}


def test_vitesse_critique_refuse_les_cas_douteux():
    assert calculs.vitesse_critique({3: 920, 5: 1400}) is None                       # moins de 3 durées
    assert calculs.vitesse_critique({3: 1500, 5: 1900, 10: 2900, 20: 4900}) is None  # réserve de 900 m : invraisemblable
    assert calculs.vitesse_critique({1: 400, 30: 7000, 60: 13000}) is None           # durées hors modèle


def test_fraction_vma():
    assert calculs.fraction_vma(6) == 1.0
    assert calculs.fraction_vma(20) == pytest.approx(0.9199, abs=1e-4)
    assert calculs.fraction_vma(1) == calculs.fraction_vma(3)     # plancher à 3 min


# ── Dérive cardiaque, durabilité, corrélation ────────────────────────────────

def _sortie(minutes, fc_de):
    temps = list(range(0, minutes * 60 + 1, 30))
    return temps, [fc_de(t) for t in temps], [3.0 * t for t in temps]   # 3 m/s constants


def test_derive_cardiaque():
    temps, fc, dist = _sortie(60, lambda t: 140 if t <= 2100 else 147)   # moitié à 2100 s, échauffement de 10 min exclu
    assert calculs.derive_cardiaque(temps, fc, dist) == 4.7
    temps, fc, dist = _sortie(60, lambda t: 140)
    assert calculs.derive_cardiaque(temps, fc, dist) == 0.0


def test_derive_cardiaque_sortie_trop_courte():
    temps, fc, dist = _sortie(20, lambda t: 140)
    assert calculs.derive_cardiaque(temps, fc, dist) is None


def test_durabilite():
    temps, fc, dist = _sortie(120, lambda t: 140 if t < 5400 else 154)   # dernier quart 10 % plus haut
    assert calculs.durabilite(temps, fc, dist) == 9.1
    temps, fc, dist = _sortie(45, lambda t: 140)
    assert calculs.durabilite(temps, fc, dist) is None                   # moins de 40 min utiles


def test_pearson():
    assert calculs.pearson([1, 2, 3, 4], [2, 4, 6, 8]) == pytest.approx(1.0)
    assert calculs.pearson([1, 2, 3, 4], [8, 6, 4, 2]) == pytest.approx(-1.0)
    assert calculs.pearson([1, 2], [1, 2]) is None
    assert calculs.pearson([1, 2, 3], [5, 5, 5]) is None


# ── Zones ────────────────────────────────────────────────────────────────────

def test_bornes_fc_depuis_le_seuil():
    assert zs.bornes_fc(160, 190, 50) == ([136, 144, 152, 160], "seuil")     # Friel : 85, 90, 95, 100 % du seuil


def test_bornes_fc_depuis_la_reserve():
    assert zs.bornes_fc(None, 190, 50) == ([134, 148, 162, 176], "reserve")  # Karvonen : 60 à 90 % de la réserve
    assert zs.bornes_fc(None, 190, None) == (None, None)
    assert zs.bornes_fc(None, 50, 60) == (None, None)


def test_zones_fc_et_allure():
    z = zs.zones([144, 153, 162, 170], 4.0, 16.0)
    assert [(x["zone"], x["fc_min"], x["fc_max"]) for x in z] == [
        (1, None, 143), (2, 144, 152), (3, 153, 161), (4, 162, 169), (5, 170, None)]
    assert (z[0]["allure_lente"], z[0]["allure_rapide"]) == (None, 347)    # 72 % de la vitesse critique
    assert (z[3]["allure_lente"], z[3]["allure_rapide"]) == (278, 255)     # 90 à 98 %
    assert z[4]["allure_rapide"] is None and z[4]["allure_vma"] == 225     # 16 km/h
    assert zs.zones(None, 4.0) == []


@pytest.mark.parametrize("minutes, competition, attendu", [
    (10, False, None), (20, False, 1.03), (60, False, 1.0), (75, False, 0.985),
    (100, False, None), (150, True, 0.94), (200, True, None),
])
def test_ratio_seuil(minutes, competition, attendu):
    r = zs._ratio_seuil(minutes, competition)
    assert r is None if attendu is None else r == pytest.approx(attendu)


# ── Forme du matin : alertes ─────────────────────────────────────────────────

def test_alerte_vfc_compte_les_matins_bas_consecutifs():
    pts = [{"vfc": 60, "vfc_bas": 50}, {"vfc": 45, "vfc_bas": 50}, {"vfc": None}, {"vfc": 44, "vfc_bas": 50}]
    assert sv._alerte_vfc(pts) == 2                       # le matin sans mesure n'interrompt pas la série
    assert sv._alerte_vfc(pts + [{"vfc": 55, "vfc_bas": 50}]) == 0


def test_alerte_fc_repos():
    pts = [{"fc_repos": 50, "fc_ref": 48}, {"fc_repos": 54, "fc_ref": 48}, {"fc_repos": 53, "fc_ref": 48}]
    assert sv._alerte_fc(pts) == 2                        # +5 bpm ou plus, deux matins de suite
    assert sv._alerte_fc(pts + [{"fc_repos": 52, "fc_ref": 48}]) == 0
