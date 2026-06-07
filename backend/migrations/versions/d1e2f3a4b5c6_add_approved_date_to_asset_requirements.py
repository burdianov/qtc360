"""add approved_date to asset_requirements

Revision ID: d1e2f3a4b5c6
Revises: c0d1e2f3a4b5
Create Date: 2026-05-29
"""

from alembic import op
import sqlalchemy as sa

revision = "d1e2f3a4b5c6"
down_revision = "c0d1e2f3a4b5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "asset_requirements", sa.Column("approved_date", sa.Date(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("asset_requirements", "approved_date")
