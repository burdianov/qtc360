"""Documents API — split across crud, signing, approval, and attachments modules."""

from fastapi import APIRouter

from app.api.v1.documents.crud import router as crud_router
from app.api.v1.documents.signing import router as signing_router
from app.api.v1.documents.approval import router as approval_router
from app.api.v1.documents.attachments import router as attachments_router

router = APIRouter(prefix="/documents", tags=["documents"])

router.include_router(crud_router)
router.include_router(signing_router)
router.include_router(approval_router)
router.include_router(attachments_router)
