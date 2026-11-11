"""Qualité des données : détection des anomalies, mise à l'écart sans suppression, journal, sauvegardes, cache."""
import gzip
import json
from datetime import date, datetime, timedelta

import pytest

import analyses_service as an
import cache_analyses
import qualite_service as qs
import sauvegarde_service as sauv
from models import Activite, Exclusion, JournalCalcul, MesureSante, Sauvegarde


def _codes(*args):
    return [p["code"] for p in qs.anomalies_activite(*args)]


def test_seance_normale_sans_anomalie():
    assert _codes("course", 3600, 10.0, 150, 175, 190) == []
    assert _codes("muscu", 2700, None, None, None, 190) == []


def test_anomalies_de_fc():
    assert _codes("course", 3600, 10.0, 150, 215, 190) == ["fc_pic"]          # 25 bpm au-dessus du profil
    assert _codes("course", 3600, 10.0, 150, 200, 190) == []                  # dans la marge de 12 bpm
    assert _codes("course", 3600, 10.0, 150, 240, None) == ["fc_pic"]         # au-delà de 230, profil ou pas
    assert _codes("course", 3600, 10.0, 180, 170, 190) == ["fc_incoherente"]
    assert _codes("course", 3600, 10.0, 40, 90, 190) == ["fc_basse"]


def test_anomalies_de_gps_et_de_pause():
    assert _codes("course", 1200, 10.0, None, None) == ["gps"]                # 2:00/km
    assert _codes("course", 3600, 3.0, None, None) == ["pause"]               # 20:00/km sur une course
    assert _codes("trail", 3600, 3.0, None, None) == []                       # en trail raide, c'est possible
    assert _codes("velo", 3600, 90.0, None, None) == ["gps"]
    assert _codes("course", 20 * 3600, 100.0, None, None) == ["duree"]


def test_doublons():
    d = datetime(2026, 5, 1, 8, 0)
    seances = [(1, "course", d, 3600), (2, "course", d + timedelta(minutes=3), 3650),   # doublon de 1
               (3, "course", d + timedelta(minutes=5), 1200),                           # durée trop différente
               (4, "velo", d, 3600),                                                    # autre sport
               (5, "course", d + timedelta(hours=3), 3600)]                             # autre moment
    assert qs.doublons(seances) == {2: 1}


def test_anomalies_mesures():
    j = date(2026, 6, 30)
    series = {
        "sommeil": {j: 2.5, j - timedelta(days=1): 7.5},
        "fc_repos": {j - timedelta(days=i): 50.0 for i in range(1, 12)} | {j: 75.0},
        "vfc": {j - timedelta(days=i): 60.0 for i in range(1, 12)} | {j: 200.0, j - timedelta(days=20): 20.0},
    }
    trouve = {(a["type"], a["jour"], a["code"]) for a in qs.anomalies_mesures(series)}
    assert trouve == {("nuit", j, "nuit_tronquee"), ("fc_repos", j, "fc_repos_aberrante"),
                      ("vfc", j, "vfc_aberrante"), ("vfc", j - timedelta(days=20), "vfc_aberrante")}
    # Trop peu de mesures pour connaître l'habitude : on ne juge pas
    assert qs.anomalies_mesures({"fc_repos": {j: 90.0, j - timedelta(days=1): 50.0}}) == []


# ── Sur une base jetable ─────────────────────────────────────────────────────

def _seance(db, user, jour, **champs):
    a = Activite(utilisateur_id=user.id, source="manuel", sport=champs.pop("sport", "course"),
                 debut=datetime.combine(jour, datetime.min.time()) + timedelta(hours=8),
                 duree_sec=champs.pop("duree_sec", 3600), distance_km=champs.pop("distance_km", 10.0), **champs)
    db.add(a)
    db.flush()
    return a


def test_ecarter_puis_reintegrer_ne_touche_pas_la_seance(db, user):
    auj = date(2026, 6, 30)
    saine = _seance(db, user, auj - timedelta(days=2), rpe=5)
    fausse = _seance(db, user, auj - timedelta(days=1), fc_max_bpm=240, rpe=9)
    db.add(MesureSante(utilisateur_id=user.id, type="sommeil", jour=auj, valeur=2.0))
    db.add(MesureSante(utilisateur_id=user.id, type="fc_sommeil", jour=auj, valeur=70.0))
    db.commit()

    pb = qs.anomalies(db, user, auj)
    assert {(a.get("activite_id"), a.get("type_mesure")) for a in pb["liste"]} == {(fausse.id, None), (None, "nuit")}

    e1 = qs.ecarter(db, user, fausse.id, None, None, "capteur")
    qs.ecarter(db, user, None, "nuit", auj, None)
    qs.ecarter(db, user, fausse.id, None, None, "capteur décroché")      # deux fois : une seule ligne, raison mise à jour
    db.commit()
    assert db.query(Exclusion).filter_by(utilisateur_id=user.id).count() == 2
    assert qs.anomalies(db, user, auj)["total"] == 0                     # ce qui est écarté n'est plus signalé

    acts = db.query(Activite).filter_by(utilisateur_id=user.id).all()
    mesures = {"sommeil": {auj: 2.0}, "fc_sommeil": {auj: 70.0}, "fc_repos": {auj: 50.0}}
    gardees = qs.appliquer(acts, mesures, qs.exclusions(db, user.id))
    assert [a.id for a in gardees] == [saine.id]
    assert mesures == {"sommeil": {}, "fc_sommeil": {}, "fc_repos": {auj: 50.0}}   # la nuit entière, rien d'autre

    assert an.charges_quotidiennes(gardees) == {auj - timedelta(days=2): 300.0}
    assert db.get(Activite, fausse.id).fc_max_bpm == 240                 # la séance elle-même est intacte

    assert qs.reintegrer(db, user, e1.id) and not qs.reintegrer(db, user, 10 ** 9)
    db.commit()
    assert len(qs.appliquer(acts, {}, qs.exclusions(db, user.id))) == 2


def test_ecarter_refuse_ce_qui_n_existe_pas(db, user):
    with pytest.raises(ValueError):
        qs.ecarter(db, user, 10 ** 9, None, None, None)
    with pytest.raises(ValueError):
        qs.ecarter(db, user, None, "inconnue", date(2026, 1, 1), None)


def test_journal_ne_note_que_les_changements(db, user):
    j = date(2026, 6, 1)
    reperes = {"vma": (16.0, "hausse", "baisse"), "allure_critique": (250, "mieux", "moins bien")}
    assert qs.journaliser(db, user.id, j, reperes) == 2
    assert qs.journaliser(db, user.id, j, reperes) == 0
    assert qs.journaliser(db, user.id, j + timedelta(days=7),
                          {"vma": (16.3, "hausse", "baisse"), "allure_critique": (246, "mieux", "moins bien"),
                           "fc_seuil": (None, "a", "b")}) == 2
    db.commit()
    lignes = {l["cle"]: l for l in qs.journal(db, user.id)[:2]}
    assert (lignes["vma"]["ancienne"], lignes["vma"]["nouvelle"], lignes["vma"]["cause"]) == (16.0, 16.3, "hausse")
    assert lignes["allure_critique"]["cause"] == "mieux"                 # une allure qui baisse est un progrès
    assert db.query(JournalCalcul).filter_by(utilisateur_id=user.id).count() == 4


def test_causes_reperes():
    auj = date(2026, 6, 30)
    vma = {"actuelle": {"vma": 16.2}, "dernier_test": {"date": "2026-06-25", "vma": 16.0}}
    efforts = {"vc": {"allure_sec_km": 250},
               "courbe": [{"minutes": 5, "label": "5 min", "actuel": {"date": "2026-06-10", "titre": "Fractionné"}},
                          {"minutes": 10, "label": "10 min", "actuel": {"date": "2026-06-20", "titre": None}},
                          {"minutes": 60, "label": "1 h", "actuel": {"date": "2026-06-29", "titre": "Longue"}}]}
    seuil = {"valeur": 171, "date": "2026-05-02", "titre": "10 km"}
    c = qs.causes_reperes(vma, efforts, seuil, auj)
    assert c["vma"][0] == 16.2 and "Test du 25/06/2026" in c["vma"][1]
    assert c["allure_critique"][0] == 250 and "10 min le 20/06/2026" in c["allure_critique"][1]   # 1 h : hors modèle
    assert c["fc_seuil"][0] == 171 and "2/05/2026 (10 km)" in c["fc_seuil"][1]
    assert qs.causes_reperes({"actuelle": None}, {"vc": None}, None, auj) == {}


def test_sauvegarde_hebdomadaire(db, user):
    _seance(db, user, date(2026, 6, 1), titre="Sortie d'essai")
    user.intervals_cle = "cle-qui-ne-doit-pas-sortir"
    db.commit()
    t0 = datetime(2026, 6, 1, 6, 0)
    assert sauv.due(db, user.id, t0)
    fiche = sauv.creer(db, user, maintenant=t0)
    db.commit()
    assert fiche["resume"]["activites"] == 1 and "traces_gps" not in fiche["resume"]
    assert not sauv.due(db, user.id, t0 + timedelta(days=6)) and sauv.due(db, user.id, t0 + timedelta(days=7))

    brut, cree_le = sauv.contenu(db, user.id, fiche["id"])
    donnees = json.loads(brut)
    assert cree_le == t0 and donnees["activites"][0]["titre"] == "Sortie d'essai"
    assert "cle-qui-ne-doit-pas-sortir" not in brut.decode("utf-8") and "password_hash" not in donnees["profil"]
    assert gzip.decompress(db.get(Sauvegarde, fiche["id"]).contenu) == brut
    assert sauv.contenu(db, user.id + 999, fiche["id"]) is None          # jamais la sauvegarde d'un autre compte

    for i in range(1, 6):
        sauv.creer(db, user, maintenant=t0 + timedelta(days=7 * i))
    db.commit()
    gardees = sauv.lister(db, user.id)
    assert len(gardees) == sauv.GARDEES and gardees[0]["cree_le"].startswith("2026-07-06")
    assert db.query(Activite).filter_by(utilisateur_id=user.id).count() == 1   # seules d'anciennes copies partent


def test_cache_des_analyses_invalide_par_une_ecriture(db, user):
    appels = []

    def calculer():
        appels.append(1)
        return {"n": len(appels)}

    assert cache_analyses.obtenir(db, user.id, calculer) == {"n": 1}
    assert cache_analyses.obtenir(db, user.id, calculer) == {"n": 1}     # servi sans recalcul
    _seance(db, user, date(2026, 6, 2))                                   # une séance arrive
    db.commit()
    assert cache_analyses.obtenir(db, user.id, calculer) == {"n": 2}
    db.query(Activite).filter_by(utilisateur_id=user.id).update({"rpe": 6})   # écriture en masse
    db.commit()
    assert cache_analyses.obtenir(db, user.id, calculer) == {"n": 3}
    assert len(appels) == 3


def test_analyses_completes_avec_une_seance_ecartee(db, user):
    """Le calcul complet tient debout de bout en bout sur un compte presque vide et respecte les mises à l'écart."""
    auj = date.today()
    for i in range(2, 9):
        _seance(db, user, auj - timedelta(days=i), rpe=5, fc_moyenne_bpm=150)
    _seance(db, user, auj - timedelta(days=1), rpe=5)
    fausse = _seance(db, user, auj - timedelta(days=1), sport="velo", duree_sec=7200, distance_km=50.0, rpe=10)
    db.commit()
    hier = (auj - timedelta(days=1)).isoformat()

    def charge(res):
        return next(p["charge"] for p in res["forme"]["points"] if p["jour"] == hier)

    avant = an.analyses_du_jour(db, user)
    assert charge(avant) == 300 + 1200 and avant["qualite"]["seances_ecartees"] == 0
    qs.ecarter(db, user, fausse.id, None, None, None)
    db.commit()
    apres = an.analyses_du_jour(db, user)
    assert charge(apres) == 300 and apres["qualite"]["seances_ecartees"] == 1
    assert an.analyses_du_jour(db, user) is apres                        # servi par le cache tant que rien ne change
