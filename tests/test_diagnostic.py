"""Diagnostic de connexion montre → Intervals.icu → carnet (sans appel réseau)."""
from datetime import datetime, timedelta

import diagnostic_service as diag

MAINTENANT = datetime(2026, 11, 12, 9, 0)


def _par_id(points):
    return {p["id"]: p for p in points}


def _act(i, gps=True, fc=True, distance=8000, trainer=False):
    return {"id": f"i{i}", "start_date_local": f"2026-11-{i:02d}T08:00:00", "distance": distance, "trainer": trainer,
            "stream_types": ["time", "heartrate"] + (["latlng"] if gps else []), "average_heartrate": 150 if fc else None}


def _jour(j, **champs):
    return {"id": f"2026-11-{j:02d}", **champs}


def test_tout_arrive():
    acts = [_act(i) for i in range(1, 6)]
    wellness = [_jour(j, sleepSecs=27000, DeepSleep=4000, restingHR=50, hrv=60, steps=9000, weight=70)
                for j in range(1, 13)]
    pts = diag.controles("apple", acts, wellness, {a["id"] for a in acts}, MAINTENANT - timedelta(hours=2), MAINTENANT)
    assert all(p["statut"] == "ok" for p in pts), [p for p in pts if p["statut"] != "ok"]
    assert all(p["conseil"] is None and p["action"] is None for p in pts)
    assert diag.resume(pts)["etat"] == "ok"
    assert "la dernière le 5 nov." in _par_id(pts)["seances"]["detail"]


def test_aucune_seance_conseil_selon_la_montre():
    apple = _par_id(diag.controles("apple", [], [], set(), None, MAINTENANT))
    garmin = _par_id(diag.controles("garmin", [], [], set(), None, MAINTENANT))
    assert apple["seances"]["statut"] == "absent" and "Companion" in apple["seances"]["conseil"]
    assert "Garmin" in garmin["seances"]["conseil"] and "Connections" in garmin["seances"]["conseil"]
    assert "carnet" not in apple and "gps" not in apple  # rien à comparer sans séance
    assert apple["synchro"]["action"] == "synchro"
    assert diag.resume(list(apple.values()))["etat"] == "probleme"


def test_seances_manquantes_gps_et_fc_partiels():
    acts = [_act(1), _act(2, gps=False), _act(3, fc=False), _act(4, trainer=True, gps=False), _act(5, distance=0, gps=False)]
    pts = _par_id(diag.controles("coros", acts, [], {"i1", "i2"}, MAINTENANT, MAINTENANT))
    assert pts["carnet"]["statut"] == "partiel" and pts["carnet"]["action"] == "synchro"
    assert "3 séances" in pts["carnet"]["detail"]
    # Home-trainer et séance sans distance : pas de tracé attendu
    assert pts["gps"]["statut"] == "partiel" and "2 séances en extérieur sur 3" in pts["gps"]["detail"]
    assert pts["fc"]["statut"] == "partiel" and "4 séances sur 5" in pts["fc"]["detail"]


def test_donnees_de_forme_et_facultatifs():
    wellness = [_jour(j, sleepSecs=26000, restingHR=52) for j in range(1, 10)] + [_jour(10, sleepSecs=0)]
    acts = [_act(1)]
    pts = _par_id(diag.controles("polar", acts, wellness, {"i1"}, MAINTENANT, MAINTENANT))
    assert pts["sommeil"]["statut"] == "ok" and pts["fc_repos"]["statut"] == "ok"
    assert pts["phases"]["statut"] == "absent" and pts["phases"]["facultatif"]
    assert pts["poids"]["statut"] == "absent" and "Facultatif" in pts["poids"]["conseil"]
    # Seuls des facultatifs manquent : ça marche, avec des données en moins
    assert diag.resume(list(pts.values()))["etat"] == "partiel"


def test_sommeil_rare_et_synchro_ancienne():
    wellness = [_jour(j, sleepSecs=26000) for j in range(1, 4)]
    pts = _par_id(diag.controles(None, [_act(1)], wellness, {"i1"}, MAINTENANT - timedelta(days=3), MAINTENANT))
    assert pts["sommeil"]["statut"] == "partiel" and "3 jours" in pts["sommeil"]["detail"]
    assert pts["fc_repos"]["statut"] == "absent"
    assert pts["synchro"]["statut"] == "partiel" and "3 jours" in pts["synchro"]["detail"]
    assert diag.resume(list(pts.values()))["etat"] == "probleme"


def test_routes_montre_et_diagnostic_sans_liaison(db):
    from fastapi.testclient import TestClient
    from deps import _create_token
    from main import app
    from models import Utilisateur
    u = Utilisateur(email="diag@exemple.test", prenom="Diag", nom="Test", fc_max=190, password_hash="empreinte-factice")
    db.add(u)
    db.commit()
    entetes = {"Authorization": f"Bearer {_create_token(u)}"}
    client_api = TestClient(app)
    assert client_api.put("/api/intervals/montre", json={"montre": "garmin"}, headers=entetes).json()["montre"] == "garmin"
    assert client_api.put("/api/intervals/montre", json={"montre": "nokia"}, headers=entetes).status_code == 422
    r = client_api.get("/api/intervals/diagnostic", headers=entetes).json()
    assert r["montre"] == "garmin"
    assert r["points"][0]["id"] == "connexion" and r["points"][0]["statut"] == "absent"
    assert r["resume"]["etat"] == "probleme"
