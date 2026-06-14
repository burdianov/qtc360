import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class DocumentApprovalRound(BaseModel):
    __tablename__ = "document_approval_rounds"
    __table_args__ = (
        UniqueConstraint(
            "document_id",
            "approver_order",
            "round_no",
            name="uq_approval_round_doc_order_round",
        ),
    )

    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    approver_order: Mapped[int] = mapped_column(Integer)
    round_no: Mapped[int] = mapped_column(Integer, default=1)
    project_approver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("project_approvers.id")
    )
    decision_status_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("approval_statuses.id")
    )
    signatory_name: Mapped[str | None] = mapped_column(String(255))
    comments: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    returned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    response_date: Mapped[date | None] = mapped_column(Date)
    response_time: Mapped[str | None] = mapped_column(String(10))
    aconex_submitted_date: Mapped[date | None] = mapped_column(Date)
    aconex_received_date: Mapped[date | None] = mapped_column(Date)
    aconex_reference_number: Mapped[str | None] = mapped_column(String(255))
    submitted_file_path: Mapped[str | None] = mapped_column(String(1000))
    submitted_file_size: Mapped[int | None] = mapped_column(BigInteger)
    returned_file_path: Mapped[str | None] = mapped_column(String(1000))
    returned_file_name: Mapped[str | None] = mapped_column(String(255))
    returned_file_locked: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
    )
    remarks_file_path: Mapped[str | None] = mapped_column(String(1000))
    remarks_file_name: Mapped[str | None] = mapped_column(String(255))

    document: Mapped["Document"] = relationship(back_populates="approval_rounds")  # noqa: F821
    project_approver: Mapped["ProjectApprover"] = relationship()  # noqa: F821
    decision_status: Mapped["ApprovalStatus | None"] = relationship()  # noqa: F821
    attachments: Mapped[list["DocumentAttachment"]] = relationship(  # noqa: F821
        back_populates="approval_round",
        primaryjoin="DocumentApprovalRound.id == DocumentAttachment.document_approval_round_id",
    )
