"""
Demo seed script: creates realistic documents at various approval stages.
Run: cd backend && uv run python -m app.seed_demo
"""
import uuid
import random
from datetime import date, datetime, timezone, timedelta

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory
from app.models.document import Document
from app.models.document_attachment import document_assets
from app.models.document_approval_round import DocumentApprovalRound
from app.models.commissioning import (
    AssetRequirement, AssetTagTarget, DocumentRequirementLink,
    RequirementTemplate, RequirementWorkItem,
)
from app.models.reference_number_config import ReferenceNumberConfig
from app.services.commissioning import recalculate_requirement_status, recalculate_tag_status

# --- IDs resolved dynamically at runtime ---
PROJECT_ID: uuid.UUID
DISC_EL: uuid.UUID
DISC_MC: uuid.UUID
DISC_FF: uuid.UUID
USER_SITE: uuid.UUID
USER_QAQC: uuid.UUID
USER_JERRY: uuid.UUID
USER_DEV: uuid.UUID
STATUS_A: uuid.UUID
STATUS_B: uuid.UUID
STATUS_C: uuid.UUID
PA: dict


async def _resolve_ids(db: AsyncSession):
    """Look up all required IDs from the database by code/email."""
    global PROJECT_ID, DISC_EL, DISC_MC, DISC_FF
    global USER_SITE, USER_QAQC, USER_JERRY, USER_DEV
    global STATUS_A, STATUS_B, STATUS_C, PA

    from app.models.project import Project
    from app.models.discipline import Discipline
    from app.models.user import User
    from app.models.approval_status import ApprovalStatus
    from app.models.project_approver import ProjectApprover

    # Project
    r = await db.execute(select(Project).where(Project.code == "1728"))
    PROJECT_ID = r.scalar_one().id

    # Disciplines
    for code, attr in [("EL", "DISC_EL"), ("MC", "DISC_MC"), ("FF", "DISC_FF")]:
        r = await db.execute(select(Discipline).where(Discipline.code == code, Discipline.project_id == PROJECT_ID))
        globals()[attr] = r.scalar_one().id

    # Users
    email_map = {"site@jlwme.com": "USER_SITE", "qaqc@jlwme.com": "USER_QAQC",
                 "jerry@jlwme.com": "USER_JERRY", "dev@jlwme.com": "USER_DEV"}
    for email, attr in email_map.items():
        r = await db.execute(select(User).where(User.email == email))
        globals()[attr] = r.scalar_one().id

    # Approval statuses
    for letter, attr in [("A", "STATUS_A"), ("B", "STATUS_B"), ("C", "STATUS_C")]:
        r = await db.execute(select(ApprovalStatus).where(
            ApprovalStatus.project_id == PROJECT_ID, ApprovalStatus.letter == letter))
        globals()[attr] = r.scalar_one().id

    # Project approvers
    pa_rows = (await db.execute(
        select(ProjectApprover).where(ProjectApprover.project_id == PROJECT_ID)
    )).scalars().all()
    PA = {}
    for pa in pa_rows:
        PA.setdefault(pa.document_type, {})[pa.approver_order] = pa.id

SIGNATORIES = ["Ahmed Al-Rashid", "Khalid Mansour", "Omar Farouk", "James Wilson", "David Chen", "Rashid Al-Maktoum"]

# Work breakdown item names for cable templates
WB_NAMES = {
    "PWR-CBL": ["to MDB-1A", "to MDB-1B", "to MDB-2A", "to UPS-DB"],
    "CTL-CBL": ["to BMS Panel", "to Fire Panel", "to ATS"],
    "CBL-TERM": ["HV Side", "LV Side", "Control Side"],
}


def _dt(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, 9, 0, tzinfo=timezone.utc)


def _rand_date(start: date, end: date) -> date:
    delta = (end - start).days
    return start + timedelta(days=random.randint(0, max(0, delta)))


async def _bump_serial(db: AsyncSession, doc_type: str) -> int:
    """Allocate next serial for a doc type."""
    r = await db.execute(
        select(ReferenceNumberConfig)
        .where(ReferenceNumberConfig.project_id == PROJECT_ID, ReferenceNumberConfig.doc_type == doc_type)
        .with_for_update()
    )
    config = r.scalar_one()
    serial = config.next_serial
    config.next_serial = serial + 1
    return serial


def _ref(doc_type: str, disc_code: str, serial: int) -> str:
    return f"MERC-JMJV-{disc_code}-{doc_type}-{serial:04d}"


async def create_doc(
    db: AsyncSession, *,
    doc_type: str, disc_id: uuid.UUID, disc_code: str,
    title: str, asset_ids: list[uuid.UUID],
    status: str, created: date,
    site_signed: bool = False, qaqc_signed: bool = False,
    location: str = "", creator: uuid.UUID | None = None,
) -> Document:
    serial = await _bump_serial(db, doc_type)
    if creator is None:
        creator = USER_SITE
    doc = Document(
        id=uuid.uuid4(),
        project_id=PROJECT_ID,
        document_type=doc_type,
        reference_no=_ref(doc_type, disc_code, serial),
        title=title,
        discipline_id=disc_id,
        status=status,
        revision_no=0,
        location=location,
        site_engineer_id=USER_SITE if site_signed else None,
        qaqc_engineer_id=USER_QAQC if qaqc_signed else None,
        site_engineer_signed=site_signed,
        qaqc_engineer_signed=qaqc_signed,
        submitted_date=_dt(created) if status != "draft" else None,
        created_by=creator,
        created_at=_dt(created),
    )
    if status == "approved":
        doc.approved_date = _dt(created + timedelta(days=random.randint(5, 15)))
    db.add(doc)
    await db.flush()
    for aid in asset_ids:
        await db.execute(document_assets.insert().values(document_id=doc.id, asset_id=aid))
    return doc


async def add_approval_rounds(
    db: AsyncSession, doc: Document, *,
    round1_decision: uuid.UUID | None = None,
    round1_date: date | None = None,
    round2_decision: uuid.UUID | None = None,
    round2_date: date | None = None,
    aconex_sub1: date | None = None,
    aconex_rec1: date | None = None,
    aconex_sub2: date | None = None,
    aconex_rec2: date | None = None,
):
    doc_type = doc.document_type
    # Round 1
    r1 = DocumentApprovalRound(
        id=uuid.uuid4(),
        document_id=doc.id,
        approver_order=1,
        round_no=1,
        project_approver_id=PA[doc_type][1],
        submitted_at=_dt(aconex_sub1) if aconex_sub1 else doc.submitted_date,
        aconex_submitted_date=aconex_sub1,
    )
    if round1_decision:
        r1.decision_status_id = round1_decision
        r1.signatory_name = random.choice(SIGNATORIES)
        r1.response_date = round1_date
        r1.returned_at = _dt(round1_date) if round1_date else None
        r1.aconex_received_date = aconex_rec1
    db.add(r1)

    # Round 2 (only if approver 1 returned non-C)
    if round2_decision is not None or doc.status in ("with_approver_2", "approved", "approved_with_comments"):
        r2 = DocumentApprovalRound(
            id=uuid.uuid4(),
            document_id=doc.id,
            approver_order=2,
            round_no=1,
            project_approver_id=PA[doc_type][2],
            submitted_at=_dt(aconex_sub2) if aconex_sub2 else (_dt(round1_date + timedelta(days=1)) if round1_date else None),
            aconex_submitted_date=aconex_sub2,
        )
        if round2_decision:
            r2.decision_status_id = round2_decision
            r2.signatory_name = random.choice(SIGNATORIES)
            r2.response_date = round2_date
            r2.returned_at = _dt(round2_date) if round2_date else None
            r2.aconex_received_date = aconex_rec2
        db.add(r2)


async def link_requirement(
    db: AsyncSession, doc: Document, ar_id: uuid.UUID, wi_id: uuid.UUID | None = None
):
    link = DocumentRequirementLink(
        id=uuid.uuid4(),
        document_id=doc.id,
        asset_requirement_id=ar_id,
        requirement_work_item_id=wi_id,
    )
    db.add(link)


async def create_work_items(
    db: AsyncSession, ar_id: uuid.UUID, template_code: str, asset_name: str
) -> list[uuid.UUID]:
    names = WB_NAMES.get(template_code, ["Item 1", "Item 2"])
    ids = []
    for i, name in enumerate(names[:random.randint(2, len(names))]):
        wi = RequirementWorkItem(
            id=uuid.uuid4(),
            asset_requirement_id=ar_id,
            name=f"{asset_name} {name}",
            sequence_no=i + 1,
            created_dynamically=True,
            status="not_started",
        )
        db.add(wi)
        ids.append(wi.id)
    await db.flush()
    return ids



# --- Main seed logic ---

async def seed_demo():
    async with async_session_factory() as db:
        async with db.begin():
            # Resolve all IDs dynamically
            await _resolve_ids(db)

            # Load all assets grouped by POD
            rows = (await db.execute(text("""
                SELECT a.id, a.tag_number, a.name, a.custom_fields->>'field_1' as pod,
                       d.id as disc_id, d.code as disc_code
                FROM assets a
                JOIN asset_types at ON a.asset_type_id = at.id
                JOIN services sv ON at.service_id = sv.id
                JOIN disciplines d ON sv.discipline_id = d.id
                WHERE a.is_deleted = false ORDER BY a.tag_number
            """))).fetchall()

            assets_by_pod = {"P1": [], "P2": [], "P3": []}
            for r in rows:
                pod = r[3] or "P1"
                assets_by_pod[pod].append({
                    "id": r[0], "tag": r[1], "name": r[2],
                    "disc_id": r[4], "disc_code": r[5],
                })

            # Load asset requirements with template info
            ar_rows = (await db.execute(text("""
                SELECT ar.id, ar.asset_id, rt.code, rt.level_code, rt.evidence_document_type, rt.requires_work_breakdown
                FROM asset_requirements ar
                JOIN requirement_templates rt ON ar.requirement_template_id = rt.id
                WHERE ar.is_deleted = false
            """))).fetchall()

            # Map: asset_id -> list of {ar_id, code, level, doc_type, wb}
            asset_reqs = {}
            for r in ar_rows:
                asset_reqs.setdefault(r[1], []).append({
                    "ar_id": r[0], "code": r[2], "level": r[3],
                    "doc_type": r[4], "wb": r[5],
                })

            # --- Seed tag targets for ALL assets ---
            print("  Seeding tag targets...")
            today = date(2026, 5, 30)
            tag_dates = {
                "P1": {"red": date(2026, 3, 15), "yellow": date(2026, 5, 1), "green": date(2026, 6, 30), "blue": date(2026, 8, 15)},
                "P2": {"red": date(2026, 4, 15), "yellow": date(2026, 6, 15), "green": date(2026, 8, 1), "blue": date(2026, 9, 30)},
                "P3": {"red": date(2026, 5, 30), "yellow": date(2026, 7, 15), "green": date(2026, 9, 15), "blue": date(2026, 11, 15)},
            }
            for pod, assets in assets_by_pod.items():
                for asset in assets:
                    for tag_code, target in tag_dates[pod].items():
                        db.add(AssetTagTarget(
                            id=uuid.uuid4(), asset_id=asset["id"],
                            tag_code=tag_code, target_date=target, status="not_started",
                        ))
            await db.flush()

            # --- Seed documents by POD progression ---
            print("  Seeding POD 1 documents (most advanced)...")
            await _seed_pod1(db, assets_by_pod["P1"], asset_reqs)
            print("  Seeding POD 2 documents (mid-progress)...")
            await _seed_pod2(db, assets_by_pod["P2"], asset_reqs)
            print("  Seeding POD 3 documents (early stages)...")
            await _seed_pod3(db, assets_by_pod["P3"], asset_reqs)

            # --- Seed some general QA/QC docs (not linked to commissioning) ---
            print("  Seeding general QA/QC documents...")
            await _seed_general_docs(db)

            # --- Recalculate all requirement statuses ---
            print("  Recalculating requirement statuses...")
            for r in ar_rows:
                await recalculate_requirement_status(db, r[0])

            # --- Recalculate tag statuses ---
            print("  Recalculating tag statuses...")
            all_asset_ids = set(r[1] for r in ar_rows)
            for aid in all_asset_ids:
                await recalculate_tag_status(db, aid)

        print("[OK] Demo seed complete!")



async def _seed_pod1(db: AsyncSession, assets: list, asset_reqs: dict):
    """POD 1: Most advanced. FAT + MIR + most WIR approved. Some CIR in progress."""
    for asset in assets:
        reqs = asset_reqs.get(asset["id"], [])
        disc_id, disc_code = asset["disc_id"], asset["disc_code"]

        for req in reqs:
            ar_id = req["ar_id"]

            if req["doc_type"] == "FAT":
                # All FAT approved (Jan 2026)
                d = await create_doc(db, doc_type="FAT", disc_id=disc_id, disc_code=disc_code,
                    title=f"FAT - {asset['name']}", asset_ids=[asset["id"]],
                    status="approved", created=_rand_date(date(2026, 1, 5), date(2026, 1, 25)))
                await link_requirement(db, d, ar_id)

            elif req["doc_type"] == "MIR":
                # All MIR approved (Feb 2026)
                d = await create_doc(db, doc_type="MIR", disc_id=disc_id, disc_code=disc_code,
                    title=f"Equipment Delivery - {asset['name']}", asset_ids=[asset["id"]],
                    status="approved", created=_rand_date(date(2026, 2, 1), date(2026, 2, 20)),
                    site_signed=True)
                created_d = d.created_at.date()
                await add_approval_rounds(db, d,
                    round1_decision=STATUS_A, round1_date=created_d + timedelta(days=5),
                    round2_decision=STATUS_A, round2_date=created_d + timedelta(days=10),
                    aconex_sub1=created_d + timedelta(days=1), aconex_rec1=created_d + timedelta(days=5),
                    aconex_sub2=created_d + timedelta(days=6), aconex_rec2=created_d + timedelta(days=10))
                await link_requirement(db, d, ar_id)

            elif req["doc_type"] == "WIR":
                if req["wb"]:
                    # Work breakdown WIRs: approved (Mar 2026)
                    d = await create_doc(db, doc_type="WIR", disc_id=disc_id, disc_code=disc_code,
                        title=f"{req['code']} - {asset['name']}", asset_ids=[asset["id"]],
                        status="approved", created=_rand_date(date(2026, 3, 1), date(2026, 3, 20)),
                        site_signed=True, qaqc_signed=True, location="POD 1")
                    created_d = d.created_at.date()
                    await add_approval_rounds(db, d,
                        round1_decision=STATUS_A, round1_date=created_d + timedelta(days=4),
                        round2_decision=STATUS_A, round2_date=created_d + timedelta(days=8),
                        aconex_sub1=created_d + timedelta(days=1), aconex_rec1=created_d + timedelta(days=4),
                        aconex_sub2=created_d + timedelta(days=5), aconex_rec2=created_d + timedelta(days=8))
                    wis = await create_work_items(db, ar_id, req["code"], asset["name"])
                    for wi_id in wis:
                        await link_requirement(db, d, ar_id, wi_id)
                        # Mark work items as approved
                        wi = (await db.execute(select(RequirementWorkItem).where(RequirementWorkItem.id == wi_id))).scalar_one()
                        wi.status = "approved"
                        wi.approved_date = created_d + timedelta(days=8)
                        wi.linked_document_id = d.id
                else:
                    # Non-WB WIRs: approved (Mar 2026)
                    d = await create_doc(db, doc_type="WIR", disc_id=disc_id, disc_code=disc_code,
                        title=f"{req['code']} - {asset['name']}", asset_ids=[asset["id"]],
                        status="approved", created=_rand_date(date(2026, 3, 5), date(2026, 3, 25)),
                        site_signed=True, qaqc_signed=True, location="POD 1")
                    created_d = d.created_at.date()
                    await add_approval_rounds(db, d,
                        round1_decision=STATUS_A, round1_date=created_d + timedelta(days=5),
                        round2_decision=STATUS_A, round2_date=created_d + timedelta(days=9),
                        aconex_sub1=created_d + timedelta(days=1), aconex_rec1=created_d + timedelta(days=5),
                        aconex_sub2=created_d + timedelta(days=6), aconex_rec2=created_d + timedelta(days=9))
                    await link_requirement(db, d, ar_id)

            elif req["doc_type"] == "CIR":
                if req["level"] == "L2B":
                    # L2B CIRs: mostly approved, some with_approver_2
                    if random.random() < 0.7:
                        d = await create_doc(db, doc_type="CIR", disc_id=disc_id, disc_code=disc_code,
                            title=f"{req['code']} - {asset['name']}", asset_ids=[asset["id"]],
                            status="approved", created=_rand_date(date(2026, 4, 1), date(2026, 4, 20)),
                            site_signed=True, qaqc_signed=True, location="POD 1")
                        created_d = d.created_at.date()
                        await add_approval_rounds(db, d,
                            round1_decision=STATUS_A, round1_date=created_d + timedelta(days=5),
                            round2_decision=STATUS_A, round2_date=created_d + timedelta(days=10),
                            aconex_sub1=created_d + timedelta(days=1), aconex_rec1=created_d + timedelta(days=5),
                            aconex_sub2=created_d + timedelta(days=6), aconex_rec2=created_d + timedelta(days=10))
                        await link_requirement(db, d, ar_id)
                    else:
                        d = await create_doc(db, doc_type="CIR", disc_id=disc_id, disc_code=disc_code,
                            title=f"{req['code']} - {asset['name']}", asset_ids=[asset["id"]],
                            status="with_approver_2", created=_rand_date(date(2026, 5, 1), date(2026, 5, 15)),
                            site_signed=True, qaqc_signed=True, location="POD 1")
                        created_d = d.created_at.date()
                        await add_approval_rounds(db, d,
                            round1_decision=STATUS_A, round1_date=created_d + timedelta(days=4),
                            aconex_sub1=created_d + timedelta(days=1), aconex_rec1=created_d + timedelta(days=4),
                            aconex_sub2=created_d + timedelta(days=5))
                        await link_requirement(db, d, ar_id)
                elif req["level"] == "L3":
                    # L3: some submitted, some with approver
                    if random.random() < 0.4:
                        d = await create_doc(db, doc_type="CIR", disc_id=disc_id, disc_code=disc_code,
                            title=f"{req['code']} - {asset['name']}", asset_ids=[asset["id"]],
                            status="with_approver_1", created=_rand_date(date(2026, 5, 10), date(2026, 5, 25)),
                            site_signed=True, qaqc_signed=True, location="POD 1")
                        created_d = d.created_at.date()
                        await add_approval_rounds(db, d, aconex_sub1=created_d + timedelta(days=1))
                        await link_requirement(db, d, ar_id)
                    else:
                        d = await create_doc(db, doc_type="CIR", disc_id=disc_id, disc_code=disc_code,
                            title=f"{req['code']} - {asset['name']}", asset_ids=[asset["id"]],
                            status="internally_signed", created=_rand_date(date(2026, 5, 20), date(2026, 5, 28)),
                            site_signed=True, qaqc_signed=True, location="POD 1")
                        await link_requirement(db, d, ar_id)
                else:
                    # L4: still in draft
                    d = await create_doc(db, doc_type="CIR", disc_id=disc_id, disc_code=disc_code,
                        title=f"{req['code']} - {asset['name']}", asset_ids=[asset["id"]],
                        status="draft", created=_rand_date(date(2026, 5, 25), date(2026, 5, 29)),
                        location="POD 1")
                    await link_requirement(db, d, ar_id)
    await db.flush()



async def _seed_pod2(db: AsyncSession, assets: list, asset_reqs: dict):
    """POD 2: Mid-progress. FAT done, MIR approved, WIR mixed, CIR early."""
    for asset in assets:
        reqs = asset_reqs.get(asset["id"], [])
        disc_id, disc_code = asset["disc_id"], asset["disc_code"]

        for req in reqs:
            ar_id = req["ar_id"]

            if req["doc_type"] == "FAT":
                d = await create_doc(db, doc_type="FAT", disc_id=disc_id, disc_code=disc_code,
                    title=f"FAT - {asset['name']}", asset_ids=[asset["id"]],
                    status="approved", created=_rand_date(date(2026, 2, 1), date(2026, 2, 15)))
                await link_requirement(db, d, ar_id)

            elif req["doc_type"] == "MIR":
                d = await create_doc(db, doc_type="MIR", disc_id=disc_id, disc_code=disc_code,
                    title=f"Equipment Delivery - {asset['name']}", asset_ids=[asset["id"]],
                    status="approved", created=_rand_date(date(2026, 3, 1), date(2026, 3, 15)),
                    site_signed=True)
                created_d = d.created_at.date()
                await add_approval_rounds(db, d,
                    round1_decision=STATUS_A, round1_date=created_d + timedelta(days=6),
                    round2_decision=STATUS_A, round2_date=created_d + timedelta(days=12),
                    aconex_sub1=created_d + timedelta(days=1), aconex_rec1=created_d + timedelta(days=6),
                    aconex_sub2=created_d + timedelta(days=7), aconex_rec2=created_d + timedelta(days=12))
                await link_requirement(db, d, ar_id)

            elif req["doc_type"] == "WIR":
                if req["wb"]:
                    # Work breakdown: some approved, some partial (approver_1_returned)
                    roll = random.random()
                    if roll < 0.5:
                        # Approved
                        d = await create_doc(db, doc_type="WIR", disc_id=disc_id, disc_code=disc_code,
                            title=f"{req['code']} - {asset['name']}", asset_ids=[asset["id"]],
                            status="approved", created=_rand_date(date(2026, 4, 1), date(2026, 4, 15)),
                            site_signed=True, qaqc_signed=True, location="POD 2")
                        created_d = d.created_at.date()
                        await add_approval_rounds(db, d,
                            round1_decision=STATUS_B, round1_date=created_d + timedelta(days=5),
                            round2_decision=STATUS_A, round2_date=created_d + timedelta(days=11),
                            aconex_sub1=created_d + timedelta(days=1), aconex_rec1=created_d + timedelta(days=5),
                            aconex_sub2=created_d + timedelta(days=6), aconex_rec2=created_d + timedelta(days=11))
                        wis = await create_work_items(db, ar_id, req["code"], asset["name"])
                        for wi_id in wis:
                            await link_requirement(db, d, ar_id, wi_id)
                            wi = (await db.execute(select(RequirementWorkItem).where(RequirementWorkItem.id == wi_id))).scalar_one()
                            wi.status = "approved"
                            wi.approved_date = created_d + timedelta(days=11)
                            wi.linked_document_id = d.id
                    else:
                        # With approver 1 or approver_1_returned
                        status = random.choice(["with_approver_1", "approver_1_returned"])
                        d = await create_doc(db, doc_type="WIR", disc_id=disc_id, disc_code=disc_code,
                            title=f"{req['code']} - {asset['name']}", asset_ids=[asset["id"]],
                            status=status, created=_rand_date(date(2026, 5, 1), date(2026, 5, 20)),
                            site_signed=True, qaqc_signed=True, location="POD 2")
                        created_d = d.created_at.date()
                        if status == "approver_1_returned":
                            await add_approval_rounds(db, d,
                                round1_decision=STATUS_A, round1_date=created_d + timedelta(days=5),
                                aconex_sub1=created_d + timedelta(days=1), aconex_rec1=created_d + timedelta(days=5))
                        else:
                            await add_approval_rounds(db, d, aconex_sub1=created_d + timedelta(days=1))
                        wis = await create_work_items(db, ar_id, req["code"], asset["name"])
                        for wi_id in wis:
                            await link_requirement(db, d, ar_id, wi_id)
                else:
                    # Non-WB WIR: approved or with_approver_2
                    if random.random() < 0.6:
                        d = await create_doc(db, doc_type="WIR", disc_id=disc_id, disc_code=disc_code,
                            title=f"{req['code']} - {asset['name']}", asset_ids=[asset["id"]],
                            status="approved", created=_rand_date(date(2026, 4, 5), date(2026, 4, 25)),
                            site_signed=True, qaqc_signed=True, location="POD 2")
                        created_d = d.created_at.date()
                        await add_approval_rounds(db, d,
                            round1_decision=STATUS_A, round1_date=created_d + timedelta(days=4),
                            round2_decision=STATUS_A, round2_date=created_d + timedelta(days=9),
                            aconex_sub1=created_d + timedelta(days=1), aconex_rec1=created_d + timedelta(days=4),
                            aconex_sub2=created_d + timedelta(days=5), aconex_rec2=created_d + timedelta(days=9))
                        await link_requirement(db, d, ar_id)
                    else:
                        d = await create_doc(db, doc_type="WIR", disc_id=disc_id, disc_code=disc_code,
                            title=f"{req['code']} - {asset['name']}", asset_ids=[asset["id"]],
                            status="with_approver_2", created=_rand_date(date(2026, 5, 5), date(2026, 5, 20)),
                            site_signed=True, qaqc_signed=True, location="POD 2")
                        created_d = d.created_at.date()
                        await add_approval_rounds(db, d,
                            round1_decision=STATUS_A, round1_date=created_d + timedelta(days=4),
                            aconex_sub1=created_d + timedelta(days=1), aconex_rec1=created_d + timedelta(days=4),
                            aconex_sub2=created_d + timedelta(days=5))
                        await link_requirement(db, d, ar_id)

            elif req["doc_type"] == "CIR":
                if req["level"] == "L2B":
                    # Some internally_signed, some draft
                    if random.random() < 0.4:
                        d = await create_doc(db, doc_type="CIR", disc_id=disc_id, disc_code=disc_code,
                            title=f"{req['code']} - {asset['name']}", asset_ids=[asset["id"]],
                            status="internally_signed", created=_rand_date(date(2026, 5, 15), date(2026, 5, 28)),
                            site_signed=True, qaqc_signed=True, location="POD 2")
                        await link_requirement(db, d, ar_id)
                    else:
                        d = await create_doc(db, doc_type="CIR", disc_id=disc_id, disc_code=disc_code,
                            title=f"{req['code']} - {asset['name']}", asset_ids=[asset["id"]],
                            status="draft", created=_rand_date(date(2026, 5, 20), date(2026, 5, 29)),
                            location="POD 2")
                        await link_requirement(db, d, ar_id)
                # L3/L4: no docs yet for POD 2
    await db.flush()



async def _seed_pod3(db: AsyncSession, assets: list, asset_reqs: dict):
    """POD 3: Early stages. FAT done, MIR mixed, WIR early, no CIR yet."""
    rejected_done = False
    for asset in assets:
        reqs = asset_reqs.get(asset["id"], [])
        disc_id, disc_code = asset["disc_id"], asset["disc_code"]

        for req in reqs:
            ar_id = req["ar_id"]

            if req["doc_type"] == "FAT":
                # FAT approved (Feb-Mar)
                d = await create_doc(db, doc_type="FAT", disc_id=disc_id, disc_code=disc_code,
                    title=f"FAT - {asset['name']}", asset_ids=[asset["id"]],
                    status="approved", created=_rand_date(date(2026, 2, 15), date(2026, 3, 10)))
                await link_requirement(db, d, ar_id)

            elif req["doc_type"] == "MIR":
                # MIR: some approved, some with_approver_1, one rejected
                roll = random.random()
                if not rejected_done and roll < 0.15:
                    # One rejected MIR
                    d = await create_doc(db, doc_type="MIR", disc_id=disc_id, disc_code=disc_code,
                        title=f"Equipment Delivery - {asset['name']}", asset_ids=[asset["id"]],
                        status="rejected", created=_rand_date(date(2026, 4, 1), date(2026, 4, 10)),
                        site_signed=True)
                    created_d = d.created_at.date()
                    await add_approval_rounds(db, d,
                        round1_decision=STATUS_C, round1_date=created_d + timedelta(days=7),
                        aconex_sub1=created_d + timedelta(days=1), aconex_rec1=created_d + timedelta(days=7))
                    d.approved_date = _dt(created_d + timedelta(days=7))
                    await link_requirement(db, d, ar_id)
                    rejected_done = True
                elif roll < 0.5:
                    # Approved
                    d = await create_doc(db, doc_type="MIR", disc_id=disc_id, disc_code=disc_code,
                        title=f"Equipment Delivery - {asset['name']}", asset_ids=[asset["id"]],
                        status="approved", created=_rand_date(date(2026, 3, 15), date(2026, 4, 10)),
                        site_signed=True)
                    created_d = d.created_at.date()
                    await add_approval_rounds(db, d,
                        round1_decision=STATUS_A, round1_date=created_d + timedelta(days=5),
                        round2_decision=STATUS_A, round2_date=created_d + timedelta(days=11),
                        aconex_sub1=created_d + timedelta(days=1), aconex_rec1=created_d + timedelta(days=5),
                        aconex_sub2=created_d + timedelta(days=6), aconex_rec2=created_d + timedelta(days=11))
                    await link_requirement(db, d, ar_id)
                else:
                    # With approver 1
                    d = await create_doc(db, doc_type="MIR", disc_id=disc_id, disc_code=disc_code,
                        title=f"Equipment Delivery - {asset['name']}", asset_ids=[asset["id"]],
                        status="with_approver_1", created=_rand_date(date(2026, 5, 10), date(2026, 5, 25)),
                        site_signed=True)
                    created_d = d.created_at.date()
                    await add_approval_rounds(db, d, aconex_sub1=created_d + timedelta(days=1))
                    await link_requirement(db, d, ar_id)

            elif req["doc_type"] == "WIR":
                if req["level"] == "L2A":
                    # Placement WIRs: some approved, some internally_signed
                    if random.random() < 0.4:
                        d = await create_doc(db, doc_type="WIR", disc_id=disc_id, disc_code=disc_code,
                            title=f"{req['code']} - {asset['name']}", asset_ids=[asset["id"]],
                            status="approved", created=_rand_date(date(2026, 4, 10), date(2026, 4, 30)),
                            site_signed=True, qaqc_signed=True, location="POD 3")
                        created_d = d.created_at.date()
                        await add_approval_rounds(db, d,
                            round1_decision=STATUS_A, round1_date=created_d + timedelta(days=5),
                            round2_decision=STATUS_A, round2_date=created_d + timedelta(days=10),
                            aconex_sub1=created_d + timedelta(days=1), aconex_rec1=created_d + timedelta(days=5),
                            aconex_sub2=created_d + timedelta(days=6), aconex_rec2=created_d + timedelta(days=10))
                        await link_requirement(db, d, ar_id)
                    else:
                        d = await create_doc(db, doc_type="WIR", disc_id=disc_id, disc_code=disc_code,
                            title=f"{req['code']} - {asset['name']}", asset_ids=[asset["id"]],
                            status="internally_signed", created=_rand_date(date(2026, 5, 15), date(2026, 5, 28)),
                            site_signed=True, qaqc_signed=True, location="POD 3")
                        await link_requirement(db, d, ar_id)
                else:
                    # L2B WIRs: mostly draft or not started
                    if random.random() < 0.3:
                        d = await create_doc(db, doc_type="WIR", disc_id=disc_id, disc_code=disc_code,
                            title=f"{req['code']} - {asset['name']}", asset_ids=[asset["id"]],
                            status="draft", created=_rand_date(date(2026, 5, 20), date(2026, 5, 29)),
                            location="POD 3")
                        if req["wb"]:
                            wis = await create_work_items(db, ar_id, req["code"], asset["name"])
                            for wi_id in wis:
                                await link_requirement(db, d, ar_id, wi_id)
                        else:
                            await link_requirement(db, d, ar_id)
            # CIR: no docs for POD 3 yet
    await db.flush()


async def _seed_general_docs(db: AsyncSession):
    """Seed some general QA/QC documents NOT linked to commissioning."""
    general_titles = [
        ("WIR", "Final Cleaning Inspection - DC Hall Level 1"),
        ("WIR", "Painting Inspection - Electrical Room"),
        ("WIR", "Blockwork Inspection - Plant Room Wall"),
        ("WIR", "Waterproofing Inspection - Roof Level"),
        ("MIR", "General Consumables - Cable Ties & Labels"),
        ("MIR", "Fire Stopping Materials Delivery"),
        ("WIR", "Floor Tile Installation - Control Room"),
        ("CIR", "Smoke Detection Test - DC Hall"),
    ]
    for doc_type, title in general_titles:
        disc_id = DISC_EL if "Electrical" in title or "Cable" in title else DISC_MC
        disc_code = "EL" if disc_id == DISC_EL else "MC"
        if "Fire" in title:
            disc_id, disc_code = DISC_FF, "FF"
        status = random.choice(["draft", "internally_signed", "approved"])
        signed = status != "draft"
        d = await create_doc(db, doc_type=doc_type, disc_id=disc_id, disc_code=disc_code,
            title=title, asset_ids=[],
            status=status, created=_rand_date(date(2026, 4, 1), date(2026, 5, 25)),
            site_signed=signed, qaqc_signed=signed if doc_type != "MIR" else False,
            location="Various")
        if status == "approved" and doc_type != "FAT":
            created_d = d.created_at.date()
            await add_approval_rounds(db, d,
                round1_decision=STATUS_A, round1_date=created_d + timedelta(days=5),
                round2_decision=STATUS_A, round2_date=created_d + timedelta(days=10),
                aconex_sub1=created_d + timedelta(days=1), aconex_rec1=created_d + timedelta(days=5),
                aconex_sub2=created_d + timedelta(days=6), aconex_rec2=created_d + timedelta(days=10))
    await db.flush()



# --- Entry point ---
import asyncio

if __name__ == "__main__":
    random.seed(42)  # Reproducible
    print("Seeding demo data...")
    asyncio.run(seed_demo())
