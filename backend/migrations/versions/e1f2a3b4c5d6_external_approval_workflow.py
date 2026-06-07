"""external_approval_workflow

Revision ID: e1f2a3b4c5d6
Revises: c4d5e6f7a8b9
Create Date: 2026-05-29 09:00:00.000000

Schema changes for the external approval workflow:

* project_approvers: add document_type, add approver_order; replace
  approver_title_id with the new (project, document_type, approver_order) chain
  primary key. Old approver_title_id remains nullable for backward compatibility
  during transition.
* doc_templates: add cover_page_count (auto-detected on upload).
* documents: status enum cleanup — replace 'submitted' with 'internally_signed'
  and add the four chain states.
* document_approvals: drop in favor of document_approval_rounds, which captures
  each round's decision letter, signatory, dates, and file links.
* document_attachments: add document_approval_round_id and kind so cover and
  attachment splits associate with their round.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, None] = "c4d5e6f7a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- project_approvers: doc-type-scoped chain ---
    op.add_column(
        "project_approvers",
        sa.Column("document_type", sa.String(10), nullable=True),
    )
    op.add_column(
        "project_approvers",
        sa.Column("approver_order", sa.Integer, nullable=True),
    )
    # Existing rows have no doc_type/order — leave them NULL; admins reconfigure
    # via the new UI. Allow approver_title_id to be NULL going forward.
    op.alter_column(
        "project_approvers",
        "approver_title_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )
    op.create_index(
        "ix_project_approvers_project_doctype_order",
        "project_approvers",
        ["project_id", "document_type", "approver_order"],
        unique=True,
    )

    # --- doc_templates: cover page count ---
    op.add_column(
        "doc_templates",
        sa.Column(
            "cover_page_count",
            sa.Integer,
            server_default="1",
            nullable=False,
        ),
    )

    # --- documents: status backfill ---
    op.execute(
        "UPDATE documents SET status = 'internally_signed' WHERE status = 'submitted'"
    )

    # --- document_approval_rounds: replaces document_approvals ---
    op.drop_table("document_approvals")
    op.create_table(
        "document_approval_rounds",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("approver_order", sa.Integer, nullable=False),
        sa.Column("round_no", sa.Integer, server_default="1", nullable=False),
        sa.Column(
            "project_approver_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("project_approvers.id"),
            nullable=False,
        ),
        sa.Column(
            "decision_status_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("approval_statuses.id"),
            nullable=True,
        ),
        sa.Column("signatory_name", sa.String(255), nullable=True),
        sa.Column("comments", sa.Text, nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("returned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("response_date", sa.Date, nullable=True),
        sa.Column("returned_file_path", sa.String(1000), nullable=True),
        sa.Column("returned_file_name", sa.String(255), nullable=True),
        sa.Column("remarks_file_path", sa.String(1000), nullable=True),
        sa.Column("remarks_file_name", sa.String(255), nullable=True),
        sa.Column("is_deleted", sa.Boolean, server_default="false", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "document_id",
            "approver_order",
            "round_no",
            name="uq_approval_round_doc_order_round",
        ),
    )

    # --- document_attachments: round + kind tagging ---
    op.add_column(
        "document_attachments",
        sa.Column(
            "document_approval_round_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("document_approval_rounds.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
    )
    op.add_column(
        "document_attachments",
        sa.Column(
            "kind",
            sa.String(20),
            server_default="user",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("document_attachments", "kind")
    op.drop_column("document_attachments", "document_approval_round_id")

    op.drop_table("document_approval_rounds")
    op.create_table(
        "document_approvals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("documents.id"),
            nullable=False,
        ),
        sa.Column("approver_order", sa.Integer, nullable=False),
        sa.Column(
            "project_approver_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("project_approvers.id"),
            nullable=False,
        ),
        sa.Column(
            "status_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("approval_statuses.id"),
        ),
        sa.Column("comments", sa.String(1000)),
        sa.Column("is_deleted", sa.Boolean, server_default="false", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.execute(
        "UPDATE documents SET status = 'submitted' WHERE status IN "
        "('internally_signed', 'with_approver_1', 'approver_1_returned', 'with_approver_2')"
    )

    op.drop_column("doc_templates", "cover_page_count")

    op.drop_index(
        "ix_project_approvers_project_doctype_order",
        table_name="project_approvers",
    )
    op.drop_column("project_approvers", "approver_order")
    op.drop_column("project_approvers", "document_type")
    op.alter_column(
        "project_approvers",
        "approver_title_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )
