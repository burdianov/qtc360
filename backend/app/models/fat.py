import uuid

from sqlalchemy import Column, ForeignKey, String, Table, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, BaseModel


fat_assets = Table(
    "fat_assets",
    Base.metadata,
    Column("fat_id", UUID(as_uuid=True), ForeignKey("fats.id", ondelete="CASCADE"), primary_key=True),
    Column("asset_id", UUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), primary_key=True),
)


class FAT(BaseModel):
    __tablename__ = "fats"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"))
    reference: Mapped[str] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text)
    asset_type_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("asset_types.id"))
    status: Mapped[str] = mapped_column(String(30), default="pending")  # pending, approved

    # Relationships
    project: Mapped["Project"] = relationship()  # noqa: F821
    asset_type: Mapped["AssetType"] = relationship()  # noqa: F821
    assets: Mapped[list["Asset"]] = relationship(secondary=fat_assets)  # noqa: F821
