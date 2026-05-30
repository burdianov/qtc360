"""add sort_order to asset_types

Revision ID: f3a4b5c6d7e8
Revises: e2f3a4b5c6d7
Create Date: 2026-05-30
"""
from alembic import op
import sqlalchemy as sa

revision = "f3a4b5c6d7e8"
down_revision = "e2f3a4b5c6d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("asset_types", sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False))


def downgrade() -> None:
    op.drop_column("asset_types", "sort_order")
