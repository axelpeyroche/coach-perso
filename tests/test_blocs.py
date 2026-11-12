"""Lot 2 : séances par blocs, modèles, répétition, envoi sur la montre (Intervals.icu simulé)."""
from datetime import date, timedelta

import pytest

import blocs_service as bl
import carnet_service as cs

DESCRIPTION = """Échauffement : 15' footing facile
Corps de séance : 3 × 10' au seuil (Z4, 4:35–4:45 /km), récup 2' en trottinant
Retour au calme : 10' très facile
Reste relâché."""

ENDURANCE = {"type": "endurance", "consignes": "", "etapes": [
    {"genre": "echauffement", "duree_s": 900, "texte": "facile"},
    {"genre": "corps", "repetitions": 5, "distance_m": 1000, "texte": "VMA 5x Z5", "allure_min": "3:50",
     "allure_max": "4:00", "recup_s": 90, "recup_texte": "trot"},
    {"genre": "retour", "duree_s": 600},
]}


# ── Format Intervals.icu ────────────────────────────────────────────────────

def test_texte_intervals_depuis_description_classique():
    texte, guide = bl.texte_intervals("course", DESCRIPTION, None)
    assert guide
    assert "Corps de séance 3x\n- au seuil 10m 4:35/km-4:45/km Pace\n- trottinant 2m" in texte
    assert "- footing facile 15m" in texte and "- très facile 10m" in texte


def test_texte_intervals_depuis_blocs_neutralise_les_consignes():
    texte, guide = bl.texte_intervals("course", None, ENDURANCE)
    assert guide
    assert "Corps de séance 5x\n- VMA 1km 3:50/km-4:00/km Pace\n- trot 1m30s" in texte
    # au vélo, pas d'allure : la zone (absente ici) ou rien
    velo, _ = bl.texte_intervals("velo", None, ENDURANCE)
    assert "Pace" not in velo


def test_muscu_en_texte_libre():
    texte, guide = bl.texte_intervals("muscu", "1. Pompes : 3 × 10\n- note\n5x", None)
    assert not guide
    assert "\n- " not in texte and "\n5x" not in texte  # rien qu'Intervals lirait comme une étape


def test_description_illisible_part_en_texte_libre():
    texte, guide = bl.texte_intervals("course", "Footing tranquille au feeling", None)
    assert not guide and texte == "Footing tranquille au feeling"


def test_valider_structure():
    assert bl.valider_structure(None) is None
    assert bl.lire_structure(bl.valider_structure(ENDURANCE))["etapes"][1]["repetitions"] == 5
    with pytest.raises(ValueError, match="invalide"):
        bl.valider_structure({"type": "endurance", "etapes": []})
    with pytest.raises(ValueError):
        bl.valider_structure({"type": "endurance", "etapes": [{"genre": "corps", "allure_min": "4h30"}]})
    with pytest.raises(ValueError):
        bl.valider_structure({"type": "autre"})


# ── Protection face aux plans envoyés ───────────────────────────────────────

def test_remplacer_ne_supprime_pas_les_seances_de_l_athlete(db, user):
    lundi = date.today() - timedelta(days=date.today().weekday()) + timedelta(weeks=1)
    base = {"jour": lundi, "sport": "course", "titre": "Footing", "duree_min": 40}
    cs.enregistrer_plan(db, user.id, [
        {**base, "id_externe": "plan-1"},
        {**base, "id_externe": "rec-abc-0"},
        {**base, "id_externe": "manuel-blocs", "structure": bl.valider_structure(ENDURANCE)},
    ])
    db.commit()
    bilan = cs.enregistrer_plan(db, user.id, [{**base, "id_externe": "plan-2"}],
                                remplacer=(lundi, lundi + timedelta(days=6)))
    db.commit()
    restantes = {p.id_externe for p in db.query(cs.SeancePrevue).filter_by(utilisateur_id=user.id)}
    assert bilan["supprime"] == 1
    assert restantes == {"rec-abc-0", "manuel-blocs", "plan-2"}


def test_description_reecrite_efface_les_blocs(db, user):
    lundi = date.today() - timedelta(days=date.today().weekday())
    item = {"jour": lundi, "sport": "course", "titre": "VMA", "id_externe": "x-1", "description": "A",
            "structure": bl.valider_structure(ENDURANCE)}
    cs.enregistrer_plan(db, user.id, [item])
    cs.enregistrer_plan(db, user.id, [{**item, "structure": None, "description": "B"}])
    db.commit()
    p = db.query(cs.SeancePrevue).filter_by(utilisateur_id=user.id, id_externe="x-1").one()
    assert p.description == "B" and p.structure is None


def test_plan_ne_reecrit_pas_une_seance_realisee(db, user):
    lundi = date.today() - timedelta(days=date.today().weekday())
    item = {"jour": lundi, "sport": "muscu", "titre": "Haut du corps", "id_externe": "plan-r", "description": "A"}
    cs.enregistrer_plan(db, user.id, [item])
    db.commit()
    p = db.query(cs.SeancePrevue).filter_by(utilisateur_id=user.id, id_externe="plan-r").one()
    p.deroule = '{"fin": "2026-01-01T10:00:00"}'
    db.commit()
    bilan = cs.enregistrer_plan(db, user.id, [{**item, "titre": "Autre", "description": "B"}],
                                remplacer=(lundi, lundi + timedelta(days=6)))
    db.commit()
    db.refresh(p)
    assert (p.titre, p.description) == ("Haut du corps", "A")
    assert bilan.get("conserve") == 1 and bilan.get("supprime", 0) == 0


# ── Routes ──────────────────────────────────────────────────────────────────

@pytest.fixture()
def api(db):
    from fastapi.testclient import TestClient
    from deps import _create_token
    from main import app
    from models import Utilisateur

    def compte(nom):
        u = Utilisateur(email=f"{nom}-{db.query(Utilisateur).count()}@exemple.test", prenom=nom, nom="Test",
                        fc_max=190, password_hash="empreinte-factice")
        db.add(u)
        db.commit()
        return u, {"Authorization": f"Bearer {_create_token(u)}"}

    return TestClient(app), compte


def test_creation_repetee_modification_et_suppression_de_la_suite(api, db):
    client, compte = api
    _, h = compte("rep")
    lundi = date.today() - timedelta(days=date.today().weekday()) + timedelta(weeks=1)
    r = client.post("/api/plan", headers=h, json={
        "jour": lundi.isoformat(), "sport": "course", "titre": "VMA", "description": DESCRIPTION,
        "structure": ENDURANCE, "repetition": {"toutes": 2, "fois": 4}})
    assert r.status_code == 200, r.text
    assert r.json()["crees"] == 4 and r.json()["structure"]["type"] == "endurance"
    plan = client.get("/api/plan", headers=h, params={"depuis": lundi.isoformat(),
                                                       "jusqu_a": (lundi + timedelta(weeks=8)).isoformat()}).json()
    seances = sorted(plan["seances"], key=lambda s: s["jour"])
    assert [s["jour"] for s in seances] == [(lundi + timedelta(weeks=2 * k)).isoformat() for k in range(4)]

    # Modifier le texte à la main efface les blocs ; changer le sport est permis
    deux = seances[1]["id"]
    r = client.patch(f"/api/plan/{deux}", headers=h, json={"description": "Footing libre", "sport": "Vélo",
                                                          "titre": " Sortie ", "duree_min": 60})
    assert r.status_code == 200, r.text
    assert r.json()["structure"] is None and r.json()["sport"] == "velo" and r.json()["titre"] == "Sortie"
    assert client.patch(f"/api/plan/{deux}", headers=h, json={"titre": "  "}).status_code == 400
    assert client.patch(f"/api/plan/{deux}", headers=h,
                        json={"structure": {"type": "endurance", "etapes": []}}).status_code == 400

    # Une séance commentée de la suite reste
    client.patch(f"/api/plan/{seances[3]['id']}", headers=h, json={"commentaire": "garde-la"})
    r = client.delete(f"/api/plan/{seances[1]['id']}", headers=h, params={"suite": "true"})
    assert r.json()["supprimees"] == 2
    restantes = {s["id"] for s in client.get("/api/plan", headers=h, params={
        "depuis": lundi.isoformat(), "jusqu_a": (lundi + timedelta(weeks=8)).isoformat()}).json()["seances"]}
    assert restantes == {seances[0]["id"], seances[3]["id"]}


def test_seance_realisee_non_modifiable(api, db):
    client, compte = api
    _, h = compte("fait")
    s = client.post("/api/plan", headers=h, json={"sport": "muscu", "titre": "Haut du corps"}).json()
    client.patch(f"/api/plan/{s['id']}", headers=h, json={"deroule": {"fin": "2026-11-12T10:00:00"}})
    assert client.patch(f"/api/plan/{s['id']}", headers=h, json={"titre": "Autre"}).status_code == 400
    # le commentaire reste possible
    assert client.patch(f"/api/plan/{s['id']}", headers=h, json={"commentaire": "ok"}).status_code == 200


def test_modeles_isoles_par_compte(api, db):
    client, compte = api
    _, h1 = compte("m1")
    _, h2 = compte("m2")
    r = client.post("/api/modeles", headers=h1, json={"nom": "VMA courte", "sport": "Course", "titre": "VMA",
                                                      "structure": ENDURANCE})
    assert r.status_code == 200, r.text
    mid = r.json()["id"]
    assert r.json()["sport"] == "course" and r.json()["structure"]["etapes"][0]["genre"] == "echauffement"
    assert [m["id"] for m in client.get("/api/modeles", headers=h1).json()] == [mid]
    assert client.get("/api/modeles", headers=h2).json() == []
    assert client.delete(f"/api/modeles/{mid}", headers=h2).status_code == 404
    assert client.delete(f"/api/modeles/{mid}", headers=h1).status_code == 200
    assert client.post("/api/modeles", headers=h1, json={"nom": " ", "sport": "course", "titre": "x"}).status_code == 400


def test_envoi_montre(api, db, monkeypatch):
    import intervals_service as iv
    import suivi_service as sv
    client, compte = api
    u, h = compte("montre")
    lundi = date.today() - timedelta(days=date.today().weekday()) + timedelta(weeks=1)
    s = client.post("/api/plan", headers=h, json={"jour": lundi.isoformat(), "sport": "course", "titre": "Seuil",
                                                  "description": DESCRIPTION, "duree_min": 50}).json()
    # Sans Intervals.icu : 409
    assert client.post(f"/api/plan/{s['id']}/montre", headers=h, json={"jour": lundi.isoformat()}).status_code == 409

    u.intervals_cle, u.intervals_athlete_id = "cle-factice", "i42"
    db.commit()
    appels = []

    def faux_appel(cle, chemin, params=None, methode="GET", corps=None, introuvable=None):
        appels.append((methode, chemin, corps))
        if methode == "PUT":
            raise iv.IntervalsIntrouvable("absente")
        return {"id": 777} if methode == "POST" else None

    monkeypatch.setattr(iv, "_appel", faux_appel)
    monkeypatch.setattr(sv, "aujourdhui", lambda user: lundi)

    # Hors de la semaine ou dans le passé : refusé
    assert client.post(f"/api/plan/{s['id']}/montre", headers=h,
                       json={"jour": (lundi + timedelta(days=7)).isoformat()}).status_code == 400
    assert client.post(f"/api/plan/{s['id']}/montre", headers=h,
                       json={"jour": (lundi - timedelta(days=1)).isoformat()}).status_code == 400

    jeudi = lundi + timedelta(days=3)
    r = client.post(f"/api/plan/{s['id']}/montre", headers=h, json={"jour": jeudi.isoformat()})
    assert r.status_code == 200, r.text
    assert r.json()["jour"] == jeudi.isoformat()
    assert r.json()["montre"] == {"jour": jeudi.isoformat(), "le": r.json()["montre"]["le"], "a_jour": True}
    methode, chemin, corps = appels[-1]
    assert methode == "POST" and chemin == "/athlete/i42/events"
    assert corps["category"] == "WORKOUT" and corps["type"] == "Run" and corps["moving_time"] == 3000
    assert corps["start_date_local"] == f"{jeudi.isoformat()}T00:00:00"
    assert "Corps de séance 3x" in corps["description"]

    # Modifiée depuis l'envoi
    r = client.patch(f"/api/plan/{s['id']}", headers=h, json={"duree_min": 55})
    assert r.json()["montre"]["a_jour"] is False
    # Renvoi : PUT (absente côté Intervals) puis POST
    client.post(f"/api/plan/{s['id']}/montre", headers=h, json={"jour": jeudi.isoformat()})
    assert [a[0] for a in appels[-2:]] == ["PUT", "POST"]
    # Déplacée à un autre jour après l'envoi : plus à jour
    r = client.patch(f"/api/plan/{s['id']}", headers=h, json={"jour": (jeudi + timedelta(days=1)).isoformat()})
    assert r.json()["montre"]["a_jour"] is False
    r = client.patch(f"/api/plan/{s['id']}", headers=h, json={"jour": jeudi.isoformat()})
    assert r.json()["montre"]["a_jour"] is True

    # Erreur Intervals : 502, rien n'est modifié
    def en_panne(*a, **k):
        raise iv.IntervalsErreur("Intervals.icu ne répond pas, réessaie plus tard")
    monkeypatch.setattr(iv, "_appel", en_panne)
    vendredi = lundi + timedelta(days=4)
    r = client.post(f"/api/plan/{s['id']}/montre", headers=h, json={"jour": vendredi.isoformat()})
    assert r.status_code == 502 and "ne répond pas" in r.json()["detail"]
    plan = client.get("/api/plan", headers=h, params={"depuis": lundi.isoformat(),
                                                       "jusqu_a": (lundi + timedelta(days=6)).isoformat()}).json()
    assert plan["seances"][0]["jour"] == jeudi.isoformat()

    # Retrait (DELETE)
    monkeypatch.setattr(iv, "_appel", faux_appel)
    r = client.delete(f"/api/plan/{s['id']}/montre", headers=h)
    assert r.json()["montre"] is None and appels[-1][0] == "DELETE"
    assert appels[-1][1] == "/athlete/i42/events/777"

    # Autre compte : 404
    _, h2 = compte("intrus")
    assert client.post(f"/api/plan/{s['id']}/montre", headers=h2, json={"jour": jeudi.isoformat()}).status_code == 404


def test_envoi_retrouve_une_seance_deja_creee(monkeypatch):
    """Réponse perdue au premier envoi : le renvoi met à jour l'événement au lieu d'en créer un second."""
    import intervals_service as iv
    from models import Utilisateur
    u = Utilisateur(email="x@exemple.test", intervals_cle="cle", intervals_athlete_id="i1")
    appels = []

    def faux_appel(cle, chemin, params=None, methode="GET", corps=None, introuvable=None):
        appels.append((methode, chemin))
        if methode == "GET":
            return [{"id": 5, "external_id": "autre"}, {"id": 9, "external_id": "carnet-12"}]
        return {"id": 9}

    monkeypatch.setattr(iv, "_appel", faux_appel)
    corps = {"external_id": "carnet-12", "start_date_local": "2026-11-19T00:00:00"}
    assert iv.envoyer_seance(u, corps) == "9"
    assert appels[-1] == ("PUT", "/athlete/i1/events/9") and not any(m == "POST" for m, _ in appels)
