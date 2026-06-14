from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from app.core.database import get_db
from app.core.deps import require_project_access
from app.models.user import User, user_projects
from app.models.discipline import Discipline
from app.models.system import System
from app.models.contractor import Contractor
from app.models.service import Service
from app.models.asset import Asset
from app.models.project_approver import ProjectApprover
from app.models.commissioning import RequirementTemplate, AssetRequirement
from app.models.document import Document

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/stats")
async def get_dashboard_stats(
    project_id: UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_project_access()),
):
    async def count(model, **filters):
        stmt = select(func.count()).select_from(model).where(model.is_deleted == False)  # noqa: E712
        for k, v in filters.items():
            stmt = stmt.where(getattr(model, k) == v)
        return (await db.execute(stmt)).scalar() or 0

    disciplines = await count(Discipline, project_id=project_id)
    systems = await count(System, project_id=project_id)
    contractors = await count(Contractor, project_id=project_id)
    documents = await count(Document, project_id=project_id)
    requirement_templates = await count(RequirementTemplate, project_id=project_id)

    # Users assigned to this project
    users_count = (
        await db.execute(
            select(func.count())
            .select_from(user_projects)
            .where(user_projects.c.project_id == project_id)
        )
    ).scalar() or 0

    # Services count via disciplines
    svc_stmt = (
        select(func.count())
        .select_from(Service)
        .join(Discipline, Service.discipline_id == Discipline.id)
        .where(Service.is_deleted == False, Discipline.project_id == project_id)  # noqa: E712
    )
    services = (await db.execute(svc_stmt)).scalar() or 0

    # Approvers for this project
    approvers = await count(ProjectApprover, project_id=project_id)

    return {
        "disciplines": disciplines,
        "services": services,
        "systems": systems,
        "contractors": contractors,
        "users": users_count,
        "documents": documents,
        "requirement_templates": requirement_templates,
        "approvers": approvers,
    }


@router.get("/analytics")
async def get_dashboard_analytics(
    project_id: UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_project_access()),
):
    """Comprehensive analytics data for the commissioning dashboard."""

    # --- KPI Cards ---
    total_docs = (
        await db.execute(
            select(func.count())
            .select_from(Document)
            .where(Document.project_id == project_id, Document.is_deleted == False)  # noqa: E712
        )
    ).scalar() or 0

    approved_docs = (
        await db.execute(
            select(func.count())
            .select_from(Document)
            .where(
                Document.project_id == project_id,
                Document.is_deleted == False,  # noqa: E712
                Document.status.in_(["approved", "approved_with_comments"]),
            )
        )
    ).scalar() or 0

    pending_docs = (
        await db.execute(
            select(func.count())
            .select_from(Document)
            .where(
                Document.project_id == project_id,
                Document.is_deleted == False,  # noqa: E712
                Document.status.in_(["with_approver_1", "with_approver_2"]),
            )
        )
    ).scalar() or 0

    rejected_docs = (
        await db.execute(
            select(func.count())
            .select_from(Document)
            .where(
                Document.project_id == project_id,
                Document.is_deleted == False,  # noqa: E712
                Document.status == "rejected",
            )
        )
    ).scalar() or 0

    total_reqs = (
        await db.execute(
            select(func.count())
            .select_from(AssetRequirement)
            .join(Asset, AssetRequirement.asset_id == Asset.id)
            .where(Asset.project_id == project_id, AssetRequirement.is_deleted == False)  # noqa: E712
        )
    ).scalar() or 0

    achieved_reqs = (
        await db.execute(
            select(func.count())
            .select_from(AssetRequirement)
            .join(Asset, AssetRequirement.asset_id == Asset.id)
            .where(
                Asset.project_id == project_id,
                AssetRequirement.is_deleted == False,  # noqa: E712
                AssetRequirement.status == "achieved",
            )
        )
    ).scalar() or 0

    # --- Document submissions by month (bar chart) ---
    # Pivot directly in SQL so we don't have to O(n²) bucket in Python.
    monthly_docs = (
        await db.execute(
            text("""
        SELECT month,
               COALESCE(SUM(CASE WHEN document_type = 'WIR' THEN count END), 0) AS wir,
               COALESCE(SUM(CASE WHEN document_type = 'MIR' THEN count END), 0) AS mir,
               COALESCE(SUM(CASE WHEN document_type = 'CIR' THEN count END), 0) AS cir,
               COALESCE(SUM(CASE WHEN document_type = 'FAT' THEN count END), 0) AS fat,
               COALESCE(SUM(CASE WHEN document_type = 'CRS' THEN count END), 0) AS crs,
               COALESCE(SUM(CASE WHEN document_type = 'CHECKLIST' THEN count END), 0) AS checklist,
               SUM(count) AS total
        FROM (
            SELECT TO_CHAR(created_at, 'YYYY-MM') AS month, document_type, COUNT(*) AS count
            FROM documents
            WHERE project_id = :pid AND is_deleted = false
            GROUP BY month, document_type
        ) t
        GROUP BY month
        ORDER BY month
    """),
            {"pid": project_id},
        )
    ).fetchall()

    submission_timeline = [
        {
            "month": r[0],
            "WIR": int(r[1]),
            "MIR": int(r[2]),
            "CIR": int(r[3]),
            "FAT": int(r[4]),
            "CRS": int(r[5]),
            "CHECKLIST": int(r[6]),
            "total": int(r[7]),
        }
        for r in monthly_docs
    ]

    # --- Approvals by month (line on same chart) ---
    monthly_approvals = (
        await db.execute(
            text("""
        SELECT TO_CHAR(approved_date, 'YYYY-MM') as month, COUNT(*)
        FROM documents
        WHERE project_id = :pid AND is_deleted = false
          AND status IN ('approved', 'approved_with_comments')
          AND approved_date IS NOT NULL
        GROUP BY month ORDER BY month
    """),
            {"pid": project_id},
        )
    ).fetchall()
    approval_map = {r[0]: r[1] for r in monthly_approvals}
    for entry in submission_timeline:
        entry["approved"] = approval_map.get(entry["month"], 0)

    # --- Document status distribution (donut) ---
    status_dist = (
        await db.execute(
            text("""
        SELECT status, COUNT(*) FROM documents
        WHERE project_id = :pid AND is_deleted = false
        GROUP BY status ORDER BY COUNT(*) DESC
    """),
            {"pid": project_id},
        )
    ).fetchall()
    doc_status_distribution = [{"status": r[0], "count": r[1]} for r in status_dist]

    # --- Commissioning progress by POD ---
    pod_progress = (
        await db.execute(
            text("""
        SELECT COALESCE(a.custom_fields->>'field_1', 'Unknown') as pod,
               COUNT(*) as total,
               SUM(CASE WHEN ar.status = 'achieved' THEN 1 ELSE 0 END) as achieved
        FROM asset_requirements ar
        JOIN assets a ON ar.asset_id = a.id
        WHERE a.project_id = :pid AND ar.is_deleted = false
        GROUP BY pod ORDER BY pod
    """),
            {"pid": project_id},
        )
    ).fetchall()
    progress_by_pod = [
        {
            "pod": r[0],
            "total": r[1],
            "achieved": r[2],
            "percent": round(r[2] / r[1] * 100, 1) if r[1] > 0 else 0,
        }
        for r in pod_progress
    ]

    # --- Tag achievement summary ---
    tag_summary = (
        await db.execute(
            text("""
        SELECT tag_code, status, COUNT(*)
        FROM asset_tag_targets
        WHERE is_deleted = false
          AND asset_id IN (SELECT id FROM assets WHERE project_id = :pid)
        GROUP BY tag_code, status ORDER BY tag_code, status
    """),
            {"pid": project_id},
        )
    ).fetchall()
    tag_data = {}
    for r in tag_summary:
        tag_data.setdefault(r[0], {})[r[1]] = r[2]
    tag_achievement = [{"tag": k, **v} for k, v in tag_data.items()]

    # --- Approval turnaround times (avg days between submit and response) ---
    turnaround = (
        await db.execute(
            text("""
        SELECT d.document_type,
               ROUND(AVG(EXTRACT(EPOCH FROM (dar.returned_at - dar.submitted_at)) / 86400), 1) as avg_days,
               MAX(EXTRACT(EPOCH FROM (dar.returned_at - dar.submitted_at)) / 86400) as max_days,
               COUNT(*) as rounds
        FROM document_approval_rounds dar
        JOIN documents d ON dar.document_id = d.id
        WHERE d.project_id = :pid AND dar.returned_at IS NOT NULL
        GROUP BY d.document_type ORDER BY d.document_type
    """),
            {"pid": project_id},
        )
    ).fetchall()
    approval_turnaround = [
        {
            "doc_type": r[0],
            "avg_days": float(r[1] or 0),
            "max_days": float(r[2] or 0),
            "rounds": r[3],
        }
        for r in turnaround
    ]

    # --- Delayed items (past target date, not achieved) ---
    delayed_items = (
        await db.execute(
            text("""
        SELECT a.tag_number, a.name, tt.tag_code, tt.target_date, tt.status
        FROM asset_tag_targets tt
        JOIN assets a ON tt.asset_id = a.id
        WHERE a.project_id = :pid AND tt.is_deleted = false
          AND tt.target_date < CURRENT_DATE AND tt.status != 'achieved'
        ORDER BY tt.target_date ASC LIMIT 20
    """),
            {"pid": project_id},
        )
    ).fetchall()
    delayed = [
        {
            "tag_number": r[0],
            "asset_name": r[1],
            "tag_code": r[2],
            "target_date": r[3].isoformat(),
            "status": r[4],
        }
        for r in delayed_items
    ]

    # --- Scatter: tag target vs actual achievement (days early/late) per asset ---
    scatter_data = (
        await db.execute(
            text("""
        SELECT a.tag_number, tt.tag_code, tt.target_date, tt.actual_achieved_date, tt.status,
               CASE WHEN tt.actual_achieved_date IS NOT NULL
                    THEN (tt.actual_achieved_date - tt.target_date)
                    WHEN tt.status = 'delayed'
                    THEN (CURRENT_DATE - tt.target_date)
                    ELSE NULL END as days_variance
        FROM asset_tag_targets tt
        JOIN assets a ON tt.asset_id = a.id
        WHERE a.project_id = :pid AND tt.is_deleted = false
          AND (tt.status IN ('achieved', 'delayed', 'in_progress'))
        ORDER BY tt.tag_code, tt.target_date
    """),
            {"pid": project_id},
        )
    ).fetchall()
    approval_scatter = [
        {
            "asset": r[0],
            "tag": r[1],
            "target_date": r[2].isoformat(),
            "status": r[4],
            "days_variance": int(r[5]) if r[5] is not None else 0,
        }
        for r in scatter_data
        if r[5] is not None
    ]

    # --- Documents by discipline ---
    by_discipline = (
        await db.execute(
            text("""
        SELECT d2.id, d2.name, d2.code, COUNT(*) as count
        FROM documents d
        JOIN disciplines d2 ON d.discipline_id = d2.id
        WHERE d.project_id = :pid AND d.is_deleted = false
        GROUP BY d2.id, d2.name, d2.code ORDER BY count DESC
    """),
            {"pid": project_id},
        )
    ).fetchall()
    docs_by_discipline = [
        {"id": str(r[0]), "name": r[1], "code": r[2], "count": r[3]}
        for r in by_discipline
    ]

    return {
        "kpi": {
            "total_documents": total_docs,
            "approved_documents": approved_docs,
            "pending_approval": pending_docs,
            "rejected": rejected_docs,
            "total_requirements": total_reqs,
            "achieved_requirements": achieved_reqs,
            "completion_percent": round(achieved_reqs / total_reqs * 100, 1)
            if total_reqs > 0
            else 0,
        },
        "submission_timeline": submission_timeline,
        "doc_status_distribution": doc_status_distribution,
        "progress_by_pod": progress_by_pod,
        "tag_achievement": tag_achievement,
        "approval_turnaround": approval_turnaround,
        "delayed_items": delayed,
        "docs_by_discipline": docs_by_discipline,
        "approval_scatter": approval_scatter,
    }


@router.get("/weekly-targets")
async def get_weekly_targets(
    project_id: UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_project_access()),
):
    """Tag targets due in the next 4 weeks (+ overdue), grouped by week and tag color."""
    from datetime import date as date_cls, timedelta as td

    today = date_cls.today()

    # Align to Monday (weekday() returns 0=Mon, 6=Sun)
    this_monday = today - td(days=today.weekday())

    # Build week buckets: Overdue + 8 upcoming weeks (Mon-Sun)
    weeks = [
        {
            "label": "Overdue",
            "start": date_cls(2020, 1, 1),
            "end": this_monday - td(days=1),
        }
    ]
    for i in range(8):
        start = this_monday + td(weeks=i)
        end = start + td(days=6)
        weeks.append(
            {
                "label": f"{start.strftime('%d %b')} - {end.strftime('%d %b')}",
                "start": start,
                "end": end,
            }
        )

    result = (
        await db.execute(
            text("""
        SELECT tt.tag_code, tt.target_date, COUNT(*) as count
        FROM asset_tag_targets tt
        JOIN assets a ON tt.asset_id = a.id
        WHERE a.project_id = :pid AND tt.is_deleted = false
          AND tt.status != 'achieved'
          AND tt.target_date <= (CURRENT_DATE + INTERVAL '56 days')
        GROUP BY tt.tag_code, tt.target_date
        ORDER BY tt.target_date
    """),
            {"pid": project_id},
        )
    ).fetchall()

    chart_data = []
    for w in weeks:
        entry = {"week": w["label"], "red": 0, "yellow": 0, "green": 0, "blue": 0}
        for r in result:
            if w["start"] <= r[1] <= w["end"]:
                entry[r[0]] += r[2]
        if any(entry[t] > 0 for t in ["red", "yellow", "green", "blue"]):
            chart_data.append(entry)

    return chart_data


@router.get("/tracker-export")
async def get_tracker_export(
    project_id: UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_project_access()),
):
    """Export commissioning tracker data matching the site QA/QC Excel format.
    Returns per-asset, per-requirement: document reference, approval status, approver remarks."""
    result = (
        await db.execute(
            text("""
        SELECT
            a.tag_number,
            a.name as asset_name,
            COALESCE(a.custom_fields->>'field_1', '') as pod,
            a.location,
            rt.name as requirement_name,
            rt.code as requirement_code,
            rt.level_code,
            rt.evidence_document_type as doc_type,
            ar.status as req_status,
            d.reference_no as doc_reference,
            d.status as doc_status,
            dar1.signatory_name as approver_1_signatory,
            as1.letter as approver_1_decision,
            dar1.comments as approver_1_remarks,
            dar1.response_date as approver_1_date,
            dar1.aconex_submitted_date as approver_1_aconex_sent,
            dar1.aconex_received_date as approver_1_aconex_received,
            dar2.signatory_name as approver_2_signatory,
            as2.letter as approver_2_decision,
            dar2.comments as approver_2_remarks,
            dar2.response_date as approver_2_date,
            dar2.aconex_submitted_date as approver_2_aconex_sent,
            dar2.aconex_received_date as approver_2_aconex_received
        FROM asset_requirements ar
        JOIN assets a ON ar.asset_id = a.id
        JOIN requirement_templates rt ON ar.requirement_template_id = rt.id
        LEFT JOIN document_requirement_links drl ON drl.asset_requirement_id = ar.id
        LEFT JOIN documents d ON drl.document_id = d.id AND d.is_deleted = false
        LEFT JOIN document_approval_rounds dar1 ON dar1.document_id = d.id AND dar1.approver_order = 1 AND dar1.is_deleted = false
        LEFT JOIN approval_statuses as1 ON dar1.decision_status_id = as1.id
        LEFT JOIN document_approval_rounds dar2 ON dar2.document_id = d.id AND dar2.approver_order = 2 AND dar2.is_deleted = false
        LEFT JOIN approval_statuses as2 ON dar2.decision_status_id = as2.id
        WHERE a.project_id = :pid AND ar.is_deleted = false
        ORDER BY a.custom_fields->>'field_1', a.tag_number, rt.level_code, rt.sort_order
    """),
            {"pid": project_id},
        )
    ).fetchall()

    rows = []
    for r in result:
        rows.append(
            {
                "asset_tag": r[0],
                "asset_name": r[1],
                "pod": r[2],
                "location": r[3] or "",
                "requirement": r[4],
                "req_code": r[5],
                "level": r[6],
                "doc_type": r[7],
                "req_status": r[8],
                "doc_reference": r[9] or "",
                "doc_status": r[10] or "",
                "approver_1_signatory": r[11] or "",
                "approver_1_decision": r[12] or "",
                "approver_1_remarks": r[13] or "",
                "approver_1_date": r[14].isoformat() if r[14] else "",
                "approver_1_aconex_sent": r[15].isoformat() if r[15] else "",
                "approver_1_aconex_received": r[16].isoformat() if r[16] else "",
                "approver_2_signatory": r[17] or "",
                "approver_2_decision": r[18] or "",
                "approver_2_remarks": r[19] or "",
                "approver_2_date": r[20].isoformat() if r[20] else "",
                "approver_2_aconex_sent": r[21].isoformat() if r[21] else "",
                "approver_2_aconex_received": r[22].isoformat() if r[22] else "",
            }
        )

    return rows
