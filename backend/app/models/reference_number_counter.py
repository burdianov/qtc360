import uuid

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class ReferenceNumberCounter(BaseModel):
    __tablename__ = "reference_number_counters"

    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "doc_type",
            "discipline_id",
            name="uq_refnum_counter_project_doctype_discipline",
        ),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    doc_type: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    discipline_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("disciplines.id"), nullable=False)
    next_serial: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")