"""Seed roles, users, and master data."""

import asyncio

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import async_session_factory
from app.core.security import hash_password
from app.models.user import User, user_projects
from app.models.rbac import Role, Permission
from app.models.client import Client
from app.models.project import Project
from app.models.approver import ApproverTitle, Approver
from app.models.project_approver import ProjectApprover
from app.models.discipline import Discipline
from app.models.approval_status import ApprovalStatus

ROLES = [
    {
        "name": "super_admin",
        "description": "Developer / top-level administrator with full system access",
    },
    {
        "name": "admin",
        "description": "Project administrator — manages users, settings, and master data",
    },
    {
        "name": "site_engineer",
        "description": "Site engineer — submits and tracks field inspections",
    },
    {
        "name": "qaqc_engineer",
        "description": "QA/QC engineer — reviews, approves, and manages quality documents",
    },
    {
        "name": "qaqc_manager",
        "description": "QA/QC manager — same rights as qaqc_engineer (to be differentiated later)",
    },
    {
        "name": "viewer",
        "description": "View-only access — cannot create documents or sign",
    },
]

PERMISSIONS = [
    # Documents
    {
        "code": "documents.create",
        "description": "Create new documents (WIR, MIR, CIR, FAT)",
    },
    {"code": "documents.edit", "description": "Edit existing documents"},
    {"code": "documents.delete", "description": "Delete documents"},
    {"code": "documents.sign", "description": "Sign documents as inspector"},
    {"code": "documents.submit", "description": "Submit documents for approval"},
    # Commissioning
    {
        "code": "commissioning.manage",
        "description": "Manage requirement templates and assignments",
    },
    {
        "code": "commissioning.view",
        "description": "View commissioning progress and tracking",
    },
    # Master Data
    {
        "code": "master_data.manage",
        "description": "Create/edit/delete master data (assets, disciplines, etc.)",
    },
    # Reports
    {"code": "reports.generate", "description": "Generate PDF reports"},
    {"code": "reports.templates", "description": "Upload and manage report templates"},
    # Admin
    {"code": "admin.users", "description": "Manage users"},
    {"code": "admin.roles", "description": "Manage roles and permissions"},
    {"code": "admin.settings", "description": "Manage system settings"},
]

# Default permissions per role
ROLE_PERMISSIONS = {
    "super_admin": [p["code"] for p in PERMISSIONS],  # all
    "admin": [p["code"] for p in PERMISSIONS],  # all
    "site_engineer": [
        "documents.create",
        "documents.edit",
        "documents.sign",
        "documents.submit",
        "commissioning.view",
        "reports.generate",
    ],
    "qaqc_engineer": [
        "documents.create",
        "documents.edit",
        "documents.sign",
        "documents.submit",
        "commissioning.view",
        "commissioning.manage",
        "reports.generate",
    ],
    "qaqc_manager": [
        "documents.create",
        "documents.edit",
        "documents.delete",
        "documents.sign",
        "documents.submit",
        "commissioning.view",
        "commissioning.manage",
        "reports.generate",
    ],
    "viewer": ["commissioning.view"],
}

USERS = [
    {
        "email": "dev@jlwme.com",
        "password": "Dev12345",
        "full_name": "Dev Super Admin",
        "role": "super_admin",
        "is_superuser": True,
    },
    {
        "email": "admin@jlwme.com",
        "password": "Admin123",
        "full_name": "Project Admin",
        "role": "admin",
        "is_superuser": False,
    },
    {
        "email": "site@jlwme.com",
        "password": "Site1234",
        "full_name": "John Site Engineer",
        "role": "site_engineer",
        "is_superuser": False,
    },
    {
        "email": "qaqc@jlwme.com",
        "password": "Qaqc1234",
        "full_name": "Sarah QA/QC Engineer",
        "role": "qaqc_engineer",
        "is_superuser": False,
    },
    {
        "email": "jerry@jlwme.com",
        "password": "Jerry123",
        "full_name": "Jerry QA/QC Manager",
        "role": "qaqc_manager",
        "is_superuser": False,
    },
]

CLIENTS = [
    {"name": "Aldar Properties", "code": "ALDAR"},
    {"name": "Meraas Holding", "code": "MERAAS"},
]

APPROVER_TITLES = [
    {"code": "cxm", "title": "Commissioning Management"},
    {"code": "cxa", "title": "Commissioning Authority"},
    {"code": "dc", "title": "Design Consultant"},
    {"code": "ta", "title": "Technical Advisor"},
]

APPROVERS = [
    {"name": "AESG", "code": "AESG", "title_code": "cxm"},
    {"name": "Core Emirates", "code": "CORE", "title_code": "cxa"},
    {"name": "RED Engineering", "code": "RED", "title_code": "dc"},
    {"name": "Sudlows", "code": "SDLS", "title_code": "ta"},
]

PROJECTS = [
    {"name": "AUH-08", "code": "1733", "client_code": "ALDAR"},
    {
        "name": "DU Mercury",
        "code": "1728",
        "client_code": "MERAAS",
        "external_code": "M1610",
    },
]

# Project 1728 default approver chains, per the spec:
#   WIR/MIR → AESG (1) → Core Emirates (2)
#   CIR     → RED Engineering (1) → Sudlows (2)
PROJECT_APPROVERS_1728 = [
    {
        "approver_code": "AESG",
        "title_code": "cxm",
        "document_type": "WIR",
        "approver_order": 1,
    },
    {
        "approver_code": "CORE",
        "title_code": "cxa",
        "document_type": "WIR",
        "approver_order": 2,
    },
    {
        "approver_code": "AESG",
        "title_code": "cxm",
        "document_type": "MIR",
        "approver_order": 1,
    },
    {
        "approver_code": "CORE",
        "title_code": "cxa",
        "document_type": "MIR",
        "approver_order": 2,
    },
    {
        "approver_code": "RED",
        "title_code": "dc",
        "document_type": "CIR",
        "approver_order": 1,
    },
    {
        "approver_code": "SDLS",
        "title_code": "ta",
        "document_type": "CIR",
        "approver_order": 2,
    },
]

DISCIPLINES_1728 = [
    {"name": "Architectural", "code": "AR"},
    {"name": "Civil / Structural", "code": "CS"},
    {"name": "Mechanical", "code": "MC"},
    {"name": "Electrical", "code": "EL"},
    {"name": "Plumbing", "code": "PL"},
    {"name": "Fire Fighting", "code": "FF"},
    {"name": "Others (Specify)", "code": "OT"},
]


async def get_or_create(session, model, filter_field, filter_value, **kwargs):
    result = await session.execute(
        select(model).where(getattr(model, filter_field) == filter_value)
    )
    item = result.scalar_one_or_none()
    if item:
        if hasattr(item, "is_deleted") and item.is_deleted:
            item.is_deleted = False
            return item, True
        return item, False
    item = model(**{filter_field: filter_value, **kwargs})
    session.add(item)
    await session.flush()
    return item, True


async def seed():
    async with async_session_factory() as session:
        # Roles
        for r in ROLES:
            await get_or_create(
                session, Role, "name", r["name"], description=r["description"]
            )

        # Permissions
        for p in PERMISSIONS:
            await get_or_create(
                session, Permission, "code", p["code"], description=p["description"]
            )

        await session.commit()
        role_result = await session.execute(
            select(Role).options(selectinload(Role.permissions))
        )
        role_map = {r.name: r for r in role_result.scalars().all()}

        # Assign default permissions to roles
        perm_result = await session.execute(select(Permission))
        perm_map = {p.code: p for p in perm_result.scalars().all()}
        for role_name, perm_codes in ROLE_PERMISSIONS.items():
            role = role_map.get(role_name)
            if role and not role.permissions:
                role.permissions = [
                    perm_map[code] for code in perm_codes if code in perm_map
                ]

        await session.commit()

        # Users
        for u in USERS:
            result = await session.execute(select(User).where(User.email == u["email"]))
            user = result.scalar_one_or_none()
            if not user:
                user = User(
                    email=u["email"],
                    hashed_password=hash_password(u["password"]),
                    full_name=u["full_name"],
                    is_superuser=u["is_superuser"],
                )
                user.roles.append(role_map[u["role"]])
                session.add(user)
                print(f"  Created user: {u['email']} / {u['password']}")
        await session.commit()

        # Clients
        for c in CLIENTS:
            await get_or_create(session, Client, "code", c["code"], name=c["name"])
        await session.commit()

        # Approver Titles
        for t in APPROVER_TITLES:
            await get_or_create(
                session, ApproverTitle, "code", t["code"], title=t["title"]
            )
        await session.commit()

        # Approvers
        title_result = await session.execute(select(ApproverTitle))
        title_map = {t.code: t for t in title_result.scalars().all()}

        for a in APPROVERS:
            await get_or_create(
                session,
                Approver,
                "code",
                a["code"],
                name=a["name"],
                title_id=title_map[a["title_code"]].id,
            )
        await session.commit()

        # Projects
        client_result = await session.execute(select(Client))
        client_map = {c.code: c for c in client_result.scalars().all()}

        project_map = {}
        for p in PROJECTS:
            proj, _ = await get_or_create(
                session,
                Project,
                "code",
                p["code"],
                name=p["name"],
                client_id=client_map[p["client_code"]].id,
                external_code=p.get("external_code"),
            )
            project_map[p["code"]] = proj
        await session.commit()

        # Assign all projects to all users
        all_users = (await session.execute(select(User))).scalars().all()
        for user in all_users:
            for proj in project_map.values():
                from sqlalchemy.dialects.postgresql import insert as pg_insert

                stmt = (
                    pg_insert(user_projects)
                    .values(user_id=user.id, project_id=proj.id)
                    .on_conflict_do_nothing()
                )
                await session.execute(stmt)
        await session.commit()

        # Project Approvers for 1728
        approver_result = await session.execute(select(Approver))
        approver_map = {a.code: a for a in approver_result.scalars().all()}

        proj_1728 = project_map["1728"]
        for pa in PROJECT_APPROVERS_1728:
            existing = await session.execute(
                select(ProjectApprover).where(
                    ProjectApprover.project_id == proj_1728.id,
                    ProjectApprover.document_type == pa["document_type"],
                    ProjectApprover.approver_order == pa["approver_order"],
                )
            )
            if not existing.scalar_one_or_none():
                session.add(
                    ProjectApprover(
                        project_id=proj_1728.id,
                        approver_id=approver_map[pa["approver_code"]].id,
                        approver_title_id=title_map[pa["title_code"]].id,
                        document_type=pa["document_type"],
                        approver_order=pa["approver_order"],
                    )
                )
        await session.commit()

        # Disciplines for 1728
        for d in DISCIPLINES_1728:
            await get_or_create(
                session,
                Discipline,
                "code",
                d["code"],
                name=d["name"],
                project_id=proj_1728.id,
            )
        await session.commit()

        # Reference Number Configs for 1728
        from app.models.reference_number_config import ReferenceNumberConfig

        for doc_type in ["WIR", "MIR", "CIR", "FAT", "CRS"]:
            existing = await session.execute(
                select(ReferenceNumberConfig).where(
                    ReferenceNumberConfig.project_id == proj_1728.id,
                    ReferenceNumberConfig.doc_type == doc_type,
                )
            )
            if not existing.scalar_one_or_none():
                session.add(
                    ReferenceNumberConfig(
                        project_id=proj_1728.id,
                        doc_type=doc_type,
                        pattern="{project_code}-{contractor_code}-{discipline_code}-{doc_type}-{serial:04d}",
                        project_code="MERC",
                        contractor_code="JMJV",
                        serial_start=1,
                    )
                )
        await session.commit()

        # Approval Statuses for 1728
        approval_statuses_1728 = [
            {
                "letter": "A",
                "name": "Approved",
                "description": "Work may proceed",
                "action": "approved",
            },
            {
                "letter": "B",
                "name": "Approved with Comments",
                "description": "Incorporate comments and proceed",
                "action": "approved",
            },
            {
                "letter": "C",
                "name": "Revise and Resubmit",
                "description": "Work may not proceed",
                "action": "rejected",
            },
            {
                "letter": "D",
                "name": "Review not Required",
                "description": "Work may proceed",
                "action": "approved",
            },
        ]
        for s in approval_statuses_1728:
            existing = await session.execute(
                select(ApprovalStatus).where(
                    ApprovalStatus.project_id == proj_1728.id,
                    ApprovalStatus.letter == s["letter"],
                )
            )
            if not existing.scalar_one_or_none():
                session.add(ApprovalStatus(project_id=proj_1728.id, **s))
        await session.commit()

        print("\nSeed complete.")


if __name__ == "__main__":
    asyncio.run(seed())
