from fastapi import APIRouter

from app.api.v1.auth import router as auth_router
from app.api.v1.master import router as master_router
from app.api.v1.admin import router as admin_router
from app.api.v1.dashboard import router as dashboard_router
from app.api.v1.documents import router as documents_router
from app.api.v1.fats import router as fats_router
from app.api.v1.templates import router as templates_router
from app.api.v1.pdf import router as pdf_router

router = APIRouter(prefix="/api/v1")


@router.get("/health")
async def health_check():
    return {"status": "healthy", "service": "qtc360-api"}


router.include_router(auth_router)
router.include_router(master_router)
router.include_router(admin_router)
router.include_router(dashboard_router)
router.include_router(documents_router)
router.include_router(fats_router)
router.include_router(templates_router)
router.include_router(pdf_router)
