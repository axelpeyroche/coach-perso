"""
Export complet du compte et sauvegardes hebdomadaires.

La sauvegarde est le même export, sans les tracés GPS (trop lourds), compressé et rangé dans la base :
elle protège d'une fausse manœuvre ou d'un import raté, pas de la perte de la base elle-même. Pour une
copie hors du serveur, on la télécharge depuis la page « Santé du carnet ».
"""
from __future__ import annotations

import gzip
import json
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from models import (Activite, Douleur, Exclusion, JournalCalcul, MarqueurJour, Mensuration, MesureSante, NuitSommeil,
                    Objectif, ObjectifCourse, PoidsUtilisateur, ReleveDouleur, RessentiMatin, Sauvegarde, SeancePrevue,
                    Segment, TraceGPS, Utilisateur)

SECRETS = ("password_hash", "strava_access_token", "strava_refresh_token", "intervals_cle",
           "import_token", "analyse_token", "claude_token")
INTERVALLE_J = 7
GARDEES = 4


def _dump(obj) -> dict:
    d = {}
    for col in obj.__table__.columns:
        v = getattr(obj, col.name)
        if isinstance(v, (datetime, date)):
            v = v.isoformat()
        d[col.name] = v
    return d


def exporter(db: Session, user: Utilisateur, avec_traces: bool = True) -> dict:
    """Dump générique (colonne par colonne) des données personnelles du compte, secrets retirés."""
    def tout(modele, tri):
        return [_dump(x) for x in db.query(modele).filter_by(utilisateur_id=user.id).order_by(tri).all()]

    profil = _dump(user)
    for secret in SECRETS:
        profil.pop(secret, None)
    for cle in list(profil):   # tout jeton ajouté plus tard reste hors de l'export
        if any(m in cle for m in ("token", "secret", "password")) or cle.endswith("_cle"):
            profil.pop(cle)
    mes_douleurs = db.query(Douleur.id).filter_by(utilisateur_id=user.id)
    out = {
        "profil": profil,
        "historique_poids": tout(PoidsUtilisateur, PoidsUtilisateur.enregistre_le),
        "objectifs_course": tout(ObjectifCourse, ObjectifCourse.id),
        "activites": tout(Activite, Activite.debut),
        "objectifs": tout(Objectif, Objectif.id),
        "mesures_sante": [_dump(m) for m in db.query(MesureSante).filter_by(utilisateur_id=user.id)
                          .order_by(MesureSante.jour, MesureSante.type).all()],
        "nuits_sommeil": tout(NuitSommeil, NuitSommeil.jour),
        "seances_prevues": tout(SeancePrevue, SeancePrevue.jour),
        "segments": tout(Segment, Segment.id),
        "marqueurs_jour": tout(MarqueurJour, MarqueurJour.id),
        "ressentis_matin": tout(RessentiMatin, RessentiMatin.id),
        "douleurs": tout(Douleur, Douleur.id),
        "releves_douleur": [_dump(r) for r in db.query(ReleveDouleur)
                            .filter(ReleveDouleur.douleur_id.in_(mes_douleurs)).order_by(ReleveDouleur.id).all()],
        "mensurations": tout(Mensuration, Mensuration.id),
        "exclusions": tout(Exclusion, Exclusion.id),
        "journal_calculs": tout(JournalCalcul, JournalCalcul.id),
    }
    if avec_traces:
        # points : JSON [[lat, lon, alt, s], …] tel que stocké
        out["traces_gps"] = tout(TraceGPS, TraceGPS.activite_id)
    out["exporte_le"] = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    out["version"] = 3
    return out


def _fiche(s: Sauvegarde) -> dict:
    try:
        resume = json.loads(s.resume) if s.resume else {}
    except ValueError:
        resume = {}
    return {"id": s.id, "cree_le": s.cree_le.isoformat() + "Z", "origine": s.origine, "taille": s.taille, "resume": resume}


def lister(db: Session, user_id: int) -> list[dict]:
    lignes = (db.query(Sauvegarde.id, Sauvegarde.cree_le, Sauvegarde.origine, Sauvegarde.taille, Sauvegarde.resume)
              .filter(Sauvegarde.utilisateur_id == user_id).order_by(Sauvegarde.cree_le.desc()).all())
    return [_fiche(s) for s in lignes]


def due(db: Session, user_id: int, maintenant: Optional[datetime] = None) -> bool:
    maintenant = maintenant or datetime.utcnow()
    derniere = (db.query(Sauvegarde.cree_le).filter(Sauvegarde.utilisateur_id == user_id)
                .order_by(Sauvegarde.cree_le.desc()).first())
    return not derniere or maintenant - derniere[0] >= timedelta(days=INTERVALLE_J)


def creer(db: Session, user: Utilisateur, origine: str = "auto", maintenant: Optional[datetime] = None) -> dict:
    """Enregistre une sauvegarde et ne garde que les plus récentes (ce sont des copies : rien d'autre n'est effacé)."""
    donnees = exporter(db, user, avec_traces=False)
    brut = json.dumps(donnees, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")
    contenu = gzip.compress(brut, compresslevel=6)
    resume = {k: len(v) for k, v in donnees.items() if isinstance(v, list)}
    s = Sauvegarde(utilisateur_id=user.id, cree_le=maintenant or datetime.utcnow(), origine=origine,
                   taille=len(contenu), resume=json.dumps(resume), contenu=contenu)
    db.add(s)
    db.flush()
    anciennes = [i for i, in db.query(Sauvegarde.id).filter(Sauvegarde.utilisateur_id == user.id)
                 .order_by(Sauvegarde.cree_le.desc(), Sauvegarde.id.desc()).offset(GARDEES)]
    if anciennes:
        db.query(Sauvegarde).filter(Sauvegarde.id.in_(anciennes)).delete(synchronize_session=False)
    return _fiche(s)


def contenu(db: Session, user_id: int, sauvegarde_id: int) -> Optional[tuple[bytes, datetime]]:
    """JSON décompressé d'une sauvegarde du compte, avec sa date."""
    s = db.query(Sauvegarde).filter(Sauvegarde.id == sauvegarde_id, Sauvegarde.utilisateur_id == user_id).first()
    return (gzip.decompress(s.contenu), s.cree_le) if s else None
