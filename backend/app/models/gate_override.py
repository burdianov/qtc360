import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String, Text, event, func, inspect
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class GateOverrideAcknowledgement(BaseModel):
    __tablename__ = "gate_override_acknowledgements"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    asset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("assets.id")
    )
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id")
    )
    level_code: Mapped[str] = mapped_column(String(10))
    incomplete_requirements: Mapped[list] = mapped_column(
        JSONB
    )  # [{requirement_id, status}]
    acknowledged_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    notes: Mapped[str | None] = mapped_column(Text)

    # Relationships
    user: Mapped["User"] = relationship()  # noqa: F821
    asset: Mapped["Asset"] = relationship()  # noqa: F821
    document: Mapped["Document | None"] = relationship()  # noqa: F821


# Immutability enforcement: prevent updates to data fields, but allow soft-delete
# (is_deleted flag is itself an UPDATE, so we whitelist it explicitly).
_IMMUTABLE_BLOCKED = {
    "user_id",
    "asset_id",
    "document_id",
    "level_code",
    "incomplete_requirements",
    "acknowledged_at",
    "notes",
}


@event.listens_for(GateOverrideAcknowledgement, "before_update")
def _block_gate_override_update(
    mapper: Any, connection: Any, target: GateOverrideAcknowledgement
) -> None:
    state = inspect(target)
    for attr in state.attrs:
        if attr.key not in _IMMUTABLE_BLOCKED:
            continue
        hist = attr.history
        if hist.has_changes():
            raise ValueError(
                f"GateOverrideAcknowledgement.{attr.key} is immutable; cannot be modified after creation"
            )
