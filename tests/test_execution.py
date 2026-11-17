"""Séances d'intensité : ce qui part vers la montre, puis le respect du plan étape par étape."""
import json
from datetime import date, datetime
from types import SimpleNamespace

import blocs_service as bl
import carnet_service as cs
import decoupage as dc
import execution_service as ex
import seance_service as ss
from models import Activite, SeancePrevue

FARTLEK = """Échauffement : 20' en endurance fondamentale, FC sous 145, + 2 lignes droites.
Corps de séance : 6 × 1' allure 10 km (environ 4'55-5'00/km, souple, RPE 7) · 1'30 de trot très lent entre chaque.
Retour au calme : 10' de trot très facile + 5' de marche, étirements doux fessiers / mollets."""

SEUIL = """Échauffement : 15' de trot en EF (FC sous 140), puis 3 lignes droites de 80 m.
Corps de séance : 3 × 8' au seuil · 2' de trot lent entre chaque. Allure cible 4'40-4'45/km, FC 165-175.
Retour au calme : 10' de trot facile."""

VMA = """Échauffement : 20 min footing
Corps de séance : 10 × 400 m à 3'45/km, récup 200 m trot
Retour au calme : 10 min tranquille"""


def _plan(description, titre="Fartlek court sur le plat : 6 × 1 min", sport="course", ident=7):
    return SimpleNamespace(id=ident, titre=titre, description=description, structure=None, sport=sport)


def _seance(segments, sport="course"):
    """Enregistrement à 1 point par seconde : segments = [(durée s, allure s/km, FC)]."""
    temps, dist, fc = [0], [0.0], [segments[0][2]]
    for duree, allure, bpm in segments:
        for _ in range(int(duree)):
            temps.append(temps[-1] + 1)
            dist.append(dist[-1] + 1000.0 / allure)
            fc.append(bpm)
    return dc.Seance(temps, dist, [100.0] * len(temps), fc, None, sport)


def _fartlek(efforts, recups, echauffement=1200, retour=600, marche=300, allure=297):
    seg = [(echauffement, 390, 130)]
    for i, d in enumerate(efforts):
        seg.append((d, allure, 165))
        if i < len(recups):
            seg.append((recups[i], 420, 145))
    if retour:
        seg.append((retour, 400, 135))
    if marche:
        seg.append((marche, 720, 105))
    return _seance(seg)


def _roles(r, role):
    return [x for x in r["etapes"] if x["role"] == role]


# ── Vers la montre ──────────────────────────────────────────────────────────

def test_fartlek_envoye_tel_que_prevu():
    texte, guide = bl.texte_intervals("course", FARTLEK, None)
    assert guide
    assert "Échauffement\n- endurance fondamentale 20m" in texte
    # 6 efforts d'une minute à l'allure visée, puis 1 min 30 de récupération sans allure imposée
    assert "Corps de séance 6x\n- 1m 4:55/km-5:00/km Pace\n- trot très lent 1m30s" in texte
    assert "- trot très facile 10m" in texte and "- marche 5m" in texte
    lignes = [l for l in texte.splitlines() if l.startswith("- ")]
    assert [l for l in lignes if "Pace" in l] == ["- 1m 4:55/km-5:00/km Pace"]


def test_etapes_lues_dans_la_description():
    e = bl.etapes_depuis_description(FARTLEK)
    assert [(x["genre"], x["repetitions"], x["duree_s"]) for x in e] == [
        ("echauffement", 1, 1200), ("corps", 6, 60), ("retour", 1, 600), ("retour", 1, 300)]
    assert (e[1]["recup_s"], e[1]["allure_min"], e[1]["allure_max"], e[0]["fc_max"]) == (90, "4:55", "5:00", 145)
    e = bl.etapes_depuis_description(VMA)
    assert (e[1]["repetitions"], e[1]["distance_m"], e[1]["recup_m"], e[1]["allure_min"]) == (10, 400, 200, "3:45")
    texte, _ = bl.texte_intervals("course", SEUIL, None)
    assert "Corps de séance 3x\n- au seuil 8m 4:40/km-4:45/km Pace\n- trot lent 2m" in texte


# ── Reconnaissance du type ──────────────────────────────────────────────────

def test_type_fartlek():
    assert ss.type_du_texte("Fartlek court sur le plat : 6 × 1 min") == "fartlek"
    assert ss.type_du_plan(_plan(FARTLEK)) == "fartlek"
    assert ss.type_du_plan(_plan(SEUIL, "Seuil 3 × 8 min")) == "seuil"
    assert ss.type_du_plan(_plan("45 min en endurance fondamentale", "Footing EF")) is None
    assert ss.type_du_plan(_plan(FARTLEK, sport="velo")) is None
    assert cs.FAMILLES_TYPE["fartlek"] == "intense" and cs.TYPES_SEANCE["fartlek"] == "Fartlek"


# ── Respect du plan ─────────────────────────────────────────────────────────

def test_plan_respecte():
    r = ex.analyser(_plan(FARTLEK), _fartlek([60] * 6, [90] * 5), None, "intervals")
    assert r["mode"] == "allure" and r["type"] == "fartlek"
    assert [x["role"] for x in r["etapes"]] == ["echauffement"] + ["effort", "recup"] * 5 + ["effort", "retour", "retour"]
    efforts = _roles(r, "effort")
    assert all(x["etat"] == "ok" and x["etat_allure"] == "ok" for x in efforts)
    assert all(abs(x["fait"]["duree_sec"] - 60) <= 8 for x in efforts)
    assert all(abs(x["fait"]["duree_sec"] - 90) <= 10 for x in _roles(r, "recup"))
    assert abs(r["etapes"][0]["fait"]["duree_sec"] - 1200) <= 10 and r["etapes"][0]["etat_fc"] == "ok"
    res = r["resume"]
    assert (res["efforts_prevus"], res["efforts_faits"], res["efforts_mesure_ok"]) == (6, 6, 6)
    assert res["note"] >= 85 and res["verdict"] == "Plan suivi de près"


def test_efforts_trop_rapides_et_trop_longs():
    r = ex.analyser(_plan(FARTLEK), _fartlek([90, 62, 40, 85, 110, 30], [140, 110, 90, 70, 120],
                                             retour=330, marche=0, allure=260), None, "intervals")
    efforts = _roles(r, "effort")
    assert len(efforts) == 6 and all(x["fait"] for x in efforts)
    assert [x["etat"] for x in efforts] == ["plus", "ok", "moins", "plus", "plus", "moins"]
    assert all(x["etat_allure"] == "rapide" for x in efforts)
    assert r["etapes"][-1]["etat"] == "absent"  # la marche finale n'a pas été faite
    assert r["resume"]["note"] < 65
    assert any("plus rapides" in p for p in r["phrases"])


def test_efforts_manquants():
    r = ex.analyser(_plan(FARTLEK), _fartlek([60] * 4, [90] * 3), None, "intervals")
    assert r["resume"]["efforts_faits"] == 4 and r["resume"]["efforts_prevus"] == 6
    assert sum(1 for x in _roles(r, "effort") if x["etat"] == "absent") == 2


def test_seuil_par_les_tours_de_la_montre():
    seg = [(900, 390, 130)]
    for i in range(3):
        seg += [(480, 283, 170)] + ([(120, 420, 150)] if i < 2 else [])
    seg.append((600, 400, 135))
    tours, t = [], 0
    for duree, _, _ in seg:
        tours.append({"start_index": t, "end_index": t + duree})
        t += duree
    r = ex.analyser(_plan(SEUIL, "Seuil 3 × 8 min"), _seance(seg), tours, "intervals")
    assert r["mode"] == "tours" and r["type"] == "seuil"
    efforts = _roles(r, "effort")
    assert len(efforts) == 3 and all(x["etat"] == "ok" and x["etat_allure"] == "ok" and x["etat_fc"] == "ok" for x in efforts)
    assert r["resume"]["verdict"] == "Plan suivi de près"


def test_fractionne_en_distance():
    seg = [(1200, 390, 130)]
    for i in range(10):
        seg += [(90, 225, 175)] + ([(75, 420, 150)] if i < 9 else [])
    seg.append((600, 400, 135))
    r = ex.analyser(_plan(VMA, "VMA 10 × 400 m"), _seance(seg), None, "intervals")
    efforts = _roles(r, "effort")
    assert r["mode"] == "allure" and len(efforts) == 10
    assert all(x["fait"] and abs(x["fait"]["distance_m"] - 400) <= 50 for x in efforts)
    assert all(x["etat_allure"] == "ok" for x in efforts)


def test_sorties_faciles_non_analysees():
    footing = _seance([(2700, 390, 135)])
    assert ex.analyser(_plan("45 min en endurance fondamentale, FC sous 145", "Footing EF"), footing) is None
    longue = "Échauffement : 10' très facile\nCorps de séance : 1 h 30 en endurance fondamentale\nRetour au calme : 5' de marche"
    assert ex.analyser(_plan(longue, "Sortie longue"), footing) is None


def test_etapes_introuvables():
    # sortie à allure constante : aucune des étapes prévues n'est visible, et on le dit
    r = ex.analyser(_plan(FARTLEK), _seance([(2400, 390, 135)]), None, "trace")
    assert r["mode"] == "theorique" and r["resume"]["note"] is None
    assert r["resume"]["verdict"] == "Étapes non repérées dans l'enregistrement"


# ── Dans le carnet ──────────────────────────────────────────────────────────

def test_bilan_de_la_fiche(db, user, monkeypatch):
    import intervals_service as iv
    jour = date(2026, 11, 15)
    a = Activite(utilisateur_id=user.id, sport="course", debut=datetime(2026, 11, 15, 10), duree_sec=2850,
                 distance_km=7.4, fc_moyenne_bpm=140, titre="Fartlek court")
    db.add(a)
    db.flush()
    p = SeancePrevue(utilisateur_id=user.id, jour=jour, sport="course", titre="Fartlek court sur le plat : 6 × 1 min",
                     description=FARTLEK, duree_min=48, activite_id=a.id)
    db.add(p)
    db.flush()
    appels = []

    def brute(u, act, points):
        appels.append(act.id)
        return _fartlek([60] * 6, [90] * 5), None, "intervals"

    monkeypatch.setattr(iv, "seance_brute", brute)
    b = ss.bilan(db, user, a)
    assert b["type"]["cle"] == "fartlek"
    assert b["execution"]["mode"] == "allure" and b["execution"]["prevue_id"] == p.id
    assert b["repetitions"] is None and len(b["phrases"]) == 3
    det = json.loads(a.details)
    assert det["seance"]["prevue"] == p.id and det["execution"]["resume"]["efforts_faits"] == 6
    # gardée : pas de second calcul, et le détail des étapes ne voyage pas dans les listes
    ss.bilan(db, user, a)
    assert appels == [a.id]
    assert "etapes" not in cs.serialiser_activite(a)["details"]["execution"]
    # le plan change : l'analyse est refaite
    p.description = FARTLEK.replace("6 × 1'", "8 × 1'")
    assert ss.bilan(db, user, a)["execution"]["resume"]["efforts_prevus"] == 8
    assert len(appels) == 2
    # export : une section dédiée, avec le tableau des étapes
    md = "\n".join(ex.texte_markdown({"jour": "2026-11-15", **b["execution"]}))
    assert "| Effort 6/6 |" in md and "Plan suivi de près" in md
    # séance détachée du plan : plus d'analyse, le type redevient celui de l'enregistrement
    p.activite_id = None
    db.flush()
    assert ss.bilan(db, user, a)["execution"] is None
