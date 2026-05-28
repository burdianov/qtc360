"""document_template_lock

Revision ID: f1a2b3c4d5e6
Revises: e1f2a3b4c5d6
Create Date: 2026-05-29 11:00:00.000000

Snapshot the template selection on each document at first external submission.

* documents.template_id — FK to doc_templates; the exact template used for this
  revision. Null while in draft/internally_signed; locked at "Submit to
  Approver 1" time and immutable thereafter.
* documents.cover_page_count — int snapshot copied from the chosen template at
  lock time. Used by the returned-PDF split logic so admin uploading a new
  template version after submission can't shift the split boundary mid-flight.

A new revision (revision_no + 1) starts with both fields cleared so the user
can pick a different template; they re-lock at that revision's first submit.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column(
            "template_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("doc_templates.id"),
            nullable=True,
        ),
    )
    op.add_column(
        "documents",
        sa.Column("cover_page_count", sa.Integer, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("documents", "cover_page_count")
    op.drop_column("documents", "template_id")
