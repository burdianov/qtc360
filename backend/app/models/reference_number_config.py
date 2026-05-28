import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class ReferenceNumberConfig(BaseModel):
    """Configures auto-numbering pattern per project + doc_type.

    Pattern example: "{project_code}-{contractor_code}-{discipline_code}-{doc_type}-{serial:04d}"
    Produces: MERC-JMJV-EL-WIR-0031

    The `project_code` field stores the short project code used in references
    (e.g. "MERC" for project 1728).
    """
    __tablename__ = "reference_number_configs"
    __table_args__ = (UniqueConstraint("project_id", "doc_type", name="uq_refnum_project_doctype"),)

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"))
    doc_type: Mapped[str] = mapped_column(String(10), index=True)  # WIR, MIR, CIR, FAT
    pattern: Mapped[str] = mapped_column(String(500))
    project_code: Mapped[str] = mapped_column(String(50))  # e.g. "MERC"
    contractor_code: Mapped[str] = mapped_column(String(50), default="")  # e.g. "JMJV"
    serial_start: Mapped[int] = mapped_column(default=1)
