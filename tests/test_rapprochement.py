"""Rattachement automatique séances prévues ↔ activités : jamais au hasard, jamais selon le jour écrit."""
import json
from datetime import date, datetime

import carnet_service as cs
import seance_service as ss
from models import Activite, SeancePrevue

LUNDI = date(2026, 11, 9)
AUJ = date(2026, 11, 12)


def _act(db, user, jour, sport="course", duree_min=45, km=None, dplus=None, typ=None, titre=None, heure=18):
    a = Activite(utilisateur_id=user.id, sport=sport, debut=datetime(jour.year, jour.month, jour.day, heure),
                 duree_sec=duree_min * 60, distance_km=km, dplus_m=dplus, titre=titre)
    if typ:
        # type déjà reconnu (pas de tracé) : maj_types n'y touche pas
        a.details = json.dumps({"seance": {"v": ss.VERSION_SEANCE, "trace": None, "type": typ}})
    db.add(a)
    db.flush()
    return a


def _prevue(db, user, jour, titre, sport="course", duree_min=None, km=None, dplus=None, description=None, deroule=None):
    p = SeancePrevue(utilisateur_id=user.id, jour=jour, sport=sport, titre=titre, duree_min=duree_min,
                     distance_km=km, dplus_m=dplus, description=description,
                     deroule=json.dumps(deroule) if deroule else None)
    db.add(p)
    db.flush()
    return p


def test_le_jour_ecrit_ne_compte_pas(db, user):
    p = _prevue(db, user, LUNDI, "Footing EF", duree_min=45)
    a = _act(db, user, date(2026, 11, 11), duree_min=46, typ="footing")
    assert cs.rapprocher_plan(db, user.id, AUJ) == 1
    assert p.activite_id == a.id
    assert a.titre == "Footing EF"


def test_chaque_sortie_va_a_la_seance_qui_lui_ressemble(db, user):
    longue = _prevue(db, user, LUNDI, "Sortie longue", duree_min=90, km=15)
    fartlek = _prevue(db, user, date(2026, 11, 13), "Fartlek court : 6 × 1'", duree_min=40)
    a_frac = _act(db, user, date(2026, 11, 10), duree_min=41, km=7.5, typ="fractionne_court")
    a_long = _act(db, user, date(2026, 11, 11), duree_min=88, km=14.6, typ="sortie_longue")
    assert cs.rapprocher_plan(db, user.id, AUJ) == 2
    assert longue.activite_id == a_long.id
    assert fartlek.activite_id == a_frac.id


def test_un_footing_ne_valide_pas_un_fractionne(db, user):
    p = _prevue(db, user, LUNDI, "Fartlek court : 6 × 1'", duree_min=40)
    _act(db, user, date(2026, 11, 10), duree_min=40, typ="footing")
    assert cs.rapprocher_plan(db, user.id, AUJ) == 0
    assert p.activite_id is None


def test_trop_courte_ou_trop_differente(db, user):
    p = _prevue(db, user, LUNDI, "Footing", duree_min=60)
    _act(db, user, date(2026, 11, 10), duree_min=25, typ="footing")
    assert cs.rapprocher_plan(db, user.id, AUJ) == 0
    assert p.activite_id is None


def test_ambigu_laisse_a_l_athlete(db, user):
    # deux footings différents de durées voisines : une sortie de 47 min va aussi bien à l'un qu'à l'autre
    p1 = _prevue(db, user, LUNDI, "Footing EF", duree_min=45)
    p2 = _prevue(db, user, LUNDI, "Footing vallonné", duree_min=50)
    _act(db, user, date(2026, 11, 10), duree_min=47, typ="footing")
    assert cs.rapprocher_plan(db, user.id, AUJ) == 0
    assert p1.activite_id is None and p2.activite_id is None


def test_seances_identiques_ne_sont_pas_ambigues(db, user):
    p1 = _prevue(db, user, LUNDI, "Footing EF", duree_min=45)
    p2 = _prevue(db, user, date(2026, 11, 12), "Footing EF", duree_min=45)
    a = _act(db, user, date(2026, 11, 10), duree_min=45, typ="footing")
    assert cs.rapprocher_plan(db, user.id, AUJ) == 1
    assert a.id in (p1.activite_id, p2.activite_id)


def test_autre_semaine_jamais(db, user):
    p = _prevue(db, user, LUNDI, "Footing", duree_min=45)
    _act(db, user, date(2026, 11, 8), duree_min=45, typ="footing")
    assert cs.rapprocher_plan(db, user.id, AUJ) == 0
    assert p.activite_id is None


def test_sans_duree_ni_distance_on_ne_devine_pas(db, user):
    p = _prevue(db, user, LUNDI, "Séance libre")
    _act(db, user, date(2026, 11, 10), duree_min=45, typ="footing")
    assert cs.rapprocher_plan(db, user.id, AUJ) == 0
    assert p.activite_id is None


def test_un_nom_donne_n_est_jamais_ecrase(db, user):
    p = _prevue(db, user, LUNDI, "Footing EF", duree_min=45)
    a = _act(db, user, date(2026, 11, 10), duree_min=45, typ="footing", titre="Tour du lac")
    assert cs.rapprocher_plan(db, user.id, AUJ) == 1
    assert p.activite_id == a.id and a.titre == "Tour du lac"


def test_muscu_sans_preuve_reste_manuelle(db, user):
    p = _prevue(db, user, LUNDI, "Test AMRAP 10 min (Celio)", sport="muscu", duree_min=20)
    _act(db, user, date(2026, 11, 10), sport="muscu", duree_min=20, titre="Renforcement")
    assert cs.rapprocher_plan(db, user.id, AUJ) == 0
    assert p.activite_id is None


def test_muscu_reliee_par_la_seance_guidee(db, user):
    # séance guidée de 17 h 05 à 17 h 30 (heure de Paris = 16 h 05 UTC en novembre)
    p = _prevue(db, user, LUNDI, "Test AMRAP 10 min (Celio)", sport="muscu",
                deroule={"debut": "2026-11-12T16:05:00Z", "fin": "2026-11-12T16:30:00Z"})
    autre = _act(db, user, date(2026, 11, 10), sport="muscu", duree_min=30)
    a = _act(db, user, date(2026, 11, 12), sport="hiit", duree_min=25, heure=17)
    assert cs.rapprocher_plan(db, user.id, AUJ) == 1
    assert p.activite_id == a.id and autre.id != p.activite_id


def test_muscu_reliee_par_le_nom(db, user):
    p = _prevue(db, user, LUNDI, "Haut du corps", sport="muscu")
    a = _act(db, user, date(2026, 11, 11), sport="muscu", duree_min=40, titre="Haut du corps")
    assert cs.rapprocher_plan(db, user.id, AUJ) == 1
    assert p.activite_id == a.id
