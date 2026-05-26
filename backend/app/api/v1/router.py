from fastapi import APIRouter

from app.api.v1.auth import router as auth_router
from app.api.v1.master import router as master_router
from app.api.v1.admin import router as admin_router

router = APIRouter(prefix="/api/v1")


@router.get("/health")
async def health_check():
    return {"status": "healthy", "service": "qtc360-api"}


router.include_router(auth_router)
router.include_router(master_router)
router.include_router(admin_router)
