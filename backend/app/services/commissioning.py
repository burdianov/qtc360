"""Commissioning engine service — calculates requirement statuses and tag achievements."""
import uuid
from datetime import date

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.commissioning import (
    AssetRequirement,
    AssetTagTarget,
    DocumentRequirementLink,
    RequirementWorkItem,
)
from app.models.document import Document

# Tag rules: which levels contribute to which tag
TAG_LEVEL_MAP = {
    "red": ["L1", "L2A"],
    "yellow": ["L2B"],
    "green": ["L3"],
    "blue": ["L4"],
}


async def recalculate_requirement_status(
    db: AsyncSession, asset_requirement_id: uuid.UUID
) -> str:
    """Recalculate a single AssetRequirement's status based on linked documents and work items."""
    result = await db.execute(
        select(AssetRequirement)
        .where(AssetRequirement.id == asset_requirement_id)
        .options(selectinload(AssetRequirement.work_items), selectinload(AssetRequirement.document_links))
    )
    req = result.scalar_one_or_none()
    if not req:
        return "not_started"

    # Check if requirement uses work breakdown
    work_items = [wi for wi in req.work_items if not wi.is_deleted]

    if work_items:
        # Work breakdown mode: status derived from work item completion
        approved_count = sum(1 for wi in work_items if wi.status == "approved")
        total = len(work_items)

        if approved_count == 0:
            # Check if any are submitted
            submitted = any(wi.status == "submitted" for wi in work_items)
            new_status = "submitted" if submitted else "not_started"
            progress = 0.0
        elif approved_count == total:
            new_status = "achieved"
            progress = 100.0
        else:
            new_status = "partial"
            progress = round((approved_count / total) * 100, 1)
    else:
        # No work breakdown: status derived from linked document approvals
        links = [lnk for lnk in req.document_links if not lnk.is_deleted]
        if not links:
            new_status = "not_started"
            progress = 0.0
        else:
            # Check document statuses
            doc_ids = [lnk.document_id for lnk in links]
            doc_result = await db.execute(
                select(Document.status).where(Document.id.in_(doc_ids))
            )
            doc_statuses = [row[0] for row in doc_result.all()]

            if any(s in ("approved", "approved_with_comments") for s in doc_statuses):
                new_status = "achieved"
                progress = 100.0
            elif any(s == "rejected" for s in doc_statuses):
                new_status = "rejected"
                progress = 0.0
            elif any(
                s in ("with_approver_1", "approver_1_returned", "with_approver_2", "internally_signed")
                for s in doc_statuses
            ):
                new_status = "submitted"
                progress = 0.0
            else:
                new_status = "not_started"
                progress = 0.0

    # Update cached fields
    req.status = new_status
    req.progress_percent = progress
    if new_status == "achieved" and not req.actual_completion_date:
        # Set completion date from the linked document's inspector dates
        from app.models.commissioning import DocumentRequirementLink
        link_result = await db.execute(
            select(DocumentRequirementLink.document_id)
            .where(DocumentRequirementLink.asset_requirement_id == requirement_id)
        )
        doc_ids = [r[0] for r in link_result.all()]
        if doc_ids:
            doc_result = await db.execute(select(Document).where(Document.id.in_(doc_ids)))
            docs = doc_result.scalars().all()
            inspector_dates = []
            for d in docs:
                for dt_str in [d.inspector_date_1, d.inspector_date_2]:
                    if dt_str:
                        try:
                            inspector_dates.append(date.fromisoformat(dt_str))
                        except ValueError:
                            pass
            if inspector_dates:
                req.actual_completion_date = max(inspector_dates)
            else:
                req.actual_completion_date = date.today()
            # Set approved_date from the document's approved_date
            approved_dates = [d.approved_date.date() if d.approved_date else None for d in docs]
            approved_dates = [d for d in approved_dates if d]
            if approved_dates:
                req.approved_date = max(approved_dates)
        else:
            req.actual_completion_date = date.today()
    elif new_status != "achieved":
        req.actual_completion_date = None
        req.approved_date = None

    await db.flush()
    return new_status


async def recalculate_requirements_for_document(
    db: AsyncSession, document_id: uuid.UUID
) -> None:
    """When a document status changes, update linked work items and recalculate requirements."""
    # Get the document status
    doc_result = await db.execute(select(Document).where(Document.id == document_id))
    doc = doc_result.scalar_one_or_none()
    if not doc:
        return

    # Get all links for this document
    links_result = await db.execute(
        select(DocumentRequirementLink).where(DocumentRequirementLink.document_id == document_id)
    )
    links = links_result.scalars().all()
    wi_ids = [lnk.requirement_work_item_id for lnk in links if lnk.requirement_work_item_id]

    if wi_ids:
        wi_result = await db.execute(
            select(RequirementWorkItem).where(RequirementWorkItem.id.in_(wi_ids))
        )
        work_items = wi_result.scalars().all()

        if doc.status in ("approved", "approved_with_comments"):
            for wi in work_items:
                # Don't overwrite an existing approved linkage from another doc — preserve audit history.
                if wi.status == "approved" and wi.linked_document_id and wi.linked_document_id != document_id:
                    continue
                if wi.status != "approved":
                    wi.status = "approved"
                    wi.approved_date = date.today()
                    wi.linked_document_id = document_id
        elif doc.status in ("rejected", "superseded"):
            for wi in work_items:
                if wi.linked_document_id == document_id:
                    wi.status = "not_started"
                    wi.approved_date = None
                    wi.linked_document_id = None

        await db.flush()

    # Recalculate all linked requirements
    result = await db.execute(
        select(DocumentRequirementLink.asset_requirement_id)
        .where(DocumentRequirementLink.document_id == document_id)
        .distinct()
    )
    req_ids = [row[0] for row in result.all()]

    for req_id in req_ids:
        await recalculate_requirement_status(db, req_id)

    # After recalculating requirements, check tag achievements
    asset_result = await db.execute(
        select(AssetRequirement.asset_id)
        .where(AssetRequirement.id.in_(req_ids))
        .distinct()
    )
    asset_ids = [row[0] for row in asset_result.all()]

    for asset_id in asset_ids:
        await recalculate_tag_status(db, asset_id)


async def recalculate_tag_status(
    db: AsyncSession, asset_id: uuid.UUID
) -> None:
    """Recalculate tag achievement for an asset based on requirement completion."""
    # Get all non-deleted requirements for this asset
    result = await db.execute(
        select(AssetRequirement)
        .where(AssetRequirement.asset_id == asset_id, AssetRequirement.is_deleted == False)  # noqa: E712
    )
    requirements = result.scalars().all()

    # Get requirement templates to know level_code
    from app.models.commissioning import RequirementTemplate
    template_ids = [r.requirement_template_id for r in requirements]
    if not template_ids:
        return

    tmpl_result = await db.execute(
        select(RequirementTemplate).where(RequirementTemplate.id.in_(template_ids))
    )
    templates = {t.id: t for t in tmpl_result.scalars().all()}

    # Group requirements by level
    level_requirements: dict[str, list[AssetRequirement]] = {}
    for req in requirements:
        tmpl = templates.get(req.requirement_template_id)
        if tmpl and not tmpl.is_optional:
            level_requirements.setdefault(tmpl.level_code, []).append(req)

    # Check each tag
    for tag_code, levels in TAG_LEVEL_MAP.items():
        all_achieved = True
        has_any = False

        for level in levels:
            reqs = level_requirements.get(level, [])
            if reqs:
                has_any = True
                if not all(r.status == "achieved" for r in reqs):
                    all_achieved = False
                    break

        if not has_any:
            continue

        # Update asset_tag_targets
        tag_result = await db.execute(
            select(AssetTagTarget).where(
                AssetTagTarget.asset_id == asset_id,
                AssetTagTarget.tag_code == tag_code,
                AssetTagTarget.is_deleted == False,  # noqa: E712
            )
        )
        tag_target = tag_result.scalar_one_or_none()

        if tag_target:
            if all_achieved:
                tag_target.status = "achieved"
                if not tag_target.actual_achieved_date:
                    tag_target.actual_achieved_date = date.today()
            else:
                # Determine if in_progress, delayed, or at_risk
                any_progress = any(
                    r.status in ("partial", "submitted", "achieved")
                    for level in levels
                    for r in level_requirements.get(level, [])
                )
                if any_progress:
                    if tag_target.target_date and tag_target.target_date < date.today():
                        tag_target.status = "delayed"
                    else:
                        tag_target.status = "in_progress"
                else:
                    tag_target.status = "not_started"
                tag_target.actual_achieved_date = None

    await db.flush()
