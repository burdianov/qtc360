import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class Project(BaseModel):
    __tablename__ = "projects"

    name: Mapped[str] = mapped_column(String(255))
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    external_code: Mapped[str | None] = mapped_column(String(50))
    description: Mapped[str | None] = mapped_column(String(1000))
    status: Mapped[str] = mapped_column(String(20), default="active")  # active, completed, on_hold
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    client_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id"))

    client: Mapped["Client"] = relationship()  # noqa: F821
    approvers: Mapped[list["ProjectApprover"]] = relationship(back_populates="project")  # noqa: F821
    disciplines: Mapped[list["Discipline"]] = relationship(back_populates="project")  # noqa: F821
