"""Shared types, constants, and enums for the QTC360 backend."""
from enum import Enum
from pathlib import Path
from typing import Literal

# ─── Document Types ──────────────────────────────────────────────────────────
DocumentType = Literal["WIR", "MIR", "CIR", "FAT"]
DOCUMENT_TYPES: list[str] = ["WIR", "MIR", "CIR", "FAT"]

# ─── Tag Codes ───────────────────────────────────────────────────────────────
TagCode = Literal["red", "yellow", "green", "blue"]
TAG_CODES: list[str] = ["red", "yellow", "green", "blue"]

# ─── Tag ↔ Level Mapping ────────────────────────────────────────────────────
TAG_LEVEL_MAP: dict[str, list[str]] = {
    "red": ["L1", "L2A"],
    "yellow": ["L2B"],
    "green": ["L3"],
    "blue": ["L4"],
}

LEVEL_TAG_MAP: dict[str, str] = {
    level: tag for tag, levels in TAG_LEVEL_MAP.items() for level in levels
}

# ─── Document Statuses ───────────────────────────────────────────────────────
class DocStatus:
    DRAFT = "draft"
    INTERNALLY_SIGNED = "internally_signed"
    WITH_APPROVER_1 = "with_approver_1"
    APPROVER_1_RETURNED = "approver_1_returned"
    WITH_APPROVER_2 = "with_approver_2"
    APPROVED = "approved"
    APPROVED_WITH_COMMENTS = "approved_with_comments"
    REJECTED = "rejected"
    SUPERSEDED = "superseded"

# ─── Requirement Statuses ────────────────────────────────────────────────────
class ReqStatus:
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    PARTIAL = "partial"
    ACHIEVED = "achieved"

# ─── Permission Codes ────────────────────────────────────────────────────────
class PermissionCode(str, Enum):
    DOCUMENTS_SUBMIT = "documents.submit"
    DOCUMENTS_EDIT = "documents.edit"
    DOCUMENTS_DELETE = "documents.delete"
    COMMISSIONING_MANAGE = "commissioning.manage"
    MASTER_DATA_MANAGE = "master_data.manage"
    REPORTS_TEMPLATES = "reports.templates"
    ADMIN_USERS = "admin.users"
    ADMIN_ROLES = "admin.roles"
    ADMIN_SETTINGS = "admin.settings"

# ─── Role Names ──────────────────────────────────────────────────────────────
class RoleName:
    SUPER_ADMIN = "super_admin"
    ADMIN = "admin"
    SITE_ENGINEER = "site_engineer"
    QAQC_ENGINEER = "qaqc_engineer"
    QAQC_MANAGER = "qaqc_manager"
    VIEWER = "viewer"

# ─── Signature Defaults ──────────────────────────────────────────────────────
DEFAULT_SIGNATURE_FONT = "dancing_script"
DEFAULT_SIGNATURE_COLOR = "#1a237e"
FONTS_DIR = Path(__file__).parent.parent / "fonts"

# ─── Attachment Limits ───────────────────────────────────────────────────────
MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024  # 20 MB
MAX_ATTACHMENTS_PER_DOC = 200
ALLOWED_ATTACHMENT_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".docx"}
ALLOWED_ATTACHMENT_MIMES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

# ─── Pagination ──────────────────────────────────────────────────────────────
DEFAULT_PAGE_LIMIT = 100
MAX_PAGE_LIMIT = 500
NOTIFICATION_LIMIT = 50

# ─── PDF / LibreOffice ───────────────────────────────────────────────────────
LIBREOFFICE_TIMEOUT = 60
GOTENBERG_TIMEOUT = 30
DEFAULT_DATE_FORMAT = "DD.MM.YYYY"
OCR_ZOOM = 3.0

# ─── Approval ────────────────────────────────────────────────────────────────
MAX_APPROVERS = 10

# ─── Reference Config ────────────────────────────────────────────────────────
DEFAULT_SERIAL_START = 1
