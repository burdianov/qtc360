"""Shared types, constants, and enums for the QTC360 backend."""

from enum import Enum
from pathlib import Path
from typing import Literal

# ─── Document Types ──────────────────────────────────────────────────────────
DocumentType = Literal["WIR", "MIR", "CIR", "FAT", "CRS", "CHECKLIST"]
DOCUMENT_TYPES: list[str] = ["WIR", "MIR", "CIR", "FAT", "CRS", "CHECKLIST"]

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


# ─── Attachment Kinds ────────────────────────────────────────────────────────
class AttachmentKind:
    """Single source of truth for DocumentAttachment.kind values.

    Stored as a String(20) in the DB (so we don't need a migration), but every
    write/read site must go through these constants. ``BUNDLE_KINDS`` is the
    set of kinds that ship inside a downloaded document bundle.
    """

    USER = "user"  # doc-level user upload
    CHECKLIST = "checklist"  # generated checklist PDF
    RETURNED = "returned_pdf"  # the approver's returned/annotated PDF
    ROUND_USER = "user_attachment"  # user-uploaded attachment to a round
    CACHE = "generated_main"  # cached main-PDF (rebuilt when doc.updated_at moves)


BUNDLE_KINDS = (
    AttachmentKind.USER,
    AttachmentKind.CHECKLIST,
    AttachmentKind.ROUND_USER,
    AttachmentKind.RETURNED,
)


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
    NOT_APPLICABLE = "not_applicable"


# ─── Permission Codes ────────────────────────────────────────────────────────
class PermissionCode(str, Enum):
    DOCUMENTS_VIEW = "documents.view"
    DOCUMENTS_SUBMIT = "documents.submit"
    DOCUMENTS_EDIT = "documents.edit"
    DOCUMENTS_DELETE = "documents.delete"
    DOCUMENTS_SIGN = "documents.sign"
    DOCUMENTS_CREATE = "documents.create"
    COMMISSIONING_MANAGE = "commissioning.manage"
    COMMISSIONING_VIEW = "commissioning.view"
    MASTER_DATA_MANAGE = "master_data.manage"
    REPORTS_TEMPLATES = "reports.templates"
    REPORTS_GENERATE = "reports.generate"
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
DEFAULT_SIG_CONFIG = {"cell_width": 75, "cell_height": 25, "x_offset": 0, "y_offset": 0}

# ─── Attachment Limits ───────────────────────────────────────────────────────
MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024  # 50 MB per file
MAX_BUNDLE_BYTES = (
    50 * 1024 * 1024
)  # 50 MB total bundle cap (sum of all files in a merge)
MAX_HEADER_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB CRS header image
MAX_SIGNATURE_IMAGE_BYTES = 2 * 1024 * 1024  # 2 MB uploaded signature PNG
MAX_TEMPLATE_BYTES = 10 * 1024 * 1024  # 10 MB DOCX/XLSX template upload
MAX_ATTACHMENTS_PER_DOC = 200
ALLOWED_ATTACHMENT_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".docx"}
ALLOWED_ATTACHMENT_MIMES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def _mb(n: int) -> int:
    """Convert a byte count to its integer MB value for human-readable messages."""
    return n // (1024 * 1024)


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
