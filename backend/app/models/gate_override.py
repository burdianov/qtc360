import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String, Text, event, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class GateOverrideAcknowledgement(BaseModel):
    __tablename__ = "gate_override_acknowledgements"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    asset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("assets.id"))
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id"))
    level_code: Mapped[str] = mapped_column(String(10))
    incomplete_requirements: Mapped[list] = mapped_column(JSONB)  # [{requirement_id, status}]
    acknowledged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    notes: Mapped[str | None] = mapped_column(Text)

    # Relationships
    user: Mapped["User"] = relationship()  # noqa: F821
    asset: Mapped["Asset"] = relationship()  # noqa: F821
    document: Mapped["Document"] = relationship()  # noqa: F821


# Immutability enforcement: prevent updates and soft-deletes
@event.listens_for(GateOverrideAcknowledgement, "before_update")
def _block_gate_override_update(mapper: Any, connection: Any, target: GateOverrideAcknowledgement) -> None:
    raise ValueError("GateOverrideAcknowledgement records are immutable and cannot be updated")
