import uuid

from sqlalchemy import Column, ForeignKey, String, Table
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, BaseModel


document_assets = Table(
    "document_assets",
    Base.metadata,
    Column("document_id", UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True),
    Column("asset_id", UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), primary_key=True),
)


class DocumentApproval(BaseModel):
    __tablename__ = "document_approvals"

    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"))
    approver_order: Mapped[int] = mapped_column()  # 1, 2, 3...
    project_approver_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("project_approvers.id"))
    status_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("approval_statuses.id"))
    comments: Mapped[str | None] = mapped_column(String(1000))

    document: Mapped["Document"] = relationship(back_populates="approvals")  # noqa: F821
    project_approver: Mapped["ProjectApprover"] = relationship()  # noqa: F821
    approval_status: Mapped["ApprovalStatus | None"] = relationship()  # noqa: F821
