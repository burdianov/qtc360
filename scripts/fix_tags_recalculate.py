#!/usr/bin/env python3
"""One-shot: recalculate all requirement and tag statuses for a project.

Usage:
    python scripts/fix_tags_recalculate.py <project_id>
    uv run python scripts/fix_tags_recalculate.py <project_id>

Runs inside the backend container or on a host with DB access.
"""
import asyncio
import sys
import uuid

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.asset import Asset
from app.models.commissioning import AssetRequirement
from app.services.commissioning import recalculate_requirement_status, recalculate_tag_status


async def main():
    if len(sys.argv) != 2:
        print("Usage: python scripts/fix_tags_recalculate.py <project_id>")
        sys.exit(1)
    project_id = uuid.UUID(sys.argv[1])

    async with async_session_factory() as db:
        result = await db.execute(
            select(AssetRequirement.id, AssetRequirement.asset_id)
            .where(
                AssetRequirement.is_deleted == False,
                AssetRequirement.asset_id.in_(
                    select(Asset.id).where(
                        Asset.project_id == project_id,
                        Asset.is_deleted == False,
                    )
                ),
            )
        )
        rows = result.all()
        for ar_id, _ in rows:
            await recalculate_requirement_status(db, ar_id)
        asset_ids = list({r[1] for r in rows})
        for aid in asset_ids:
            await recalculate_tag_status(db, aid)
        await db.commit()
        print(f"Recalculated {len(rows)} requirements, {len(asset_ids)} tag targets")


if __name__ == "__main__":
    asyncio.run(main())
