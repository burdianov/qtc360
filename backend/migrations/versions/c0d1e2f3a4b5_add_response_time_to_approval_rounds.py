"""add response_time to document_approval_rounds

Revision ID: c0d1e2f3a4b5
Revises: b9c0d1e2f3a4
Create Date: 2026-05-29
"""

from alembic import op
import sqlalchemy as sa

revision = "c0d1e2f3a4b5"
down_revision = "b9c0d1e2f3a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "document_approval_rounds",
        sa.Column("response_time", sa.String(10), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("document_approval_rounds", "response_time")
