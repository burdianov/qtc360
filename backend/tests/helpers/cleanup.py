"""
Shared teardown helpers for the integration test suite.

These tests run against the live dev backend (http://localhost:8000) and
create real documents. After every test the docs must be hard-deleted so
re-runs do not pollute the dev DB.

The HTTP DELETE endpoint soft-deletes submitted docs (supersedes them so
the audit chain is preserved) — that is the *correct* production behaviour
but it leaves rows behind and is not what tests want. ``hard_delete_documents``
bypasses the API and issues a direct ``DELETE`` against the DB in
FK-respecting order.

Tables with FKs to ``documents`` (in delete order):

  1. document_attachments          (NO ACTION on document)
  2. document_approval_rounds      (CASCADE on document)
  3. document_assets               (CASCADE on document)
  4. document_requirement_links    (NO ACTION on document)
  5. gate_override_acknowledgements (NO ACTION on document, nullable)
  6. requirement_work_items        (NO ACTION on documents.linked_document_id, nullable)
  7. documents                     (the row)

Connection pooling: pytest-asyncio strict mode gives every test its own
event loop, which makes pooled asyncpg connections go stale
("another operation is in progress"). ``hard_delete_documents`` uses
``NullPool`` so each call gets a brand-new connection bound to the
current event loop.
"""

from __future__ import annotations

from typing import Iterable

from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings


# A dedicated engine for test teardown. NullPool avoids the stale-connection
# issue with pytest-asyncio's per-test event loops; create_async_engine uses
# the same DATABASE_URL as the app but a fresh pool of size 0.
_test_engine = create_async_engine(settings.database_url, poolclass=NullPool)
_test_session_factory = async_sessionmaker(_test_engine, expire_on_commit=False)


# Order matters: delete child tables that don't cascade before their parents.
_FK_CHAIN_TO_DOCUMENTS: tuple[str, ...] = (
    "document_attachments",
    "document_approval_rounds",
    "document_assets",
    "document_requirement_links",
    "gate_override_acknowledgements",
    # requirement_work_items uses linked_document_id (nullable); the column
    # is not on the documents PK, so the filter differs. Handled below.
)


async def hard_delete_documents(doc_ids: Iterable[str]) -> int:
    """Hard-delete the given documents and all FK-respecting children.

    Also decrements the per-(project, doc_type, discipline) reference
    counters by the number of deleted docs in each group, clamped to the
    config's ``serial_start`` so test runs are idempotent (same ref
    numbers across re-runs).

    Returns the number of document rows actually deleted. Idempotent:
    missing ids are silently ignored.
    """
    ids = [str(i) for i in doc_ids if i]
    if not ids:
        return 0

    async with _test_session_factory() as session:  # type: AsyncSession
        async with session.begin():
            # Capture (project, doc_type, discipline) -> count BEFORE we
            # delete, so we can roll the counters back. Docs without a
            # discipline never bumped a counter (counter rows are NOT NULL
            # on discipline_id), so we filter them out.
            triples_result = await session.execute(
                text(
                    "SELECT project_id, document_type, discipline_id, count(*) "
                    "FROM documents "
                    "WHERE id = ANY(:ids) AND discipline_id IS NOT NULL "
                    "GROUP BY project_id, document_type, discipline_id"
                ),
                {"ids": ids},
            )
            triples = triples_result.fetchall()  # list[(uuid, str, uuid, int)]

            for table in _FK_CHAIN_TO_DOCUMENTS:
                await session.execute(
                    text(f"DELETE FROM {table} WHERE document_id = ANY(:ids)"),
                    {"ids": ids},
                )
            # requirement_work_items holds linked_document_id (nullable) but
            # NOT a column literally named document_id, so it needs its own
            # filter.
            await session.execute(
                text(
                    "DELETE FROM requirement_work_items "
                    "WHERE linked_document_id = ANY(:ids)"
                ),
                {"ids": ids},
            )
            result = await session.execute(
                text("DELETE FROM documents WHERE id = ANY(:ids)"),
                {"ids": ids},
            )
            deleted = result.rowcount or 0

            # Best-effort: also wipe the per-doc response files
            # (responses/{doc_id}/S1.pdf, R1.pdf, ...) that the test may
            # have written. The DB column was already cleared by the
            # DELETE above, but the bytes on disk are not cascaded.
            try:
                from app.services.approval_files import purge_doc_responses
                from app.services.storage import storage

                for did in ids:
                    purge_doc_responses(did)
                    # Also clean up any per-doc attachments the API
                    # wrote but didn't link through DocumentAttachment.
                    for sub in ("attachments", "approval-rounds"):
                        root = storage._root / sub / str(did)  # noqa: SLF001
                        if root.exists():
                            import shutil

                            shutil.rmtree(root, ignore_errors=True)
            except Exception:
                pass

            # Roll back the discipline counters we captured above. Clamp to
            # the (project, doc_type) config's serial_start so we never go
            # below the configured floor.
            for project_id, doc_type, discipline_id, count in triples:
                await session.execute(
                    text(
                        "UPDATE reference_number_counters c "
                        "SET next_serial = GREATEST( "
                        "    c.next_serial - :n, "
                        "    COALESCE( "
                        "        (SELECT serial_start "
                        "           FROM reference_number_configs "
                        "          WHERE project_id = c.project_id "
                        "            AND doc_type = c.doc_type), "
                        "        1 "
                        "    ) "
                        ") "
                        "WHERE c.project_id = :project_id "
                        "  AND c.doc_type = :doc_type "
                        "  AND c.discipline_id = :discipline_id"
                    ),
                    {
                        "n": count,
                        "project_id": project_id,
                        "doc_type": doc_type,
                        "discipline_id": discipline_id,
                    },
                )

            return deleted


async def dispose_test_engine() -> None:
    """Dispose the test engine. Call from a session-scope fixture teardown
    if the engine is reloaded between test runs."""
    await _test_engine.dispose()
