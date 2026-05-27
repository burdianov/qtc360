import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class GateOverrideAcknowledgement(BaseModel):
    __tablename__ = "gate_override_acknowledgements"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    asset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("assets.id"))
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"))
    level_code: Mapped[str] = mapped_column(String(10))
    incomplete_requirements: Mapped[dict] = mapped_column(JSONB)  # [{requirement_id, status}]
    acknowledged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    notes: Mapped[str | None] = mapped_column(Text)

    # Relationships
    user: Mapped["User"] = relationship()  # noqa: F821
    asset: Mapped["Asset"] = relationship()  # noqa: F821
    document: Mapped["Document"] = relationship()  # noqa: F821
