import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


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
    approvals: Mapped[list["DocumentApproval"]] = relationship(back_populates="document")  # noqa: F821
