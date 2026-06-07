from fastapi import APIRouter

from app.api.v1.crud import create_crud_router
from app.models.client import Client
from app.models.project import Project
from app.models.approver_title import ApproverTitle
from app.models.approver import Approver
from app.models.project_approver import ProjectApprover
from app.models.discipline import Discipline
from app.models.service import Service
from app.models.asset_type import AssetType
from app.models.asset import Asset
from app.models.system import System
from app.models.contractor import Contractor
from app.models.approval_status import ApprovalStatus
from app.models.designation import Designation
from app.schemas.master import (
    ClientCreate,
    ClientUpdate,
    ClientResponse,
    ApproverTitleCreate,
    ApproverTitleUpdate,
    ApproverTitleResponse,
    ApproverCreate,
    ApproverUpdate,
    ApproverResponse,
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
    ProjectApproverCreate,
    ProjectApproverUpdate,
    ProjectApproverResponse,
    DisciplineCreate,
    DisciplineUpdate,
    DisciplineResponse,
    ServiceCreate,
    ServiceUpdate,
    ServiceResponse,
    AssetTypeCreate,
    AssetTypeUpdate,
    AssetTypeResponse,
    AssetCreate,
    AssetUpdate,
    AssetResponse,
    SystemCreate,
    SystemUpdate,
    SystemResponse,
    ContractorCreate,
    ContractorUpdate,
    ContractorResponse,
    ApprovalStatusCreate,
    ApprovalStatusUpdate,
    ApprovalStatusResponse,
    DesignationCreate,
    DesignationUpdate,
    DesignationResponse,
)

router = APIRouter()

router.include_router(
    create_crud_router(
        prefix="/clients",
        tag="clients",
        model=Client,
        create_schema=ClientCreate,
        update_schema=ClientUpdate,
        response_schema=ClientResponse,
    )
)
router.include_router(
    create_crud_router(
        prefix="/projects",
        tag="projects",
        model=Project,
        create_schema=ProjectCreate,
        update_schema=ProjectUpdate,
        response_schema=ProjectResponse,
        eager=[Project.client],
    )
)
router.include_router(
    create_crud_router(
        prefix="/approver-titles",
        tag="approver-titles",
        model=ApproverTitle,
        create_schema=ApproverTitleCreate,
        update_schema=ApproverTitleUpdate,
        response_schema=ApproverTitleResponse,
    )
)
router.include_router(
    create_crud_router(
        prefix="/approvers",
        tag="approvers",
        model=Approver,
        create_schema=ApproverCreate,
        update_schema=ApproverUpdate,
        response_schema=ApproverResponse,
        eager=[Approver.title],
    )
)
from sqlalchemy.orm import selectinload  # noqa: E402

router.include_router(
    create_crud_router(
        prefix="/project-approvers",
        tag="project-approvers",
        model=ProjectApprover,
        create_schema=ProjectApproverCreate,
        update_schema=ProjectApproverUpdate,
        response_schema=ProjectApproverResponse,
        eager=[
            selectinload(ProjectApprover.approver).selectinload(Approver.title),
            ProjectApprover.approver_title,
        ],
        hard_delete=True,
    )
)
router.include_router(
    create_crud_router(
        prefix="/disciplines",
        tag="disciplines",
        model=Discipline,
        create_schema=DisciplineCreate,
        update_schema=DisciplineUpdate,
        response_schema=DisciplineResponse,
    )
)
router.include_router(
    create_crud_router(
        prefix="/services",
        tag="services",
        model=Service,
        create_schema=ServiceCreate,
        update_schema=ServiceUpdate,
        response_schema=ServiceResponse,
    )
)
router.include_router(
    create_crud_router(
        prefix="/asset-types",
        tag="asset-types",
        model=AssetType,
        create_schema=AssetTypeCreate,
        update_schema=AssetTypeUpdate,
        response_schema=AssetTypeResponse,
    )
)
router.include_router(
    create_crud_router(
        prefix="/assets",
        tag="assets",
        model=Asset,
        create_schema=AssetCreate,
        update_schema=AssetUpdate,
        response_schema=AssetResponse,
    )
)
router.include_router(
    create_crud_router(
        prefix="/systems",
        tag="systems",
        model=System,
        create_schema=SystemCreate,
        update_schema=SystemUpdate,
        response_schema=SystemResponse,
    )
)
router.include_router(
    create_crud_router(
        prefix="/contractors",
        tag="contractors",
        model=Contractor,
        create_schema=ContractorCreate,
        update_schema=ContractorUpdate,
        response_schema=ContractorResponse,
    )
)
router.include_router(
    create_crud_router(
        prefix="/approval-statuses",
        tag="approval-statuses",
        model=ApprovalStatus,
        create_schema=ApprovalStatusCreate,
        update_schema=ApprovalStatusUpdate,
        response_schema=ApprovalStatusResponse,
    )
)
router.include_router(
    create_crud_router(
        prefix="/designations",
        tag="designations",
        model=Designation,
        create_schema=DesignationCreate,
        update_schema=DesignationUpdate,
        response_schema=DesignationResponse,
    )
)
