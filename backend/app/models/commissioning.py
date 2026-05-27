import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class RequirementTemplate(BaseModel):
    __tablename__ = "requirement_templates"

    project_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"))
    name: Mapped[str] = mapped_column(String(255))
    code: Mapped[str] = mapped_column(String(50), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    level_code: Mapped[str] = mapped_column(String(10), index=True)  # L1, L2A, L2B, L3, L4
    requirement_category: Mapped[str] = mapped_column(String(30))  # fat, delivery, activity, test, integration_test, final_level_test
    evidence_document_type: Mapped[str] = mapped_column(String(10))  # FAT, MIR, WIR, CIR
    requires_work_breakdown: Mapped[bool] = mapped_column(default=False)
    is_gate_requirement: Mapped[bool] = mapped_column(default=False)
    is_optional: Mapped[bool] = mapped_column(default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(default=True)

    # Relationships
    project: Mapped["Project | None"] = relationship()  # noqa: F821
    asset_requirements: Mapped[list["AssetRequirement"]] = relationship(back_populates="requirement_template")


class AssetRequirement(BaseModel):
    __tablename__ = "asset_requirements"

    asset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("assets.id"), index=True)
    requirement_template_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("requirement_templates.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="not_started")  # not_started, submitted, partial, achieved, rejected, not_applicable
    progress_percent: Mapped[float] = mapped_column(Float, default=0.0)
    required_for_tag: Mapped[str] = mapped_column(String(10))  # red, yellow, green, blue
    target_date: Mapped[date | None] = mapped_column(Date)
    actual_completion_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)

    # Relationships
    asset: Mapped["Asset"] = relationship()  # noqa: F821
    requirement_template: Mapped["RequirementTemplate"] = relationship(back_populates="asset_requirements")
    work_items: Mapped[list["RequirementWorkItem"]] = relationship(back_populates="asset_requirement")
    document_links: Mapped[list["DocumentRequirementLink"]] = relationship(back_populates="asset_requirement")


class RequirementWorkItem(BaseModel):
    __tablename__ = "requirement_work_items"

    asset_requirement_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("asset_requirements.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="not_started")  # not_started, submitted, approved, rejected
    linked_document_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"))
    approved_date: Mapped[date | None] = mapped_column(Date)
    sequence_no: Mapped[int] = mapped_column(Integer, default=0)
    created_dynamically: Mapped[bool] = mapped_column(default=False)

    # Relationships
    asset_requirement: Mapped["AssetRequirement"] = relationship(back_populates="work_items")
    linked_document: Mapped["Document | None"] = relationship()  # noqa: F821


class DocumentRequirementLink(BaseModel):
    __tablename__ = "document_requirement_links"

    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"), index=True)
    asset_requirement_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("asset_requirements.id"), index=True)
    requirement_work_item_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("requirement_work_items.id"))

    # Relationships
    document: Mapped["Document"] = relationship()  # noqa: F821
    asset_requirement: Mapped["AssetRequirement"] = relationship(back_populates="document_links")
    requirement_work_item: Mapped["RequirementWorkItem | None"] = relationship()


class AssetTagTarget(BaseModel):
    __tablename__ = "asset_tag_targets"

    asset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("assets.id"), index=True)
    tag_code: Mapped[str] = mapped_column(String(10))  # red, yellow, green, blue, white
    target_date: Mapped[date] = mapped_column(Date)
    actual_achieved_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="not_started")  # not_started, in_progress, achieved, delayed, at_risk

    # Relationships
    asset: Mapped["Asset"] = relationship()  # noqa: F821
