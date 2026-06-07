"""add discipline reference number counters

Revision ID: d9f29178ab55
Revises: f4a5b6c7d8e9
Create Date: 2026-06-05 22:09:42.485680
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "d9f29178ab55"
down_revision: Union[str, Sequence[str], None] = "f4a5b6c7d8e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "reference_number_counters",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("doc_type", sa.String(length=10), nullable=False),
        sa.Column("discipline_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("next_serial", sa.Integer(), server_default="1", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.Column(
            "is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["discipline_id"], ["disciplines.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint(
            "project_id",
            "doc_type",
            "discipline_id",
            name="uq_refnum_counter_project_doctype_discipline",
        ),
    )

    op.create_index(
        "ix_reference_number_counters_project_doc_type",
        "reference_number_counters",
        ["project_id", "doc_type"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_reference_number_counters_project_doc_type",
        table_name="reference_number_counters",
    )
    op.drop_table("reference_number_counters")
