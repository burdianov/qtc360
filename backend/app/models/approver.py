import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class ApproverTitle(BaseModel):
    __tablename__ = "approver_titles"

    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(255))


class Approver(BaseModel):
    __tablename__ = "approvers"

    name: Mapped[str] = mapped_column(String(255))
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    title_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("approver_titles.id"))

    title: Mapped[ApproverTitle] = relationship(lazy="selectin")
