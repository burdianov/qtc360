import uuid

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class ChecklistItem(BaseModel):
    """Master checklist item belonging to a requirement template (project-scoped)."""

    __tablename__ = "checklist_items"

    requirement_template_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("requirement_templates.id"), index=True
    )
    text: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class DocumentChecklist(BaseModel):
    """A filled checklist for a specific requirement within a document."""

    __tablename__ = "document_checklists"

    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id"), index=True
    )
    requirement_template_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("requirement_templates.id")
    )
    comments: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    attachment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("document_attachments.id", ondelete="SET NULL")
    )

    responses: Mapped[list["DocumentChecklistResponse"]] = relationship(
        back_populates="checklist", cascade="all, delete-orphan"
    )
    requirement_template: Mapped["RequirementTemplate"] = relationship()  # noqa: F821


class DocumentChecklistResponse(BaseModel):
    """Individual response to a checklist item within a document checklist."""

    __tablename__ = "document_checklist_responses"

    checklist_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("document_checklists.id", ondelete="CASCADE"),
        index=True,
    )
    checklist_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("checklist_items.id")
    )
    response: Mapped[str] = mapped_column(String(3))  # yes, no, na
    display_order: Mapped[int] = mapped_column(Integer, default=0)
    item_text: Mapped[str] = mapped_column(Text)  # snapshot of text at fill time

    checklist: Mapped[DocumentChecklist] = relationship(back_populates="responses")
