import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class Document(BaseModel):
    __tablename__ = "documents"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"))
    document_type: Mapped[str] = mapped_column(String(10), index=True)  # FAT, MIR, WIR, CIR
    reference_no: Mapped[str] = mapped_column(String(100), index=True)
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="draft")  # draft, submitted, approved, approved_with_comments, rejected, cancelled, superseded
    revision_no: Mapped[int] = mapped_column(Integer, default=0)
    discipline_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("disciplines.id"))

    # Internal signatories
    site_engineer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    qaqc_engineer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    site_engineer_signed: Mapped[bool] = mapped_column(default=False)
    qaqc_engineer_signed: Mapped[bool] = mapped_column(default=False)

    # Current approver tracking
    current_approver_order: Mapped[int | None] = mapped_column(default=None)

    # Dates
    submitted_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # WIR/CIR context fields (location info for inspection documents)
    location: Mapped[str | None] = mapped_column(String(500))
    floor_level: Mapped[str | None] = mapped_column(String(255))
    rams_ref: Mapped[str | None] = mapped_column(String(255))
    drawing_ref: Mapped[str | None] = mapped_column(String(255))
    inspection_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # MIR context fields
    delivery_note: Mapped[str | None] = mapped_column(String(255))

    # FAT context fields
    asset_type_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("asset_types.id"))

    # Audit
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    # Relationships
    project: Mapped["Project"] = relationship()  # noqa: F821
    discipline: Mapped["Discipline | None"] = relationship()  # noqa: F821
    asset_type: Mapped["AssetType | None"] = relationship()  # noqa: F821
    site_engineer: Mapped["User | None"] = relationship(foreign_keys=[site_engineer_id])  # noqa: F821
    qaqc_engineer: Mapped["User | None"] = relationship(foreign_keys=[qaqc_engineer_id])  # noqa: F821
    creator: Mapped["User | None"] = relationship(foreign_keys=[created_by])  # noqa: F821
    updater: Mapped["User | None"] = relationship(foreign_keys=[updated_by])  # noqa: F821
    assets: Mapped[list["Asset"]] = relationship(secondary="document_assets")  # noqa: F821
    approvals: Mapped[list["DocumentApproval"]] = relationship(back_populates="document")  # noqa: F821
    requirement_links: Mapped[list["DocumentRequirementLink"]] = relationship(viewonly=True)  # noqa: F821
