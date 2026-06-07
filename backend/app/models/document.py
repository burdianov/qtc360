import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class Document(BaseModel):
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "reference_no",
            "revision_no",
            name="uq_document_project_refno_rev",
        ),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id")
    )
    document_type: Mapped[str] = mapped_column(
        String(10), index=True
    )  # FAT, MIR, WIR, CIR
    reference_no: Mapped[str] = mapped_column(String(100), index=True)
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        String(30), default="draft"
    )  # draft, internally_signed, with_approver_1, approver_1_returned, with_approver_2, approved, approved_with_comments, rejected, cancelled, superseded
    revision_no: Mapped[int] = mapped_column(Integer, default=0)
    discipline_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("disciplines.id")
    )

    # Internal signatories
    site_engineer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    qaqc_engineer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
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

    # Inspector remarks
    remarks_1: Mapped[str | None] = mapped_column(Text)
    remarks_2: Mapped[str | None] = mapped_column(Text)

    # Inspector date/time (manually entered)
    inspector_date_1: Mapped[str | None] = mapped_column(String(20))
    inspector_time_1: Mapped[str | None] = mapped_column(String(10))
    inspector_date_2: Mapped[str | None] = mapped_column(String(20))
    inspector_time_2: Mapped[str | None] = mapped_column(String(10))

    # MIR context fields
    delivery_note: Mapped[str | None] = mapped_column(String(255))
    material_submittals: Mapped[str | None] = mapped_column(Text)
    qty: Mapped[str | None] = mapped_column(String(100))

    # FAT context fields
    asset_type_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("asset_types.id")
    )

    # Template lock: snapshot of which template was used and how many cover
    # pages it has. Null while editable; frozen at "Submit to Approver 1".
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("doc_templates.id")
    )
    cover_page_count: Mapped[int | None] = mapped_column(Integer)

    # CRS (Comments Response Sheet) data
    crs_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Audit
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )

    # Relationships
    project: Mapped["Project"] = relationship()  # noqa: F821
    discipline: Mapped["Discipline | None"] = relationship()  # noqa: F821
    asset_type: Mapped["AssetType | None"] = relationship()  # noqa: F821
    site_engineer: Mapped["User | None"] = relationship(foreign_keys=[site_engineer_id])  # noqa: F821
    qaqc_engineer: Mapped["User | None"] = relationship(foreign_keys=[qaqc_engineer_id])  # noqa: F821
    creator: Mapped["User | None"] = relationship(foreign_keys=[created_by])  # noqa: F821
    updater: Mapped["User | None"] = relationship(foreign_keys=[updated_by])  # noqa: F821
    assets: Mapped[list["Asset"]] = relationship(secondary="document_assets")  # noqa: F821
    approval_rounds: Mapped[list["DocumentApprovalRound"]] = relationship(  # noqa: F821
        back_populates="document",
        order_by="DocumentApprovalRound.approver_order, DocumentApprovalRound.round_no",
    )
    requirement_links: Mapped[list["DocumentRequirementLink"]] = relationship(  # noqa: F821
        viewonly=True
    )
