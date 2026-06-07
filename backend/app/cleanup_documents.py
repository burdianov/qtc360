"""
Cleanup script: removes all documents and their impact on related tables.
Resets calculated fields and serial counters. Does NOT touch master data.
"""

import asyncio

from sqlalchemy import text

from app.core.database import async_session_factory


async def cleanup():
    async with async_session_factory() as session:
        async with session.begin():
            # 1. Delete document-dependent data (order matters for FK constraints)
            await session.execute(text("DELETE FROM gate_override_acknowledgements"))
            await session.execute(text("DELETE FROM document_requirement_links"))
            await session.execute(text("DELETE FROM requirement_work_items"))
            await session.execute(text("DELETE FROM document_attachments"))
            await session.execute(text("DELETE FROM document_approval_rounds"))
            await session.execute(text("DELETE FROM document_assets"))
            await session.execute(text("DELETE FROM notifications"))
            await session.execute(text("DELETE FROM audit_logs"))
            await session.execute(text("DELETE FROM documents"))

            # 2. Reset calculated fields on asset_requirements
            await session.execute(
                text("""
                UPDATE asset_requirements
                SET status = 'not_started', progress_percent = 0,
                    actual_completion_date = NULL, approved_date = NULL
            """)
            )

            # 3. Reset asset_tag_targets
            await session.execute(
                text("""
                UPDATE asset_tag_targets
                SET actual_achieved_date = NULL, status = 'not_started'
            """)
            )

            # 4. Reset reference number counters back to serial_start.
            # Each (project, doc_type) config has a serial_start; each
            # (project, doc_type, discipline) counter is set back to it.
            await session.execute(
                text("""
                UPDATE reference_number_counters c
                SET next_serial = COALESCE(cfg.serial_start, 1)
                FROM reference_number_configs cfg
                WHERE cfg.project_id = c.project_id
                  AND cfg.doc_type = c.doc_type
                  AND cfg.is_deleted = false
            """)
            )

        print("[OK] Cleanup complete:")
        print("  - Deleted: documents, attachments, approval rounds, document_assets,")
        print(
            "    requirement links, work items, gate overrides, notifications, audit logs"
        )
        print("  - Reset: asset_requirements status/progress, tag targets,")
        print("    reference number counters (per project/doc_type/discipline)")


if __name__ == "__main__":
    asyncio.run(cleanup())
