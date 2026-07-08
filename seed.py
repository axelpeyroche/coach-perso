"""
Script de seed — peuple la bibliothèque d'exercices EPC par défaut.
Idempotent : ne recrée pas les exercices déjà existants (vérification par slug).
"""

from database import SessionLocal, creer_tables
from models import VariationExercice
from periodization_rules import EXERCICES_DEFAUT


def seeder():
    creer_tables()
    db = SessionLocal()
    try:
        existants = {e.slug for e in db.query(VariationExercice).all()}
        nouveaux = 0
        for data in EXERCICES_DEFAUT:
            if data["slug"] in existants:
                continue
            exercice = VariationExercice(
                nom=data["nom"],
                slug=data["slug"],
                categorie_musculaire=data["categorie_musculaire"],
                niveau_progression=data["niveau_progression"],
                tempo=data.get("tempo"),
                pause_isometrique_sec=data.get("pause_isometrique_sec"),
                muscles_principaux=data.get("muscles_principaux"),
                muscles_secondaires=data.get("muscles_secondaires"),
                materiel=data.get("materiel"),
                description=data.get("description"),
                est_mouvement_evaluation=data.get("est_mouvement_evaluation", False),
            )
            db.add(exercice)
            nouveaux += 1
        db.commit()
        print(f"Seed terminé — {nouveaux} exercice(s) ajouté(s), {len(existants)} déjà présent(s).")
    finally:
        db.close()


if __name__ == "__main__":
    seeder()
