import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Table, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, BaseModel

# Sub-activities completed in a document
document_sub_activities = Table(
    "document_sub_activities",
    Base.metadata,
    Column("document_id", UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True),
    Column("sub_activity_id", UUID(as_uuid=True), ForeignKey("sub_activities.id", ondelete="CASCADE"), primary_key=True),
)


class Document(BaseModel):
    __tablename__ = "documents"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"))
    doc_type: Mapped[str] = mapped_column(String(10), index=True)  # MIR, WIR, CIR
    number: Mapped[str] = mapped_column(String(50), index=True)
    revision: Mapped[int] = mapped_column(default=0)
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text)
    discipline_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("disciplines.id"))
    status: Mapped[str] = mapped_column(String(30), default="draft")  # draft, pending_review, approved, rejected

    # Internal signatories
    site_engineer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    qaqc_engineer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    site_engineer_signed: Mapped[bool] = mapped_column(default=False)
    qaqc_engineer_signed: Mapped[bool] = mapped_column(default=False)

    # Current approver tracking
    current_approver_order: Mapped[int | None] = mapped_column(default=None)

    # Dates
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # MIR-specific
    delivery_note: Mapped[str | None] = mapped_column(String(255))
    is_milestone_delivery: Mapped[bool | None] = mapped_column(default=None)

    # WIR-specific
    activity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("activities.id"))
    sub_activity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("sub_activities.id"))
    is_milestone_activity: Mapped[bool | None] = mapped_column(default=None)
    location: Mapped[str | None] = mapped_column(String(500))
    floor_level: Mapped[str | None] = mapped_column(String(255))
    rams_ref: Mapped[str | None] = mapped_column(String(255))
    drawing_ref: Mapped[str | None] = mapped_column(String(255))
    inspection_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # CIR-specific
    test_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tests.id"))
    is_milestone_test: Mapped[bool | None] = mapped_column(default=None)

    # Relationships
    project: Mapped["Project"] = relationship()  # noqa: F821
    discipline: Mapped["Discipline | None"] = relationship()  # noqa: F821
    activity: Mapped["Activity | None"] = relationship()  # noqa: F821
    sub_activity: Mapped["SubActivity | None"] = relationship()  # noqa: F821
    test: Mapped["Test | None"] = relationship()  # noqa: F821
    site_engineer: Mapped["User | None"] = relationship(foreign_keys=[site_engineer_id])  # noqa: F821
    qaqc_engineer: Mapped["User | None"] = relationship(foreign_keys=[qaqc_engineer_id])  # noqa: F821
    assets: Mapped[list["Asset"]] = relationship(secondary="document_assets")  # noqa: F821
    completed_sub_activities: Mapped[list["SubActivity"]] = relationship(secondary="document_sub_activities")  # noqa: F821
    approvals: Mapped[list["DocumentApproval"]] = relationship(back_populates="document")  # noqa: F821
