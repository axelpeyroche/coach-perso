"""Comptes invités : inscription sur invitation, isolation des données, formulations grand public."""
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import deps
import formulation
from models import Activite, Invitation, Utilisateur

RACINE = Path(__file__).resolve().parent.parent
ADMIN = "admin@exemple.test"


@pytest.fixture()
def client(monkeypatch):
    from main import app
    monkeypatch.setattr(deps, "_ADMIN_EMAILS", {ADMIN})
    formulation._admin_par_id.clear()
    deps._tentatives.clear()
    with TestClient(app) as c:
        yield c
    formulation._admin_par_id.clear()


def _jeton(user_id: int) -> dict:
    import database
    from deps import _create_token
    db = database.SessionLocal()
    try:
        return {"Authorization": f"Bearer {_create_token(db.get(Utilisateur, user_id))}"}
    finally:
        db.close()


def _compte(db, email: str) -> Utilisateur:
    u = db.query(Utilisateur).filter(Utilisateur.email == email).first()
    if not u:
        u = Utilisateur(email=email, prenom="Test", nom="Compte", fc_max=190, password_hash="empreinte-factice")
        db.add(u)
        db.commit()
    return u


def _invitation(db, **champs) -> Invitation:
    import secrets
    maintenant = datetime.utcnow()
    inv = Invitation(code=secrets.token_hex(4).upper(), cree_le=maintenant,
                     expire_le=maintenant + timedelta(days=14), **champs)
    db.add(inv)
    db.commit()
    return inv


def _inscription(client, code, consentement=True, email=None):
    import secrets
    return client.post("/api/auth/register", json={
        "prenom": "Ami", "nom": "Invité", "email": email or f"ami{secrets.token_hex(3)}@exemple.test",
        "password": "Motdepasse-tres-solide-42", "code_invitation": code, "consentement_sante": consentement,
    })


# ── Inscription ───────────────────────────────────────────────────────────────

def test_inscription_sur_invitation(client, db):
    _compte(db, ADMIN)
    assert client.get("/api/auth/inscriptions").json()["mode"] == "invitation"
    inv = _invitation(db)
    code = f"{inv.code[:4]}-{inv.code[4:].lower()}"  # tiret et minuscules tolérés
    assert client.post("/api/auth/invitation", json={"code": code}).json()["valide"] is True
    r = _inscription(client, code)
    assert r.status_code == 200, r.text
    db.refresh(inv)
    assert inv.utilisee_le and inv.utilisee_par_id == r.json()["user_id"]
    assert db.get(Utilisateur, inv.utilisee_par_id).consentement_sante_le is not None
    # Usage unique
    assert _inscription(client, code).status_code == 403
    assert client.post("/api/auth/invitation", json={"code": code}).json()["valide"] is False


def test_inscription_refusee_sans_code_valide(client, db):
    _compte(db, ADMIN)
    assert _inscription(client, None).status_code == 403
    assert _inscription(client, "ZZZZ-ZZZZ").status_code == 403
    revoquee = _invitation(db, revoquee=True)
    assert _inscription(client, revoquee.code).status_code == 403
    expiree = _invitation(db)
    expiree.expire_le = datetime.utcnow() - timedelta(minutes=1)
    db.commit()
    assert _inscription(client, expiree.code).status_code == 403


def test_inscription_exige_le_consentement(client, db):
    _compte(db, ADMIN)
    inv = _invitation(db)
    assert _inscription(client, inv.code, consentement=False).status_code == 400
    db.refresh(inv)
    assert inv.utilisee_le is None  # le code reste utilisable


# ── Administration ────────────────────────────────────────────────────────────

def test_invitations_reservees_a_l_admin(client, db):
    admin = _compte(db, ADMIN)
    invite = _compte(db, "invite-admin@exemple.test")
    assert client.get("/api/admin/invitations", headers=_jeton(invite.id)).status_code == 403
    assert client.post("/api/admin/invitations", json={}, headers=_jeton(invite.id)).status_code == 403
    r = client.post("/api/admin/invitations", json={"note": "Léa", "jours": 7}, headers=_jeton(admin.id))
    assert r.status_code == 200
    cree = r.json()
    assert cree["statut"] == "active" and len(cree["code"]) == 9 and cree["code"][4] == "-"
    assert client.post(f"/api/admin/invitations/{cree['id']}/revoquer", headers=_jeton(invite.id)).status_code == 403
    assert client.post(f"/api/admin/invitations/{cree['id']}/revoquer", headers=_jeton(admin.id)).json()["statut"] == "revoquee"
    liste = client.get("/api/admin/invitations", headers=_jeton(admin.id)).json()
    assert any(i["id"] == cree["id"] for i in liste["invitations"])
    assert client.get("/api/auth/me", headers=_jeton(admin.id)).json()["est_admin"] is True
    assert client.get("/api/auth/me", headers=_jeton(invite.id)).json()["est_admin"] is False


# ── Isolation des comptes ─────────────────────────────────────────────────────

def test_un_compte_ne_voit_pas_les_seances_d_un_autre(client, db):
    a = _compte(db, "isolation-a@exemple.test")
    b = _compte(db, "isolation-b@exemple.test")
    act = Activite(utilisateur_id=a.id, sport="course", titre="Sortie de A", debut=datetime(2026, 11, 1, 8),
                   duree_sec=3600, distance_km=10)
    db.add(act)
    db.commit()
    assert client.get(f"/api/activites/{act.id}", headers=_jeton(a.id)).status_code == 200
    assert client.get(f"/api/activites/{act.id}", headers=_jeton(b.id)).status_code == 404
    assert client.put(f"/api/activites/{act.id}", json={"sport": "course", "titre": "Piraté", "debut": "2026-11-01T08:00:00"}, headers=_jeton(b.id)).status_code == 404
    assert client.delete(f"/api/activites/{act.id}", headers=_jeton(b.id)).status_code == 404
    liste = client.get("/api/activites", headers=_jeton(b.id)).json()
    assert "Sortie de A" not in str(liste)
    db.refresh(act)
    assert act.titre == "Sortie de A"


# ── Formulations grand public ─────────────────────────────────────────────────

def test_formulations_toujours_presentes_dans_les_sources():
    """Si un texte source change, le remplacement ne s'applique plus : ce test le signale."""
    import re
    sources = "".join(p.read_text(encoding="utf-8") for p in RACINE.glob("*.py") if p.name != "formulation.py")
    sources = re.sub(r'"\s*\n\s*f?"', "", sources)  # chaînes Python coupées sur deux lignes
    for ancien, _ in formulation.REMPLACEMENTS:
        assert ancien in sources, f"Texte introuvable dans les sources : {ancien!r}"


def test_neutre_ne_modifie_pas_l_original():
    original = {"alerte": ["Signes de maladie possible"], "n": 3}
    copie = formulation.neutre(original)
    assert copie == {"alerte": ["FC de repos inhabituelle"], "n": 3}
    assert original["alerte"][0] == "Signes de maladie possible"
    for ancien, _ in formulation.REMPLACEMENTS:
        assert "maladie" not in formulation.neutre(ancien) and "infection" not in formulation.neutre(ancien)


def test_reponses_reformulees_pour_les_invites_seulement(client, db):
    from main import app
    if not any(getattr(r, "path", "") == "/api/_essai_formulation" for r in app.routes):
        app.add_api_route("/api/_essai_formulation", lambda: {"etat": "Signes de maladie possible"})
    admin = _compte(db, ADMIN)
    invite = _compte(db, "invite-texte@exemple.test")
    assert client.get("/api/_essai_formulation", headers=_jeton(admin.id)).json()["etat"] == "Signes de maladie possible"
    assert client.get("/api/_essai_formulation", headers=_jeton(invite.id)).json()["etat"] == "FC de repos inhabituelle"


# ── Synchro du matin ──────────────────────────────────────────────────────────

def test_synchro_matin_des_autres_comptes(monkeypatch, db):
    from routers import intervals
    a = _compte(db, "synchro-a@exemple.test")
    b = _compte(db, "synchro-b@exemple.test")
    c = _compte(db, "synchro-c@exemple.test")
    a.intervals_cle = b.intervals_cle = "cle-factice"
    c.intervals_cle = None
    db.commit()
    vus = []

    def faux_passage(session, user, *args, **kwargs):
        vus.append(user.id)
        if user.id == b.id:
            raise RuntimeError("Intervals indisponible")

    monkeypatch.setattr(intervals, "passage_matin", faux_passage)
    bilan = intervals.synchro_matin_autres_comptes(sauf_id=a.id)
    assert a.id not in vus and c.id not in vus and b.id in vus
    assert bilan["erreurs"] >= 1
