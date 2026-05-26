import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class Discipline(BaseModel):
    __tablename__ = "disciplines"

    name: Mapped[str] = mapped_column(String(255))
    code: Mapped[str] = mapped_column(String(50), index=True)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"))

    project: Mapped["Project"] = relationship(back_populates="disciplines")  # noqa: F821
    services: Mapped[list["Service"]] = relationship(back_populates="discipline", lazy="selectin")  # noqa: F821
