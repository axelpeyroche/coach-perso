"""
Script de démarrage exécuté avant uvicorn sur Render.
Crée les tables, migre la DB, recrée les macrocycles et insère les séances.
"""
import os
from datetime import date, timedelta, datetime

from database import creer_tables, SessionLocal
from models import Utilisateur, Macrocycle, SemaineEntrainement
from periodization_rules import BLUEPRINT_MACROCYCLE, generer_dates_semaines

DATE_DEBUT_ENV = os.getenv("PROGRAMME_DATE_DEBUT", "")  # format jj/mm/aaaa


def _lundi_prochain() -> date:
    today = date.today()
    jours = (7 - today.weekday()) % 7 or 7
    return today + timedelta(days=jours)


def _reset_et_seed() -> None:
    creer_tables()

    db = SessionLocal()
    try:
        user = db.query(Utilisateur).filter(Utilisateur.id == 1).first()
        if not user:
            print("[startup] Aucun utilisateur id=1 — skip reset/seed.")
            return

        if DATE_DEBUT_ENV:
            debut_mc1 = datetime.strptime(DATE_DEBUT_ENV, "%d/%m/%Y").date()
        else:
            debut_mc1 = _lundi_prochain()

        print(f"[startup] Reset macrocycles depuis le {debut_mc1.strftime('%d/%m/%Y')} …")
        db.query(Macrocycle).filter(Macrocycle.utilisateur_id == 1).delete()
        db.flush()

        debuts = {
            1: debut_mc1,
            2: debut_mc1 + timedelta(weeks=8),
            3: debut_mc1 + timedelta(weeks=16),
        }
        for numero_cycle in [1, 2, 3]:
            debut = debuts[numero_cycle]
            mc = Macrocycle(
                utilisateur_id=user.id,
                numero_cycle=numero_cycle,
                date_debut=debut,
                date_fin=debut + timedelta(weeks=8),
            )
            db.add(mc)
            db.flush()
            for regle, date_sem in zip(BLUEPRINT_MACROCYCLE, generer_dates_semaines(debut)):
                db.add(SemaineEntrainement(
                    macrocycle_id=mc.id,
                    numero_semaine=regle.numero,
                    macrophase=regle.macrophase,
                    date_debut=date_sem,
                    multiplicateur_volume=regle.multiplicateur_volume,
                    objectif_km_course=regle.objectif_km_course,
                    objectif_amrap_min=regle.objectif_amrap_min,
                ))
        db.commit()
        print("[startup] Macrocycles créés.")

        print("[startup] Seed séances …")
        from seed_seances import seed_module1, seed_module2, seed_module3
        seed_module1()
        seed_module2()
        seed_module3()
        print("[startup] Seed terminé.")

    finally:
        db.close()


if __name__ == "__main__":
    _reset_et_seed()
