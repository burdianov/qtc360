import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class Service(BaseModel):
    __tablename__ = "services"
    __table_args__ = (UniqueConstraint("code", "discipline_id", name="uq_service_code_discipline"),)

    name: Mapped[str] = mapped_column(String(255))
    code: Mapped[str] = mapped_column(String(50), index=True)
    discipline_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("disciplines.id"))

    discipline: Mapped["Discipline"] = relationship(back_populates="services")  # noqa: F821
    asset_types: Mapped[list["AssetType"]] = relationship(back_populates="service")  # noqa: F821
