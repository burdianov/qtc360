import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel


class DocumentTemplate(BaseModel):
    """Stores the visual template schema for document cover sheets.

    The `schema` JSONB field stores the full template definition:
    {
        "margins": {"top": 20, "right": 15, "bottom": 20, "left": 15},
        "font": "Arial",
        "fontSize": 10,
        "header": {"imageUrl": "/uploads/header.jpg", "height": 60},
        "footer": {"sections": [...]},
        "sections": [
            {
                "label": "Section Name",
                "gap": 5,
                "rows": [
                    {
                        "height": 25,
                        "evenCells": true,
                        "isTitle": false,
                        "titleColor": null,
                        "font": null,
                        "fontSize": null,
                        "expandToFooter": false,
                        "cells": [
                            {
                                "width": 50,
                                "type": "label",       # label | data
                                "variant": "text",     # text | checkbox
                                "value": "Inspector:", # static text for labels
                                "fieldKey": null,      # for data cells, maps to form field
                                "checkboxLabel": null  # for checkbox variant
                            }
                        ]
                    }
                ]
            }
        ]
    }
    """
    __tablename__ = "document_templates"
    __table_args__ = (UniqueConstraint("project_id", "doc_type", name="uq_template_project_doctype"),)

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"))
    doc_type: Mapped[str] = mapped_column(String(10), index=True)  # WIR, MIR, CIR
    name: Mapped[str] = mapped_column(String(255))
    schema: Mapped[dict] = mapped_column(JSONB, default=dict)
