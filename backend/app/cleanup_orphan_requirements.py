"""Repair stale 'achieved' asset_requirements left over from hard-deleted documents.

The hard-delete path in `delete_document` used to call
`recalculate_requirements_for_document` *before* wiping the document and its
DocumentRequirementLink rows, which stamped the linked requirement as
'achieved' from a still-present 'approved' document. The document + link
were then hard-deleted in the same transaction, but the cached
AssetRequirement.status was never recomputed again — so the matrix kept
showing a green dot for a requirement with zero evidence behind it.

This script is the one-shot repair for that data:
  1. Find every asset_requirement whose cached status (achieved / partial /
     submitted / rejected) is no longer supported by any active link or
     active approved work item, and run it through
     `recalculate_requirement_status` so the cached state matches reality.
  2. Hard-delete orphan soft-deleted requirement_work_items (PWR-CBL
     leftovers from WIR create/delete cycles).
  3. Hard-delete orphan soft-deleted document_requirement_links (rows whose
     document was already hard-deleted elsewhere).

It also prints a pre/post diff so you can see exactly what changed.

Run:
    cd backend
    uv run python -m app.cleanup_orphan_requirements
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.models.commissioning import AssetRequirement
from app.services.commissioning import recalculate_requirement_status


def _build_engine():
    return create_async_engine(settings.database_url, poolclass=NullPool)


def _fmt(ar: AssetRequirement) -> str:
    return (
        f"{ar.id} (asset={ar.asset_id}, tmpl={ar.requirement_template_id}, "
        f"status={ar.status!r}, progress={ar.progress_percent})"
    )


async def _snapshot_stale_ars(
    session: AsyncSession,
) -> list[tuple[str, str, str, float]]:
    """Return (id, status, progress_percent, is_stale_score) for every non-not_started
    requirement that no longer has any live evidence (active link or active
    approved work item)."""
    rows = (
        await session.execute(
            text(
                """
                SELECT
                  ar.id::text,
                  ar.status,
                  ar.progress_percent,
                  (
                    SELECT count(*) FROM document_requirement_links drl
                    WHERE drl.asset_requirement_id = ar.id
                      AND drl.is_deleted = false
                  ) AS active_links,
                  (
                    SELECT count(*) FROM requirement_work_items rwi
                    WHERE rwi.asset_requirement_id = ar.id
                      AND rwi.is_deleted = false
                  ) AS active_wi,
                  (
                    SELECT count(*) FROM requirement_work_items rwi
                    WHERE rwi.asset_requirement_id = ar.id
                      AND rwi.is_deleted = false
                      AND rwi.status = 'approved'
                  ) AS approved_wi
                FROM asset_requirements ar
                WHERE ar.is_deleted = false
                  AND ar.status IN ('achieved', 'partial', 'submitted', 'rejected')
                """
            )
        )
    ).fetchall()
    stale: list[tuple[str, str, str, float]] = []
    for ar_id, status_, progress, active_links, active_wi, approved_wi in rows:
        if active_links == 0 and active_wi == 0:
            # No evidence at all — must be stale.
            stale.append((ar_id, status_, progress, 0.0))
        elif active_wi > 0 and approved_wi == 0:
            # Work breakdown exists but nothing approved — could be legitimate
            # 'partial' / 'submitted' / 'not_started' that was mis-cached as
            # 'achieved'. The recalc helper will fix it.
            stale.append((ar_id, status_, progress, 0.0))
    return stale


async def recalc_orphan_ars(session: AsyncSession) -> list[tuple[str, str, str]]:
    """Recalculate every stale asset_requirement and return (id, before, after)
    tuples for the report."""
    stale = await _snapshot_stale_ars(session)
    print(f"Found {len(stale)} stale asset_requirement(s) to recalc.")
    transitions: list[tuple[str, str, str]] = []
    for ar_id, before_status, before_progress, _score in stale:
        result = await session.execute(
            select(AssetRequirement).where(AssetRequirement.id == ar_id)
        )
        ar = result.scalar_one_or_none()
        if ar is None:
            print(f"  - {ar_id}: missing, skipping")
            continue
        new_status = await recalculate_requirement_status(session, ar_id)
        # The recalc helper also clears actual_completion_date / approved_date
        # when the requirement drops out of 'achieved'.
        await session.refresh(ar)
        change = (
            f"{ar_id}: {before_status}/{before_progress} -> {new_status}/{ar.progress_percent}"
            + (
                f"  (cleared completion={ar.actual_completion_date}, approved={ar.approved_date})"
                if new_status != "achieved"
                and (ar.actual_completion_date or ar.approved_date)
                else ""
            )
        )
        print(f"  - {change}")
        transitions.append((ar_id, before_status, new_status))
    return transitions


async def reset_stale_approved_work_items(
    session: AsyncSession,
) -> tuple[int, list[str]]:
    """Reset live work items whose 'approved' status no longer has backing
    evidence (the linking document is gone / soft-deleted / no longer
    approved, or the document_requirement_link was soft-deleted). These
    would otherwise keep the parent requirement stuck in 'partial' /
    'achieved' forever with no real evidence behind it.

    Returns (count_reset, list_of_affected_asset_requirement_ids).
    """
    rows = (
        await session.execute(
            text(
                """
                SELECT id::text, name, status, linked_document_id::text,
                       asset_requirement_id::text
                FROM requirement_work_items
                WHERE is_deleted = false
                  AND status = 'approved'
                  AND linked_document_id IS NOT NULL
                  AND (
                    -- Backing document is gone, soft-deleted, or no longer
                    -- approved/approved_with_comments.
                    NOT EXISTS (
                      SELECT 1 FROM documents d
                      WHERE d.id = linked_document_id
                        AND d.is_deleted = false
                        AND d.status IN ('approved', 'approved_with_comments')
                    )
                    -- Or the linking row was soft-deleted.
                    OR NOT EXISTS (
                      SELECT 1 FROM document_requirement_links drl
                      WHERE drl.requirement_work_item_id = requirement_work_items.id
                        AND drl.document_id = requirement_work_items.linked_document_id
                        AND drl.is_deleted = false
                    )
                  )
                """
            )
        )
    ).fetchall()
    if not rows:
        print("No stale 'approved' work items to reset.")
        return 0, []
    print(f"Resetting {len(rows)} stale 'approved' work item(s) to 'not_started':")
    affected_ar_ids: set[str] = set()
    for wid, name, status_, doc_id, ar_id in rows:
        print(f"  - {wid}  {name!r}  (linked_document={doc_id}, ar={ar_id})")
        affected_ar_ids.add(ar_id)
    ids = [r[0] for r in rows]
    await session.execute(
        text(
            "UPDATE requirement_work_items "
            "SET status = 'not_started', approved_date = NULL, linked_document_id = NULL "
            "WHERE id::text = ANY(:ids)"
        ),
        {"ids": ids},
    )
    return len(ids), sorted(affected_ar_ids)


async def purge_orphan_work_items(session: AsyncSession) -> int:
    """Hard-delete soft-deleted requirement_work_items that are not referenced
    by any live document_requirement_link (i.e. they became orphans the moment
    their owning document was hard-deleted, but the work-item row stayed
    behind as soft-deleted crud)."""
    rows = (
        await session.execute(
            text(
                """
                SELECT id::text, name, asset_requirement_id::text
                FROM requirement_work_items
                WHERE is_deleted = true
                  AND id NOT IN (
                    SELECT requirement_work_item_id FROM document_requirement_links
                    WHERE requirement_work_item_id IS NOT NULL
                  )
                """
            )
        )
    ).fetchall()
    if not rows:
        print("No orphan soft-deleted work items to purge.")
        return 0
    print(f"Hard-deleting {len(rows)} orphan soft-deleted work item(s):")
    for wid, name, ar_id in rows:
        print(f"  - {wid}  {name!r}  (asset_requirement {ar_id})")
    ids = [r[0] for r in rows]
    await session.execute(
        text("DELETE FROM requirement_work_items WHERE id::text = ANY(:ids)"),
        {"ids": ids},
    )
    return len(ids)


async def purge_orphan_links(session: AsyncSession) -> int:
    """Hard-delete soft-deleted document_requirement_links whose document is
    already gone (hard-deleted elsewhere)."""
    rows = (
        await session.execute(
            text(
                """
                SELECT id::text, document_id::text, asset_requirement_id::text
                FROM document_requirement_links
                WHERE is_deleted = true
                  AND document_id NOT IN (SELECT id FROM documents)
                """
            )
        )
    ).fetchall()
    if not rows:
        print("No orphan soft-deleted document_requirement_links to purge.")
        return 0
    print(
        f"Hard-deleting {len(rows)} orphan soft-deleted document_requirement_link(s):"
    )
    for lid, doc_id, ar_id in rows:
        print(f"  - {lid}  doc={doc_id}  ar={ar_id}")
    ids = [r[0] for r in rows]
    await session.execute(
        text("DELETE FROM document_requirement_links WHERE id::text = ANY(:ids)"),
        {"ids": ids},
    )
    return len(ids)


async def main() -> None:
    engine = _build_engine()
    Session = async_sessionmaker(engine, expire_on_commit=False)

    print("=" * 70)
    print("Cleaning up orphan + stale commissioning rows")
    print("=" * 70)

    async with Session() as session:
        async with session.begin():
            # Step 1: reset stale 'approved' work items first — once their
            # backing document/link is gone, the work item no longer counts
            # as approved, and the parent requirement must be re-evaluated.
            wi_reset, affected_ar_ids = await reset_stale_approved_work_items(session)
            # Step 2: recalc the requirements touched by the work-item reset
            # (in addition to the structural staleness scan below).
            reset_transitions: list[tuple[str, str, str]] = []
            for ar_id in affected_ar_ids:
                result = await session.execute(
                    select(AssetRequirement).where(AssetRequirement.id == ar_id)
                )
                ar = result.scalar_one_or_none()
                if ar is None:
                    continue
                before_status = ar.status
                new_status = await recalculate_requirement_status(session, ar_id)
                await session.refresh(ar)
                change = f"  - {ar_id}: {before_status} -> {new_status}"
                print(change)
                reset_transitions.append((ar_id, before_status, new_status))
            # Step 3: catch the structural staleness (requirements whose only
            # evidence has already disappeared) and recalc those too.
            transitions = await recalc_orphan_ars(session)
            wi_deleted = await purge_orphan_work_items(session)
            link_deleted = await purge_orphan_links(session)

        # Separate commit for the recalc side effects — recalc_requirement_status
        # relies on the session's identity map, so a follow-up session refresh
        # would otherwise re-load the just-flushed state.
        await session.commit()

    print()
    print("=" * 70)
    print("Summary")
    print("=" * 70)
    print(f"  stale work items reset              : {wi_reset}")
    print(f"  asset_requirements recalc'd (reset) : {len(reset_transitions)}")
    print(f"  asset_requirements recalc'd (struct): {len(transitions)}")
    print(f"  requirement_work_items purged       : {wi_deleted}")
    print(f"  document_requirement_links purged   : {link_deleted}")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
