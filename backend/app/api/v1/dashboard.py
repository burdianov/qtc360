from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.discipline import Discipline
from app.models.employee import Employee
from app.models.system import System
from app.models.contractor import Contractor
from app.models.service import Service
from app.models.test import Test
from app.models.project_approver import ProjectApprover

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/stats")
async def get_dashboard_stats(
    project_id: UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    async def count(model, **filters):
        stmt = select(func.count()).select_from(model).where(model.is_deleted == False)  # noqa: E712
        for k, v in filters.items():
            stmt = stmt.where(getattr(model, k) == v)
        return (await db.execute(stmt)).scalar() or 0

    disciplines = await count(Discipline, project_id=project_id)
    systems = await count(System, project_id=project_id)
    contractors = await count(Contractor, project_id=project_id)
    employees = await count(Employee, project_id=project_id)
    tests = await count(Test, project_id=project_id)

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
        "employees": employees,
        "tests": tests,
        "approvers": approvers,
    }
