from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class Designation(BaseModel):
    __tablename__ = "designations"

    name: Mapped[str] = mapped_column(String(255), unique=True)
