import uuid as uuid_mod
from datetime import datetime

from sqlalchemy import String, Boolean, Column, DateTime, ForeignKey, Integer, Table
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, BaseModel

user_projects = Table(
    "user_projects",
    Base.metadata,
    Column(
        "user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "project_id",
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class User(BaseModel):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(50))
    designation_id: Mapped[uuid_mod.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("designations.id")
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    password_reset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    signature_font: Mapped[str | None] = mapped_column(
        String(50), default="dancing_script"
    )
    signature_text: Mapped[str | None] = mapped_column(String(255), default=None)
    signature_path: Mapped[str | None] = mapped_column(String(500), default=None)
    # Bumped on password change / admin reset to invalidate outstanding tokens.
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    designation: Mapped["Designation | None"] = relationship()  # noqa: F821
    roles: Mapped[list["Role"]] = relationship(  # noqa: F821
        secondary="user_roles", back_populates="users"
    )
    projects: Mapped[list["Project"]] = relationship(  # noqa: F821
        secondary=user_projects
    )
