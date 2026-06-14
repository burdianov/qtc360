"""add_notes_to_checklist_responses

Revision ID: 88c3d5f6a7b9
Revises: 39b56e7da051
Create Date: 2026-06-13

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "88c3d5f6a7b9"
down_revision: Union[str, None] = "39b56e7da051"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "document_checklist_responses",
        sa.Column("notes", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("document_checklist_responses", "notes")
