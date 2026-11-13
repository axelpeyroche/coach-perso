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


# ── Assistant « Mon IA crée mon plan » ───────────────────────────────────────

def test_assistant_ia_enregistre_les_reponses_par_compte(client, db):
    a, b = _compte(db, "ia-a@exemple.test"), _compte(db, "ia-b@exemple.test")
    vide = client.get("/api/assistant-ia", headers=_jeton(a.id)).json()
    assert vide["rempli"] is False and vide["niveau"] == "semi" and set(vide["dispos"]) == {"lun", "mar", "mer", "jeu", "ven", "sam", "dim"}

    r = client.put("/api/assistant-ia", headers=_jeton(a.id), json={
        "ia": "chatgpt", "objectif": "  10 km en 50 min  ", "sports": ["course", "Footing", "muscu"],
        "dispos": {"mar": 45, "sam": 90}, "contraintes": "genou droit sensible", "niveau": "semi"})
    assert r.status_code == 200
    lu = client.get("/api/assistant-ia", headers=_jeton(a.id)).json()
    assert lu["rempli"] is True and lu["ia"] == "chatgpt" and lu["objectif"] == "10 km en 50 min"
    assert lu["sports"] == ["course", "muscu"]                      # normalisés, sans doublon
    assert lu["dispos"]["mar"] == 45 and lu["dispos"]["lun"] == 0
    # l'autre compte ne voit rien de ces réponses
    assert client.get("/api/assistant-ia", headers=_jeton(b.id)).json()["rempli"] is False
    assert client.get("/api/assistant-ia").status_code == 401


def test_assistant_ia_refuse_les_valeurs_hors_limites(client, db):
    u = _compte(db, "ia-c@exemple.test")
    base = {"ia": "claude", "sports": ["course"], "dispos": {"lun": 60}}
    for mauvais in ({"ia": "skynet"}, {"dispos": {"lundi": 60}}, {"dispos": {"lun": 5000}}, {"dispos": {"lun": -5}},
                    {"niveau": "total"}, {"objectif": "x" * 601}):
        assert client.put("/api/assistant-ia", headers=_jeton(u.id), json={**base, **mauvais}).status_code in (400, 422)
    assert client.get("/api/assistant-ia", headers=_jeton(u.id)).json()["rempli"] is False


def test_envoi_automatique_reserve_au_jeton_du_compte(client, db):
    """Le niveau automatique passe par /api/claude/plan : le jeton d'un compte n'écrit que dans son plan."""
    from models import SeancePrevue
    a, b = _compte(db, "ia-d@exemple.test"), _compte(db, "ia-e@exemple.test")
    jeton = client.get("/api/claude/token", headers=_jeton(a.id)).json()["claude_token"]
    corps = {"seances": [{"jour": "2030-01-07", "sport": "course", "titre": "Footing", "id_externe": "2030-01-07-footing"}],
             "remplacer": {"depuis": "2030-01-07", "jusqu_a": "2030-01-13"}}
    assert client.post("/api/claude/plan", json=corps).status_code == 401
    assert client.post("/api/claude/plan", json=corps, headers={"X-Carnet-Token": "x" * 40}).status_code == 401
    r = client.post("/api/claude/plan", json=corps, headers={"X-Carnet-Token": jeton})
    assert r.status_code == 200 and r.json()["ok"] is True and r.json()["cree"] == 1
    assert client.get("/api/claude/export?format=md", headers={"X-Carnet-Token": jeton}).status_code == 200
    db.expire_all()
    assert db.query(SeancePrevue).filter_by(utilisateur_id=a.id).count() == 1
    assert db.query(SeancePrevue).filter_by(utilisateur_id=b.id).count() == 0


def test_assistant_ia_cloisonne_et_relit_sans_erreur(client, db):
    a, b = _compte(db, "ia-f@exemple.test"), _compte(db, "ia-g@exemple.test")
    client.put("/api/assistant-ia", headers=_jeton(a.id), json={"ia": "gemini", "sports": ["velo"], "dispos": {"lun": 60}})
    client.put("/api/assistant-ia", headers=_jeton(b.id), json={"ia": "lechat", "sports": ["natation"], "dispos": {"dim": 30}})
    la, lb = (client.get("/api/assistant-ia", headers=_jeton(x.id)).json() for x in (a, b))
    assert la["ia"] == "gemini" and la["sports"] == ["velo"] and la["dispos"]["lun"] == 60 and la["dispos"]["dim"] == 0
    assert lb["ia"] == "lechat" and lb["sports"] == ["natation"] and lb["dispos"]["dim"] == 30
    # un booléen n'est pas une durée
    assert client.put("/api/assistant-ia", headers=_jeton(a.id), json={"dispos": {"lun": True}}).status_code == 422
    # une valeur mal formée en base retombe sur les défauts, sans erreur
    for brut in ('{"dispos": {"lun": "abc", "mar": [60]}, "sports": "course", "ia": 3, "objectif": 12}', "[1, 2]", "{pas du json"):
        a.reglages_ia = brut
        db.commit()
        r = client.get("/api/assistant-ia", headers=_jeton(a.id))
        assert r.status_code == 200
        assert r.json()["dispos"]["lun"] == 0 and r.json()["sports"] == [] and r.json()["ia"] == "claude" and r.json()["objectif"] == ""


def test_jeton_d_envoi_ne_retire_ni_l_historique_ni_les_ajouts_de_l_athlete(client, db):
    from datetime import date
    from models import SeancePrevue
    a, b = _compte(db, "ia-h@exemple.test"), _compte(db, "ia-i@exemple.test")
    ja = {"X-Carnet-Token": client.get("/api/claude/token", headers=_jeton(a.id)).json()["claude_token"]}
    jb = {"X-Carnet-Token": client.get("/api/claude/token", headers=_jeton(b.id)).json()["claude_token"]}
    lundi = date(2031, 1, 6)
    for id_ext, extra in (("manuel-abc", {}), ("test-seuil-2031", {}), ("plan-commente", {"commentaire": "jambes lourdes"}),
                          ("plan-saute", {"statut": "sautee"}), ("plan-simple", {})):
        db.add(SeancePrevue(utilisateur_id=a.id, id_externe=id_ext, jour=lundi, sport="course", titre=id_ext,
                            statut=extra.get("statut", "prevue"), commentaire=extra.get("commentaire"), ordre=0))
    db.commit()
    corps = {"seances": [{"jour": "2031-01-07", "sport": "course", "titre": "Footing", "id_externe": "2031-01-07-footing"}],
             "remplacer": {"depuis": "2031-01-06", "jusqu_a": "2031-01-12"}}
    r = client.post("/api/claude/plan", json=corps, headers=ja)
    assert r.status_code == 200 and r.json()["supprime"] == 1 and r.json()["conserve"] == 0
    db.expire_all()
    restantes = {p.id_externe for p in db.query(SeancePrevue).filter_by(utilisateur_id=a.id)}
    assert restantes == {"manuel-abc", "test-seuil-2031", "plan-commente", "plan-saute", "2031-01-07-footing"}
    # suppression directe : même protection, et jamais dans le plan d'un autre compte
    for id_ext in ("manuel-abc", "test-seuil-2031", "plan-commente", "plan-saute"):
        assert client.delete(f"/api/claude/plan/{id_ext}", headers=ja).status_code == 409
    assert client.delete("/api/claude/plan/2031-01-07-footing", headers=jb).status_code == 404
    assert client.get("/api/claude/plan?depuis=2031-01-06&jusqu_a=2031-01-12", headers=jb).json()["seances"] == []
    assert client.delete("/api/claude/plan/2031-01-07-footing", headers=ja).status_code == 200
    # deux séances sous le même identifiant : refus net, rien n'est écrit
    double = {"seances": [{"jour": "2031-01-08", "sport": "course", "titre": "A", "id_externe": "x-1"},
                          {"jour": "2031-01-09", "sport": "velo", "titre": "B", "id_externe": "x-1"}]}
    r = client.post("/api/claude/plan", json=double, headers=ja)
    assert r.status_code == 400 and "x-1" in r.json()["detail"]
    db.expire_all()
    assert db.query(SeancePrevue).filter_by(utilisateur_id=a.id, id_externe="x-1").count() == 0
    # changer le jeton coupe l'ancien
    client.post("/api/claude/token/regenerer", headers=_jeton(a.id))
    assert client.post("/api/claude/plan", json=corps, headers=ja).status_code == 401
    assert client.get("/api/claude/export?format=md", headers=ja).status_code == 401
