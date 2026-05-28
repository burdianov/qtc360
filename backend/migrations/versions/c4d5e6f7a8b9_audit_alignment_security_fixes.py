"""audit_alignment_security_fixes

Aligns the schema with the post-audit models:

- Replace ``documents.uq_document_project_refno`` with a 3-column unique key that includes
  ``revision_no``, so resubmits don't collide on the same reference.
- Add ``users.token_version`` to support session revocation.
- Add ``reference_number_configs.next_serial`` (atomic counter) and widen ``pattern`` to 500.
- Add ``assets.project_id`` and switch ``assets.tag_number`` to per-project uniqueness.
- Add the missing ``asset_requirements`` unique constraint.
- Make ``gate_override_acknowledgements.document_id`` nullable.
- Drop the orphan ``project_header_images`` table if it exists.

Revision ID: c4d5e6f7a8b9
Revises: b2c3d4e5f6a7
Create Date: 2026-05-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c4d5e6f7a8b9"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _drop_constraint_if_exists(name: str, table: str) -> None:
    bind = op.get_bind()
    bind.execute(sa.text(f'ALTER TABLE "{table}" DROP CONSTRAINT IF EXISTS "{name}"'))


def _drop_index_if_exists(name: str) -> None:
    bind = op.get_bind()
    bind.execute(sa.text(f'DROP INDEX IF EXISTS "{name}"'))


def upgrade() -> None:
    # --- documents: revision-aware uniqueness ----------------------------------------
    # Existing data may contain duplicates from the previous racy ref-number generator.
    # Bump the revision_no on the older row so the new unique constraint can be applied.
    op.execute(
        """
        WITH ranked AS (
            SELECT id,
                   project_id,
                   reference_no,
                   revision_no,
                   ROW_NUMBER() OVER (
                       PARTITION BY project_id, reference_no, revision_no
                       ORDER BY created_at, id
                   ) - 1 AS dup_index
            FROM documents
        ),
        max_rev AS (
            SELECT project_id, reference_no, MAX(revision_no) AS max_rev
            FROM documents
            GROUP BY project_id, reference_no
        )
        UPDATE documents d
        SET revision_no = m.max_rev + r.dup_index
        FROM ranked r, max_rev m
        WHERE d.id = r.id
          AND r.dup_index > 0
          AND m.project_id = d.project_id
          AND m.reference_no = d.reference_no
        """
    )
    _drop_constraint_if_exists("uq_document_project_refno", "documents")
    op.create_unique_constraint(
        "uq_document_project_refno_rev",
        "documents",
        ["project_id", "reference_no", "revision_no"],
    )

    # --- users: token_version --------------------------------------------------------
    op.add_column(
        "users",
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
    )

    # --- reference_number_configs: next_serial + wider pattern -----------------------
    op.add_column(
        "reference_number_configs",
        sa.Column("next_serial", sa.Integer(), nullable=False, server_default="1"),
    )
    op.alter_column(
        "reference_number_configs",
        "pattern",
        existing_type=sa.String(255),
        type_=sa.String(500),
        existing_nullable=False,
    )

    # Seed next_serial from existing document counts so pre-existing data
    # doesn't immediately collide on the unique constraint above.
    op.execute(
        """
        UPDATE reference_number_configs c
        SET next_serial = COALESCE(sub.cnt, 0) + COALESCE(c.serial_start, 1)
        FROM (
            SELECT project_id, document_type, COUNT(*) AS cnt
            FROM documents
            WHERE is_deleted = false
            GROUP BY project_id, document_type
        ) sub
        WHERE c.project_id = sub.project_id AND c.doc_type = sub.document_type
        """
    )

    # --- assets: project_id + per-project uniqueness ---------------------------------
    op.add_column(
        "assets",
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    # Backfill from asset_type → service → discipline.project_id where possible.
    op.execute(
        """
        UPDATE assets a
        SET project_id = d.project_id
        FROM asset_types t
        JOIN services s ON s.id = t.service_id
        JOIN disciplines d ON d.id = s.discipline_id
        WHERE a.asset_type_id = t.id AND a.project_id IS NULL
        """
    )
    op.create_foreign_key(
        "fk_assets_project_id", "assets", "projects", ["project_id"], ["id"]
    )
    op.create_index("ix_assets_project_id", "assets", ["project_id"])

    # Drop the global unique index on tag_number, replace with per-project uniqueness.
    _drop_index_if_exists("ix_assets_tag_number")  # unique index from initial migration
    _drop_constraint_if_exists("assets_tag_number_key", "assets")
    op.create_index("ix_assets_tag_number", "assets", ["tag_number"])
    op.create_unique_constraint(
        "uq_asset_project_tagnumber", "assets", ["project_id", "tag_number"]
    )

    # --- asset_requirements: missing unique constraint -------------------------------
    bind = op.get_bind()
    has_constraint = bind.execute(sa.text(
        "SELECT 1 FROM pg_constraint WHERE conname = 'uq_asset_requirement'"
    )).scalar()
    if not has_constraint:
        op.create_unique_constraint(
            "uq_asset_requirement",
            "asset_requirements",
            ["asset_id", "requirement_template_id"],
        )

    # --- gate_override_acknowledgements: document_id should be nullable --------------
    op.alter_column(
        "gate_override_acknowledgements",
        "document_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )

    # --- drop orphan project_header_images if it ever made it into a DB --------------
    bind.execute(sa.text("DROP TABLE IF EXISTS project_header_images"))


def downgrade() -> None:
    bind = op.get_bind()

    op.alter_column(
        "gate_override_acknowledgements",
        "document_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )

    has_constraint = bind.execute(sa.text(
        "SELECT 1 FROM pg_constraint WHERE conname = 'uq_asset_requirement'"
    )).scalar()
    if has_constraint:
        op.drop_constraint("uq_asset_requirement", "asset_requirements", type_="unique")

    _drop_constraint_if_exists("uq_asset_project_tagnumber", "assets")
    _drop_index_if_exists("ix_assets_tag_number")
    op.create_index("ix_assets_tag_number", "assets", ["tag_number"], unique=True)

    _drop_index_if_exists("ix_assets_project_id")
    _drop_constraint_if_exists("fk_assets_project_id", "assets")
    op.drop_column("assets", "project_id")

    op.alter_column(
        "reference_number_configs",
        "pattern",
        existing_type=sa.String(500),
        type_=sa.String(255),
        existing_nullable=False,
    )
    op.drop_column("reference_number_configs", "next_serial")

    op.drop_column("users", "token_version")

    _drop_constraint_if_exists("uq_document_project_refno_rev", "documents")
    op.create_unique_constraint(
        "uq_document_project_refno",
        "documents",
        ["project_id", "reference_no"],
    )
