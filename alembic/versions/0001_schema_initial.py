"""Schéma initial EPC — toutes les tables

Revision ID: 0001
Revises:
Create Date: 2026-07-08
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "utilisateurs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("nom", sa.String(120), nullable=False),
        sa.Column("date_naissance", sa.Date(), nullable=True),
        sa.Column("cree_le", sa.DateTime(), server_default=sa.func.now()),
    )

    op.create_table(
        "biometries_utilisateurs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("utilisateur_id", sa.Integer(), sa.ForeignKey("utilisateurs.id"), nullable=False),
        sa.Column("enregistre_le", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("vma_kmh", sa.Float(), nullable=False),
        sa.Column("fc_max", sa.Integer(), nullable=True),
        sa.Column("poids_kg", sa.Float(), nullable=True),
        sa.Column("taux_masse_grasse_pct", sa.Float(), nullable=True),
        sa.Column("z1_min_kmh", sa.Float(), nullable=False),
        sa.Column("z1_max_kmh", sa.Float(), nullable=False),
        sa.Column("z2_min_kmh", sa.Float(), nullable=False),
        sa.Column("z2_max_kmh", sa.Float(), nullable=False),
        sa.Column("z3_min_kmh", sa.Float(), nullable=False),
        sa.Column("z3_max_kmh", sa.Float(), nullable=False),
        sa.Column("z4_min_kmh", sa.Float(), nullable=False),
        sa.Column("z4_max_kmh", sa.Float(), nullable=False),
        sa.Column("z5_min_kmh", sa.Float(), nullable=False),
        sa.Column("z5_max_kmh", sa.Float(), nullable=False),
        sa.Column("z1_fc_min", sa.Integer(), nullable=True),
        sa.Column("z1_fc_max", sa.Integer(), nullable=True),
        sa.Column("z2_fc_min", sa.Integer(), nullable=True),
        sa.Column("z2_fc_max", sa.Integer(), nullable=True),
        sa.Column("z3_fc_min", sa.Integer(), nullable=True),
        sa.Column("z3_fc_max", sa.Integer(), nullable=True),
        sa.Column("z4_fc_min", sa.Integer(), nullable=True),
        sa.Column("z4_fc_max", sa.Integer(), nullable=True),
        sa.Column("z5_fc_min", sa.Integer(), nullable=True),
        sa.Column("z5_fc_max", sa.Integer(), nullable=True),
    )

    op.create_table(
        "variations_exercices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("nom", sa.String(120), nullable=False),
        sa.Column("slug", sa.String(120), nullable=False, unique=True),
        sa.Column("categorie_musculaire", sa.String(50), nullable=False),
        sa.Column("niveau_progression", sa.String(50), nullable=False),
        sa.Column("tempo", sa.String(20), nullable=True),
        sa.Column("pause_isometrique_sec", sa.Float(), nullable=True),
        sa.Column("muscles_principaux", sa.String(255), nullable=True),
        sa.Column("muscles_secondaires", sa.String(255), nullable=True),
        sa.Column("materiel", sa.String(120), nullable=True),
        sa.Column("id_regression", sa.Integer(), sa.ForeignKey("variations_exercices.id"), nullable=True),
        sa.Column("id_progression", sa.Integer(), sa.ForeignKey("variations_exercices.id"), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("est_mouvement_evaluation", sa.Boolean(), default=False),
    )

    op.create_table(
        "macrocycles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("utilisateur_id", sa.Integer(), sa.ForeignKey("utilisateurs.id"), nullable=False),
        sa.Column("numero_cycle", sa.Integer(), nullable=False),
        sa.Column("date_debut", sa.Date(), nullable=False),
        sa.Column("date_fin", sa.Date(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.UniqueConstraint("utilisateur_id", "numero_cycle"),
    )

    op.create_table(
        "semaines_entrainement",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("macrocycle_id", sa.Integer(), sa.ForeignKey("macrocycles.id"), nullable=False),
        sa.Column("numero_semaine", sa.Integer(), nullable=False),
        sa.Column("macrophase", sa.String(50), nullable=False),
        sa.Column("date_debut", sa.Date(), nullable=False),
        sa.Column("multiplicateur_volume", sa.Float(), default=1.0),
        sa.Column("objectif_km_course", sa.Float(), nullable=True),
        sa.Column("objectif_amrap_min", sa.Integer(), nullable=True),
        sa.UniqueConstraint("macrocycle_id", "numero_semaine"),
    )

    op.create_table(
        "seances_entrainement",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("semaine_id", sa.Integer(), sa.ForeignKey("semaines_entrainement.id"), nullable=False),
        sa.Column("date_seance", sa.Date(), nullable=False),
        sa.Column("type_seance", sa.String(50), nullable=False),
        sa.Column("titre", sa.String(200), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("ordre_dans_semaine", sa.Integer(), default=1),
        sa.Column("zone_cible", sa.String(10), nullable=True),
        sa.Column("distance_cible_km", sa.Float(), nullable=True),
        sa.Column("duree_cible_min", sa.Integer(), nullable=True),
        sa.Column("dplus_cible_m", sa.Integer(), nullable=True),
        sa.Column("temps_limite_min", sa.Integer(), nullable=True),
    )

    op.create_table(
        "exercices_seance",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("seance_id", sa.Integer(), sa.ForeignKey("seances_entrainement.id"), nullable=False),
        sa.Column("exercice_id", sa.Integer(), sa.ForeignKey("variations_exercices.id"), nullable=False),
        sa.Column("ordre", sa.Integer(), nullable=False),
        sa.Column("series", sa.Integer(), nullable=True),
        sa.Column("repetitions", sa.Integer(), nullable=True),
        sa.Column("duree_sec", sa.Integer(), nullable=True),
        sa.Column("recuperation_sec", sa.Integer(), nullable=True),
        sa.Column("tempo_override", sa.String(20), nullable=True),
        sa.Column("pause_isometrique_override_sec", sa.Float(), nullable=True),
        sa.Column("zone_cible", sa.String(10), nullable=True),
        sa.Column("notes", sa.String(500), nullable=True),
    )

    op.create_table(
        "journaux_seances",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("utilisateur_id", sa.Integer(), sa.ForeignKey("utilisateurs.id"), nullable=False),
        sa.Column("seance_id", sa.Integer(), sa.ForeignKey("seances_entrainement.id"), nullable=False, unique=True),
        sa.Column("enregistre_le", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("completee", sa.Boolean(), default=True),
        sa.Column("rpe", sa.Float(), nullable=True),
        sa.Column("rpe_cible", sa.Float(), nullable=True),
        sa.Column("distance_reelle_km", sa.Float(), nullable=True),
        sa.Column("duree_reelle_min", sa.Integer(), nullable=True),
        sa.Column("dplus_reel_m", sa.Integer(), nullable=True),
        sa.Column("fc_moyenne_bpm", sa.Integer(), nullable=True),
        sa.Column("fc_max_bpm", sa.Integer(), nullable=True),
        sa.Column("tours_amrap_completes", sa.Float(), nullable=True),
        sa.Column("total_reps_enregistrees", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
    )

    op.create_table(
        "journaux_exercices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("journal_seance_id", sa.Integer(), sa.ForeignKey("journaux_seances.id"), nullable=False),
        sa.Column("exercice_seance_id", sa.Integer(), sa.ForeignKey("exercices_seance.id"), nullable=False),
        sa.Column("numero_serie", sa.Integer(), default=1),
        sa.Column("reps_realisees", sa.Integer(), nullable=True),
        sa.Column("duree_realisee_sec", sa.Integer(), nullable=True),
        sa.Column("rpe_serie", sa.Float(), nullable=True),
        sa.Column("notes", sa.String(500), nullable=True),
    )

    op.create_table(
        "journaux_evaluation_seance",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("utilisateur_id", sa.Integer(), sa.ForeignKey("utilisateurs.id"), nullable=False),
        sa.Column("macrocycle_id", sa.Integer(), sa.ForeignKey("macrocycles.id"), nullable=True),
        sa.Column("evalue_le", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("est_induction", sa.Boolean(), default=False),
        sa.Column("notes", sa.Text(), nullable=True),
    )

    op.create_table(
        "resultats_demi_cooper",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("evaluation_id", sa.Integer(), sa.ForeignKey("journaux_evaluation_seance.id"), nullable=False, unique=True),
        sa.Column("distance_metres", sa.Float(), nullable=False),
        sa.Column("vma_calculee_kmh", sa.Float(), nullable=False),
        sa.Column("conditions", sa.String(255), nullable=True),
        sa.Column("id_biometrie_instantanee", sa.Integer(), sa.ForeignKey("biometries_utilisateurs.id"), nullable=True),
    )

    op.create_table(
        "resultats_max_1min",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("evaluation_id", sa.Integer(), sa.ForeignKey("journaux_evaluation_seance.id"), nullable=False),
        sa.Column("exercice_id", sa.Integer(), sa.ForeignKey("variations_exercices.id"), nullable=False),
        sa.Column("repetitions_realisees", sa.Integer(), nullable=False),
        sa.Column("notes", sa.String(255), nullable=True),
        sa.UniqueConstraint("evaluation_id", "exercice_id", name="uq_max_1min_par_exercice_par_evaluation"),
    )

    op.create_table(
        "resultats_amrap_benchmark",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("evaluation_id", sa.Integer(), sa.ForeignKey("journaux_evaluation_seance.id"), nullable=False, unique=True),
        sa.Column("temps_limite_min", sa.Integer(), default=10),
        sa.Column("tours_completes", sa.Float(), nullable=False),
        sa.Column("total_reps", sa.Integer(), nullable=True),
        sa.Column("tractions_dernier_partiel", sa.Integer(), nullable=True),
        sa.Column("pompes_dernier_partiel", sa.Integer(), nullable=True),
        sa.Column("squats_dernier_partiel", sa.Integer(), nullable=True),
        sa.Column("dips_dernier_partiel", sa.Integer(), nullable=True),
        sa.Column("burpees_dernier_partiel", sa.Integer(), nullable=True),
        sa.Column("mountain_climbers_dernier_partiel", sa.Integer(), nullable=True),
        sa.Column("fc_moyenne_bpm", sa.Integer(), nullable=True),
        sa.Column("fc_max_bpm", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("resultats_amrap_benchmark")
    op.drop_table("resultats_max_1min")
    op.drop_table("resultats_demi_cooper")
    op.drop_table("journaux_evaluation_seance")
    op.drop_table("journaux_exercices")
    op.drop_table("journaux_seances")
    op.drop_table("exercices_seance")
    op.drop_table("seances_entrainement")
    op.drop_table("semaines_entrainement")
    op.drop_table("macrocycles")
    op.drop_table("variations_exercices")
    op.drop_table("biometries_utilisateurs")
    op.drop_table("utilisateurs")
