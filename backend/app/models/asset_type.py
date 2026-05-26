import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class AssetType(BaseModel):
    __tablename__ = "asset_types"

    name: Mapped[str] = mapped_column(String(255))
    code: Mapped[str] = mapped_column(String(50), index=True)
    service_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("services.id"))
    parent_type_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("asset_types.id"))

    service: Mapped["Service"] = relationship(back_populates="asset_types")  # noqa: F821
    parent_type: Mapped["AssetType | None"] = relationship(remote_side="AssetType.id", lazy="selectin")
    subtypes: Mapped[list["AssetType"]] = relationship(back_populates="parent_type", lazy="selectin")
    assets: Mapped[list["Asset"]] = relationship(back_populates="asset_type", lazy="selectin")  # noqa: F821
