import uuid

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class ProjectApprover(BaseModel):
    __tablename__ = "project_approvers"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"))
    approver_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("approvers.id"))
    approver_title_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("approver_titles.id"))
    document_type: Mapped[str | None] = mapped_column(String(10))
    approver_order: Mapped[int | None] = mapped_column(Integer)

    project: Mapped["Project"] = relationship(back_populates="approvers")  # noqa: F821
    approver: Mapped["Approver"] = relationship()  # noqa: F821
    approver_title: Mapped["ApproverTitle | None"] = relationship()  # noqa: F821
