"""add inspector remarks to documents

Revision ID: a8b9c0d1e2f3
Revises: 7031919285ed
Create Date: 2026-05-29
"""

from alembic import op
import sqlalchemy as sa

revision = "a8b9c0d1e2f3"
down_revision = "7031919285ed"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("remarks_1", sa.Text(), nullable=True))
    op.add_column("documents", sa.Column("remarks_2", sa.Text(), nullable=True))
    op.add_column(
        "documents", sa.Column("inspector_date_1", sa.String(20), nullable=True)
    )
    op.add_column(
        "documents", sa.Column("inspector_time_1", sa.String(10), nullable=True)
    )
    op.add_column(
        "documents", sa.Column("inspector_date_2", sa.String(20), nullable=True)
    )
    op.add_column(
        "documents", sa.Column("inspector_time_2", sa.String(10), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("documents", "inspector_time_2")
    op.drop_column("documents", "inspector_date_2")
    op.drop_column("documents", "inspector_time_1")
    op.drop_column("documents", "inspector_date_1")
    op.drop_column("documents", "remarks_2")
    op.drop_column("documents", "remarks_1")
