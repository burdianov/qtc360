"""Wipe all documents from the dev DB and reset the per-(project, doc_type,
discipline) reference counters to their configured ``serial_start``.

This is the "nuclear" version of ``tests.helpers.cleanup.hard_delete_documents``:
the test helper only deletes the IDs you pass it and only decrements counters
by the number of those rows; this one empties the documents table outright.

Order mirrors ``tests/helpers/cleanup.py`` so the FK chain stays consistent:

    1. document_attachments
    2. document_approval_rounds
    3. document_assets
    4. document_requirement_links
    5. gate_override_acknowledgements
    6. requirement_work_items (via linked_document_id, not document_id)
    7. documents

Then resets every ``reference_number_counters.next_serial`` to the
matching ``reference_number_configs.serial_start`` (falling back to 1
when no config row exists).

Flags:
  --yes                       skip the "Type 'yes' to proceed" prompt.
  --purge-orphan-work-items   hard-delete live ``requirement_work_items`` with
                              ``linked_document_id IS NULL`` and refresh the
                              status of every affected ``asset_requirement``.
                              Catches the partial-scope path's orphans that
                              the document-FK sweep misses.
  --purge-notifications       hard-delete every row in ``notifications``.
                              Useful for sweeping stale "Document Approved"
                              leftovers from prior e2e runs.

Run with --yes to skip the confirmation prompt:

    uv run python purge_documents.py --yes
    uv run python purge_documents.py --yes --purge-orphan-work-items
    uv run python purge_documents.py --yes --purge-orphan-work-items --purge-notifications
"""

from __future__ import annotations

import argparse
import asyncio
import sys

sys.path.insert(0, r"D:\QTC360\qtc360\backend")

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.services.commissioning import recalculate_requirement_status


_FK_CHAIN_TO_DOCUMENTS: tuple[str, ...] = (
    "document_checklists",
    "document_attachments",
    "document_approval_rounds",
    "document_assets",
    "document_requirement_links",
    "gate_override_acknowledgements",
)


def _build_engine():
    return create_async_engine(settings.database_url, poolclass=NullPool)


async def _count(session: AsyncSession, table: str, where: str = "") -> int:
    sql = f"SELECT count(*) FROM {table}"
    if where:
        sql += f" WHERE {where}"
    result = await session.execute(text(sql))
    return int(result.scalar() or 0)


async def purge_documents(confirm: bool) -> int:
    """Hard-delete every document + FK chain child and reset all reference counters.

    Returns the number of document rows deleted.
    """
    engine = _build_engine()
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as session:
        async with session.begin():
            doc_count = await _count(session, "documents")
            counts_before = {
                t: await _count(session, t) for t in _FK_CHAIN_TO_DOCUMENTS
            }
            linked_wi = await _count(
                session, "requirement_work_items", "linked_document_id IS NOT NULL"
            )
            counter_rows = (
                await session.execute(
                    text(
                        "SELECT c.project_id, c.doc_type, c.discipline_id, "
                        "       c.next_serial, COALESCE(cfg.serial_start, 1) AS serial_start "
                        "FROM reference_number_counters c "
                        "LEFT JOIN reference_number_configs cfg "
                        "  ON cfg.project_id = c.project_id "
                        " AND cfg.doc_type = c.doc_type "
                        " AND cfg.is_deleted = false"
                    )
                )
            ).fetchall()

    print("About to delete (documents + FK chain):")
    print(f"  documents                       : {doc_count}")
    for t, n in counts_before.items():
        print(f"  {t:<32}: {n}")
    print(f"  {'requirement_work_items_linked':<32}: {linked_wi}")
    print()
    print("Reference counters will be reset to their serial_start:")
    for project_id, doc_type, discipline_id, next_serial, serial_start in counter_rows:
        print(
            f"  {doc_type:<4} disc={discipline_id}  "
            f"next_serial {next_serial} -> {serial_start}"
        )
    print()

    if confirm:
        answer = input("Type 'yes' to proceed: ")
        if answer.strip().lower() != "yes":
            print("Aborted.")
            await engine.dispose()
            return 0

    async with Session() as session:
        async with session.begin():
            for table in _FK_CHAIN_TO_DOCUMENTS:
                await session.execute(text(f"DELETE FROM {table}"))
            await session.execute(
                text(
                    "DELETE FROM requirement_work_items "
                    "WHERE linked_document_id IS NOT NULL"
                )
            )
            docs_deleted = (
                await session.execute(text("DELETE FROM documents"))
            ).rowcount

            for (
                project_id,
                doc_type,
                discipline_id,
                _next,
                serial_start,
            ) in counter_rows:
                await session.execute(
                    text(
                        "UPDATE reference_number_counters "
                        "SET next_serial = :start "
                        "WHERE project_id = :p AND doc_type = :d "
                        "  AND discipline_id = :disc"
                    ),
                    {
                        "start": serial_start,
                        "p": project_id,
                        "d": doc_type,
                        "disc": discipline_id,
                    },
                )

    print(f"Deleted {docs_deleted} document(s) and reset all reference counters.")
    await engine.dispose()
    return docs_deleted


async def purge_orphan_work_items(confirm: bool) -> int:
    """Hard-delete live ``requirement_work_items`` with ``linked_document_id IS NULL``
    and recalculate the status of every affected ``asset_requirement``.

    The partial-scope path on the WIR/MIR/CIR form creates work items WITHOUT
    setting ``linked_document_id`` (it goes through ``document_requirement_links``
    instead). When the document is purged, those work items are orphaned: the
    document-FK sweep above only catches rows that *do* have ``linked_document_id``
    pointing at the deleted doc. This function cleans up the rest.

    Returns the number of work item rows deleted.
    """
    engine = _build_engine()
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as session:
        async with session.begin():
            orphan_count = await _count(
                session,
                "requirement_work_items",
                "linked_document_id IS NULL AND is_deleted = false",
            )
            affected_ars = (
                await session.execute(
                    text(
                        "SELECT DISTINCT asset_requirement_id "
                        "FROM requirement_work_items "
                        "WHERE linked_document_id IS NULL AND is_deleted = false"
                    )
                )
            ).fetchall()

    if orphan_count == 0:
        print("No live orphan work items to purge.")
        await engine.dispose()
        return 0

    print(
        f"About to hard-delete {orphan_count} live orphan work item(s) "
        f"affecting {len(affected_ars)} asset_requirement(s):"
    )
    for (ar_id,) in affected_ars:
        print(f"  asset_requirement {ar_id}")
    print()

    if confirm:
        answer = input("Type 'yes' to proceed: ")
        if answer.strip().lower() != "yes":
            print("Aborted.")
            await engine.dispose()
            return 0

    async with Session() as session:
        async with session.begin():
            await session.execute(
                text(
                    "DELETE FROM requirement_work_items "
                    "WHERE linked_document_id IS NULL AND is_deleted = false"
                )
            )

    # Status recalculation is a separate transaction so the model in
    # ``recalculate_requirement_status`` can use the session's identity map
    # freely; the hard-delete above is already committed.
    async with Session() as session:
        for (ar_id,) in affected_ars:
            new_status = await recalculate_requirement_status(session, ar_id)
            print(f"  asset_requirement {ar_id}: status -> {new_status}")
        await session.commit()

    print(f"Deleted {orphan_count} orphan work item(s).")
    await engine.dispose()
    return orphan_count


async def purge_notifications(confirm: bool) -> int:
    """Hard-delete every row in ``notifications``. Use with care — there is no FK
    cascade, so this is safe, but users will lose their inbox contents."""
    engine = _build_engine()
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as session:
        async with session.begin():
            count = await _count(session, "notifications")

    if count == 0:
        print("No notifications to purge.")
        await engine.dispose()
        return 0

    print(f"About to delete {count} notification(s).")
    if confirm:
        answer = input("Type 'yes' to proceed: ")
        if answer.strip().lower() != "yes":
            print("Aborted.")
            await engine.dispose()
            return 0

    async with Session() as session:
        async with session.begin():
            await session.execute(text("DELETE FROM notifications"))
    print(f"Deleted {count} notification(s).")
    await engine.dispose()
    return count


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip the confirmation prompt.",
    )
    parser.add_argument(
        "--purge-orphan-work-items",
        action="store_true",
        help=(
            "Hard-delete live requirement_work_items with linked_document_id IS NULL "
            "(partial-scope orphans not caught by the document-FK sweep) and "
            "recalculate the status of the affected asset_requirements."
        ),
    )
    parser.add_argument(
        "--purge-notifications",
        action="store_true",
        help="Hard-delete every row in the notifications table.",
    )
    args = parser.parse_args()
    confirm = not args.yes

    await purge_documents(confirm=confirm)
    if args.purge_orphan_work_items:
        print()
        await purge_orphan_work_items(confirm=confirm)
    if args.purge_notifications:
        print()
        await purge_notifications(confirm=confirm)


if __name__ == "__main__":
    asyncio.run(main())
