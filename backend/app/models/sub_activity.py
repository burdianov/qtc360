import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class SubActivity(BaseModel):
    __tablename__ = "sub_activities"

    name: Mapped[str] = mapped_column(String(255))
    code: Mapped[str] = mapped_column(String(50), index=True)
    activity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("activities.id"))

    activity: Mapped["Activity"] = relationship(back_populates="sub_activities")  # noqa: F821
