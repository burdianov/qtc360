from fastapi import APIRouter

from app.api.v1.crud import create_crud_router
from app.models.client import Client
from app.models.project import Project
from app.models.approver import ApproverTitle, Approver
from app.models.project_approver import ProjectApprover
from app.models.discipline import Discipline
from app.models.service import Service
from app.models.asset_type import AssetType
from app.models.asset import Asset
from app.models.employee import Employee
from app.models.activity import Activity
from app.models.sub_activity import SubActivity
from app.models.test import Test
from app.models.system import System
from app.models.contractor import Contractor
from app.schemas.master import (
    ClientCreate, ClientResponse,
    ApproverTitleCreate, ApproverTitleResponse,
    ApproverCreate, ApproverResponse,
    ProjectCreate, ProjectResponse,
    ProjectApproverCreate, ProjectApproverResponse,
    DisciplineCreate, DisciplineResponse,
    ServiceCreate, ServiceResponse,
    AssetTypeCreate, AssetTypeResponse,
    AssetCreate, AssetResponse,
    EmployeeCreate, EmployeeResponse,
    ActivityCreate, ActivityResponse,
    SubActivityCreate, SubActivityResponse,
    TestCreate, TestResponse,
    SystemCreate, SystemResponse,
    ContractorCreate, ContractorResponse,
)

router = APIRouter()

router.include_router(create_crud_router(prefix="/clients", tag="clients", model=Client, create_schema=ClientCreate, response_schema=ClientResponse))
router.include_router(create_crud_router(prefix="/projects", tag="projects", model=Project, create_schema=ProjectCreate, response_schema=ProjectResponse))
router.include_router(create_crud_router(prefix="/approver-titles", tag="approver-titles", model=ApproverTitle, create_schema=ApproverTitleCreate, response_schema=ApproverTitleResponse))
router.include_router(create_crud_router(prefix="/approvers", tag="approvers", model=Approver, create_schema=ApproverCreate, response_schema=ApproverResponse))
router.include_router(create_crud_router(prefix="/project-approvers", tag="project-approvers", model=ProjectApprover, create_schema=ProjectApproverCreate, response_schema=ProjectApproverResponse))
router.include_router(create_crud_router(prefix="/disciplines", tag="disciplines", model=Discipline, create_schema=DisciplineCreate, response_schema=DisciplineResponse))
router.include_router(create_crud_router(prefix="/services", tag="services", model=Service, create_schema=ServiceCreate, response_schema=ServiceResponse))
router.include_router(create_crud_router(prefix="/asset-types", tag="asset-types", model=AssetType, create_schema=AssetTypeCreate, response_schema=AssetTypeResponse))
router.include_router(create_crud_router(prefix="/assets", tag="assets", model=Asset, create_schema=AssetCreate, response_schema=AssetResponse))
router.include_router(create_crud_router(prefix="/employees", tag="employees", model=Employee, create_schema=EmployeeCreate, response_schema=EmployeeResponse))
router.include_router(create_crud_router(prefix="/activities", tag="activities", model=Activity, create_schema=ActivityCreate, response_schema=ActivityResponse))
router.include_router(create_crud_router(prefix="/sub-activities", tag="sub-activities", model=SubActivity, create_schema=SubActivityCreate, response_schema=SubActivityResponse))
router.include_router(create_crud_router(prefix="/tests", tag="tests", model=Test, create_schema=TestCreate, response_schema=TestResponse))
router.include_router(create_crud_router(prefix="/systems", tag="systems", model=System, create_schema=SystemCreate, response_schema=SystemResponse))
router.include_router(create_crud_router(prefix="/contractors", tag="contractors", model=Contractor, create_schema=ContractorCreate, response_schema=ContractorResponse))
