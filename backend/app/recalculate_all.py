"""Recalculate all asset requirement statuses and tag achievements.

Fixes stale cached statuses that have drifted from actual evidence.
Run: cd backend && uv run python -m app.recalculate_all
"""

import asyncio

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.commissioning import AssetRequirement
from app.services.commissioning import (
    recalculate_requirement_status,
    recalculate_tag_status,
)


async def recalculate_all():
    async with async_session_factory() as db:
        async with db.begin():
            result = await db.execute(
                select(
                    AssetRequirement.id,
                    AssetRequirement.asset_id,
                    AssetRequirement.status,
                ).where(AssetRequirement.is_deleted == False)  # noqa: E712
            )
            rows = result.all()
            print(f"Recalculating {len(rows)} requirements...")

            changed = 0
            for ar_id, asset_id, old_status in rows:
                new_status = await recalculate_requirement_status(db, ar_id)
                if new_status != old_status:
                    changed += 1
                    print(f"  CHANGED: {ar_id} {old_status} -> {new_status}")

            # Recalculate tags
            asset_ids = list({r[1] for r in rows})
            print(f"Recalculating tags for {len(asset_ids)} assets...")
            for aid in asset_ids:
                await recalculate_tag_status(db, aid)

        print(f"Done. {changed} requirements updated.")


if __name__ == "__main__":
    asyncio.run(recalculate_all())
