"""documents_and_commissioning

Revision ID: 0002_documents_commissioning
Revises: 0001_initial
Create Date: 2026-05-27 18:10:01.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0002_documents_commissioning"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Documents (unified engine) ---
    op.create_table(
        "documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id"),
            nullable=False,
        ),
        sa.Column("document_type", sa.String(10), nullable=False, index=True),
        sa.Column("reference_no", sa.String(100), nullable=False, index=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("status", sa.String(30), server_default="draft", nullable=False),
        sa.Column("revision_no", sa.Integer, server_default="0", nullable=False),
        sa.Column(
            "discipline_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("disciplines.id"),
        ),
        sa.Column(
            "site_engineer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")
        ),
        sa.Column(
            "qaqc_engineer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")
        ),
        sa.Column(
            "site_engineer_signed", sa.Boolean, server_default="false", nullable=False
        ),
        sa.Column(
            "qaqc_engineer_signed", sa.Boolean, server_default="false", nullable=False
        ),
        sa.Column("current_approver_order", sa.Integer),
        sa.Column("submitted_date", sa.DateTime(timezone=True)),
        sa.Column("approved_date", sa.DateTime(timezone=True)),
        sa.Column("location", sa.String(500)),
        sa.Column("floor_level", sa.String(255)),
        sa.Column("rams_ref", sa.String(255)),
        sa.Column("drawing_ref", sa.String(255)),
        sa.Column("inspection_date", sa.DateTime(timezone=True)),
        sa.Column("delivery_note", sa.String(255)),
        sa.Column(
            "asset_type_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("asset_types.id"),
        ),
        sa.Column(
            "created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")
        ),
        sa.Column(
            "updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")
        ),
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

    # --- Document Assets (many-to-many) ---
    op.create_table(
        "document_assets",
        sa.Column(
            "document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "asset_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assets.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )

    # --- Document Approvals ---
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

    # --- Doc Templates ---
    op.create_table(
        "doc_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id"),
            nullable=False,
        ),
        sa.Column("doc_type", sa.String(10), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("file", sa.LargeBinary, nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("version", sa.Integer, server_default="1", nullable=False),
        sa.Column("is_active", sa.Boolean, server_default="true", nullable=False),
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

    # --- Reference Number Config ---
    op.create_table(
        "reference_number_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id"),
            nullable=False,
        ),
        sa.Column("doc_type", sa.String(10), nullable=False, index=True),
        sa.Column("pattern", sa.String(255), nullable=False),
        sa.Column("project_code", sa.String(50), server_default="", nullable=False),
        sa.Column("contractor_code", sa.String(50), server_default="", nullable=False),
        sa.Column("serial_start", sa.Integer, server_default="1", nullable=False),
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
        sa.UniqueConstraint("project_id", "doc_type", name="uq_refnum_project_doctype"),
    )

    # --- Notifications ---
    op.create_table(
        "notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("message", sa.Text, nullable=False),
        sa.Column("link", sa.String(500)),
        sa.Column("is_read", sa.Boolean, server_default="false", nullable=False),
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

    # --- Project Header Images ---
    op.create_table(
        "project_header_images",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id"),
            nullable=False,
        ),
        sa.Column("cell_id", sa.String(10)),
        sa.Column("file", sa.LargeBinary, nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
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

    # --- Commissioning: Requirement Templates ---
    op.create_table(
        "requirement_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id")
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("code", sa.String(50), nullable=False, index=True),
        sa.Column("description", sa.Text),
        sa.Column("level_code", sa.String(10), nullable=False, index=True),
        sa.Column("requirement_category", sa.String(30), nullable=False),
        sa.Column("evidence_document_type", sa.String(10), nullable=False),
        sa.Column(
            "requires_work_breakdown",
            sa.Boolean,
            server_default="false",
            nullable=False,
        ),
        sa.Column(
            "is_gate_requirement", sa.Boolean, server_default="false", nullable=False
        ),
        sa.Column("is_optional", sa.Boolean, server_default="false", nullable=False),
        sa.Column("sort_order", sa.Integer, server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean, server_default="true", nullable=False),
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

    # --- Commissioning: Asset Requirements ---
    op.create_table(
        "asset_requirements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "asset_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assets.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "requirement_template_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("requirement_templates.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "status", sa.String(20), server_default="not_started", nullable=False
        ),
        sa.Column("progress_percent", sa.Float, server_default="0", nullable=False),
        sa.Column("required_for_tag", sa.String(10), nullable=False),
        sa.Column("target_date", sa.Date),
        sa.Column("actual_completion_date", sa.Date),
        sa.Column("notes", sa.Text),
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

    # --- Commissioning: Requirement Work Items ---
    op.create_table(
        "requirement_work_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "asset_requirement_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("asset_requirements.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column(
            "status", sa.String(20), server_default="not_started", nullable=False
        ),
        sa.Column(
            "linked_document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("documents.id"),
        ),
        sa.Column("approved_date", sa.Date),
        sa.Column("sequence_no", sa.Integer, server_default="0", nullable=False),
        sa.Column(
            "created_dynamically", sa.Boolean, server_default="false", nullable=False
        ),
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

    # --- Commissioning: Document Requirement Links ---
    op.create_table(
        "document_requirement_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("documents.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "asset_requirement_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("asset_requirements.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "requirement_work_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("requirement_work_items.id"),
        ),
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

    # --- Commissioning: Asset Tag Targets ---
    op.create_table(
        "asset_tag_targets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "asset_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assets.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("tag_code", sa.String(10), nullable=False),
        sa.Column("target_date", sa.Date, nullable=False),
        sa.Column("actual_achieved_date", sa.Date),
        sa.Column(
            "status", sa.String(20), server_default="not_started", nullable=False
        ),
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

    # --- Commissioning: Gate Override Acknowledgements ---
    op.create_table(
        "gate_override_acknowledgements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "asset_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assets.id"),
            nullable=False,
        ),
        sa.Column(
            "document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("documents.id"),
            nullable=False,
        ),
        sa.Column("level_code", sa.String(10), nullable=False),
        sa.Column("incomplete_requirements", postgresql.JSONB, nullable=False),
        sa.Column(
            "acknowledged_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("notes", sa.Text),
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


def downgrade() -> None:
    op.drop_table("gate_override_acknowledgements")
    op.drop_table("asset_tag_targets")
    op.drop_table("document_requirement_links")
    op.drop_table("requirement_work_items")
    op.drop_table("asset_requirements")
    op.drop_table("requirement_templates")
    op.drop_table("project_header_images")
    op.drop_table("notifications")
    op.drop_table("reference_number_configs")
    op.drop_table("doc_templates")
    op.drop_table("document_approvals")
    op.drop_table("document_assets")
    op.drop_table("documents")
