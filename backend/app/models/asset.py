import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class Asset(BaseModel):
    __tablename__ = "assets"

    name: Mapped[str] = mapped_column(String(255))
    tag_number: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    asset_type_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("asset_types.id"))
    location: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(30), default="pending")  # pending, installed, commissioned

    asset_type: Mapped["AssetType"] = relationship(back_populates="assets")  # noqa: F821
    requirements: Mapped[list["AssetRequirement"]] = relationship(back_populates="asset", viewonly=True)  # noqa: F821
