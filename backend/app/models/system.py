import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class System(BaseModel):
    __tablename__ = "systems"

    name: Mapped[str] = mapped_column(String(255))
    code: Mapped[str] = mapped_column(String(50), index=True)
    description: Mapped[str | None] = mapped_column(String(1000))
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"))
