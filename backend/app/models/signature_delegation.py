import uuid as uuid_mod

from sqlalchemy import Boolean, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import BaseModel


class SignatureDelegation(BaseModel):
    __tablename__ = "signature_delegations"

    grantor_id: Mapped[uuid_mod.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    delegate_id: Mapped[uuid_mod.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))

    grantor: Mapped["User"] = relationship(foreign_keys=[grantor_id])  # noqa: F821
    delegate: Mapped["User"] = relationship(foreign_keys=[delegate_id])  # noqa: F821
