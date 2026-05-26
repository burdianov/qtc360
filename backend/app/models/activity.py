import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class Activity(BaseModel):
    __tablename__ = "activities"
    __table_args__ = (UniqueConstraint("code", "service_id", name="uq_activity_code_service"),)

    name: Mapped[str] = mapped_column(String(255))
    code: Mapped[str] = mapped_column(String(50), index=True)
    service_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("services.id"))
    is_milestone: Mapped[bool] = mapped_column(default=False)

    service: Mapped["Service"] = relationship()  # noqa: F821
    sub_activities: Mapped[list["SubActivity"]] = relationship(back_populates="activity")  # noqa: F821
