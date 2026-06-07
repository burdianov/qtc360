"""PR2: store submitted bundle + response per approval round, with password flag

Adds columns to ``document_approval_rounds`` to support the per-round
file storage model:

* ``submitted_file_path`` / ``submitted_file_size`` — the bundle that
  was sent to this approver (S1, S2, ...)
* ``submitted_at`` — explicit timestamp of the submit (we already
  populate this in the service layer; the column already exists so
  this migration is a no-op for it)
* ``returned_file_locked`` (boolean, default false) — flipped to
  ``True`` if the returned PDF is encrypted and could not be opened
  with an empty password

Storage layout (mirrored on disk under ``upload_dir``):

    responses/{doc_id}/S1.pdf
    responses/{doc_id}/R1.pdf
    responses/{doc_id}/S2.pdf
    responses/{doc_id}/R2.pdf

Revision ID: 7a8b9c0d1e2f
Revises: f4a5b6c7d8e9
Create Date: 2026-06-06 12:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7a8b9c0d1e2f"
# Two heads branched off f4a5b6c7d8e9: the discipline-counter work
# (a1b2c3d4e5f7) and this PR2 file-storage work. Listing both makes this
# migration a merge point so the chain converges to a single head.
down_revision: Union[str, Sequence[str], None] = ("f4a5b6c7d8e9", "a1b2c3d4e5f7")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "document_approval_rounds",
        sa.Column("submitted_file_path", sa.String(1000), nullable=True),
    )
    op.add_column(
        "document_approval_rounds",
        sa.Column("submitted_file_size", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "document_approval_rounds",
        sa.Column(
            "returned_file_locked",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("document_approval_rounds", "returned_file_locked")
    op.drop_column("document_approval_rounds", "submitted_file_size")
    op.drop_column("document_approval_rounds", "submitted_file_path")
