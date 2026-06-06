from fastapi import APIRouter

from app.api.v1.auth import router as auth_router
from app.api.v1.master import router as master_router
from app.api.v1.admin import router as admin_router
from app.api.v1.dashboard import router as dashboard_router
from app.api.v1.documents import router as documents_router
from app.api.v1.reports import router as reports_router
from app.api.v1.notifications import router as notifications_router
from app.api.v1.ref_config import router as ref_config_router
from app.api.v1.commissioning import router as commissioning_router
from app.api.v1.checklist import router as checklist_router

router = APIRouter(prefix="/api/v1")


@router.get("/health")
async def health_check():
    return {"status": "healthy", "service": "qtc360-api"}


router.include_router(auth_router)
router.include_router(master_router)
router.include_router(admin_router)
router.include_router(dashboard_router)
router.include_router(documents_router)
router.include_router(reports_router)
router.include_router(notifications_router)
router.include_router(ref_config_router)
router.include_router(commissioning_router)
router.include_router(checklist_router)
