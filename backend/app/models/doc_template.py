import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, LargeBinary, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class DocTemplate(BaseModel):
    """Stores uploaded Word DOCX templates for report generation."""

    __tablename__ = "doc_templates"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), index=True)
    doc_type: Mapped[str] = mapped_column(String(10), index=True)  # WIR, MIR, CIR
    name: Mapped[str] = mapped_column(String(255))
    file: Mapped[bytes] = mapped_column(LargeBinary)
    filename: Mapped[str] = mapped_column(String(255))
    version: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
