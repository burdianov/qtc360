"""Shared commissioning helpers — kept separate from __init__.py to avoid
circular imports when sub-modules import these functions."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def project_id_for_asset(
    db: AsyncSession, asset_id: uuid.UUID
) -> uuid.UUID | None:
    from app.models.asset import Asset

    res = await db.execute(select(Asset.project_id).where(Asset.id == asset_id))
    return res.scalar_one_or_none()


async def project_id_for_asset_requirement(
    db: AsyncSession, ar_id: uuid.UUID
) -> uuid.UUID | None:
    from app.models.asset import Asset
    from app.models.commissioning import AssetRequirement

    res = await db.execute(
        select(Asset.project_id)
        .join(AssetRequirement, AssetRequirement.asset_id == Asset.id)
        .where(AssetRequirement.id == ar_id)
    )
    return res.scalar_one_or_none()


async def project_id_for_document(
    db: AsyncSession, doc_id: uuid.UUID
) -> uuid.UUID | None:
    from app.models.document import Document

    res = await db.execute(select(Document.project_id).where(Document.id == doc_id))
    return res.scalar_one_or_none()
