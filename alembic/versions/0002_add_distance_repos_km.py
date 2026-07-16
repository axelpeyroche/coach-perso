"""Ajoute distance_repos_km dans journal_seance

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-16
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("journal_seance", sa.Column("distance_repos_km", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("journal_seance", "distance_repos_km")
