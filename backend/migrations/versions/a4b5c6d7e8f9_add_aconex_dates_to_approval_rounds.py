"""add aconex dates to approval rounds

Revision ID: a4b5c6d7e8f9
Revises: f3a4b5c6d7e8
Create Date: 2026-05-30
"""
from alembic import op
import sqlalchemy as sa

revision = "a4b5c6d7e8f9"
down_revision = "f3a4b5c6d7e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("document_approval_rounds", sa.Column("aconex_submitted_date", sa.Date(), nullable=True))
    op.add_column("document_approval_rounds", sa.Column("aconex_received_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("document_approval_rounds", "aconex_received_date")
    op.drop_column("document_approval_rounds", "aconex_submitted_date")
