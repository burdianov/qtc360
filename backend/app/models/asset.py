import uuid

from sqlalchemy import Boolean, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class Asset(BaseModel):
    __tablename__ = "assets"
    __table_args__ = (
        UniqueConstraint("project_id", "tag_number", name="uq_asset_project_tagnumber"),
        Index("ix_assets_project_id", "project_id"),
    )

    name: Mapped[str] = mapped_column(String(255))
    tag_number: Mapped[str] = mapped_column(String(100), index=True)
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id")
    )
    asset_type_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("asset_types.id")
    )
    location: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(
        String(30), default="pending"
    )  # pending, installed, commissioned
    is_critical: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    custom_fields: Mapped[dict] = mapped_column(
        JSONB, server_default="{}"
    )

    asset_type: Mapped["AssetType"] = relationship(back_populates="assets")  # noqa: F821
    project: Mapped["Project | None"] = relationship()  # noqa: F821
    requirements: Mapped[list["AssetRequirement"]] = relationship(  # noqa: F821
        back_populates="asset", viewonly=True
    )
