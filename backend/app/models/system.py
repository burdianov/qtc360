import uuid

from sqlalchemy import Column, ForeignKey, String, Table, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, BaseModel

asset_systems = Table(
    "asset_systems",
    Base.metadata,
    Column(
        "asset_id",
        UUID(as_uuid=True),
        ForeignKey("assets.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "system_id",
        UUID(as_uuid=True),
        ForeignKey("systems.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class System(BaseModel):
    __tablename__ = "systems"
    __table_args__ = (
        UniqueConstraint("code", "project_id", name="uq_system_code_project"),
    )

    name: Mapped[str] = mapped_column(String(255))
    code: Mapped[str] = mapped_column(String(50), index=True)
    description: Mapped[str | None] = mapped_column(String(1000))
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id")
    )

    assets: Mapped[list["Asset"]] = relationship(secondary=asset_systems)  # noqa: F821
