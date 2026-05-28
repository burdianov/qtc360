import uuid

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class ReferenceNumberConfig(BaseModel):
    """Configures auto-numbering pattern per project + doc_type.

    Pattern example: "{project_code}-{contractor_code}-{discipline_code}-{doc_type}-{serial:04d}"
    Produces: MERC-JMJV-EL-WIR-0031

    The `project_code` field stores the short project code used in references
    (e.g. "MERC" for project 1728).

    Serial allocation: callers SELECT FOR UPDATE this row, then bump
    ``next_serial`` atomically. Soft-deleted documents do NOT free up serials.
    """
    __tablename__ = "reference_number_configs"
    __table_args__ = (UniqueConstraint("project_id", "doc_type", name="uq_refnum_project_doctype"),)

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"))
    doc_type: Mapped[str] = mapped_column(String(10), index=True)  # WIR, MIR, CIR, FAT
    pattern: Mapped[str] = mapped_column(String(500))
    project_code: Mapped[str] = mapped_column(String(50))  # e.g. "MERC"
    contractor_code: Mapped[str] = mapped_column(String(50), default="")  # e.g. "JMJV"
    serial_start: Mapped[int] = mapped_column(default=1)
    # Monotonic counter: this is the next serial we'll allocate. Starts at serial_start.
    # We bump it under SELECT FOR UPDATE to prevent duplicate reference_no generation.
    next_serial: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
