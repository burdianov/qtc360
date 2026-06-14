"""add aconex reference number to approval rounds

Revision ID: a5b6c7d8e9f0
Revises: 88c3d5f6a7b9
Create Date: 2026-06-14

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a5b6c7d8e9f0"
down_revision: Union[str, Sequence[str], None] = "88c3d5f6a7b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "document_approval_rounds",
        sa.Column("aconex_reference_number", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("document_approval_rounds", "aconex_reference_number")
