#!/usr/bin/env bash
set -e
pip install uv
uv sync
uv run alembic upgrade head
uv run python -m app.seed
uv run python -m app.seed_commissioning
# Clean duplicate tag targets from prior failed runs
uv run python -c "
import asyncio
from sqlalchemy import text
from app.core.database import async_session_factory
async def fix():
    async with async_session_factory() as db:
        await db.execute(text('''
            DELETE FROM asset_tag_targets WHERE id NOT IN (
                SELECT DISTINCT ON (asset_id, tag_code) id
                FROM asset_tag_targets ORDER BY asset_id, tag_code, created_at
            )
        '''))
        await db.commit()
        print('Cleaned duplicate tag targets.')
asyncio.run(fix())
"
uv run python -m app.seed_demo
