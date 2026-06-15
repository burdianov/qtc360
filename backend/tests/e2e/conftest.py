"""Top-level pytest fixtures for the e2e suite.

This conftest is the **single source of truth** for shared
infrastructure that all e2e test files need:

  * `e2e_context`  — session-scoped: spins up a dedicated Postgres
    database + uvicorn sub-process, runs Alembic migrations + seeds,
    and tears them down on session exit.
  * `client`       — function-scoped: an httpx async client whose
    `base_url` already includes the `/api/v1` prefix, so test
    bodies can call paths like `/auth/login` directly.
  * `seed_data`    — session-scoped: id bag for the seeded project,
    discipline, assets, asset-requirements, and approval statuses.
    Used by every test that needs to create a document.
  * `tokens`       — session-scoped: `{site, qaqc, admin}` access
    tokens, logged in once and reused.
  * `auth_headers` — function-scoped: factory that wraps a token
    into `{"Authorization": "Bearer …"}`.

The fixtures used to live in `e2e_documents/conftest.py`. They
were hoisted here so the 13 flat-layout test files
(`test_auth_and_profile.py`, `test_admin_users_roles_audit.py`,
`test_master_data_crud.py`, …) can see them. The old location
re-exports them so existing imports (`from .conftest import
DocumentSeedData`, `from .e2e_documents.conftest import
MINIMAL_DOCX`) keep resolving.

The container bring-up in `docker-compose.e2e.yml` provides a
long-running backend on `TEST_BASE_URL=http://backend:8000`. We
ignore it here — `e2e_context` spawns its own uvicorn against a
fresh DB so the sub-suite stays reproducible. The container
backend is still used as the docker-compose healthcheck target.
"""

from __future__ import annotations

import asyncio
import io
import os
import socket
import subprocess
import sys
import time
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator

import asyncpg
import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select


BACKEND_DIR = Path(__file__).resolve().parents[2]
API_PREFIX = "/api/v1"


@dataclass(frozen=True)
class E2EContext:
    base_url: str
    api_url: str
    database_name: str
    upload_dir: Path
    database_url: str


@dataclass(frozen=True)
class DocumentSeedData:
    project_id: str
    discipline_id: str
    asset_ids: dict[str, str]
    asset_requirement_ids: dict[str, str]
    approval_status_ids: dict[str, str]


MINIMAL_PDF = (
    b"%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n"
    b"xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n"
    b"0000000058 00000 n \n0000000115 00000 n \n"
    b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF"
)


def _make_minimal_docx() -> bytes:
    """Create a minimal valid DOCX file (ZIP with required XML parts).

    Used to seed DocTemplate rows so template checks pass in e2e tests.
    The template contains a single placeholder paragraph.
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType='
            '"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            "</Types>",
        )
        zf.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type='
            '"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="word/document.xml"/>'
            "</Relationships>",
        )
        zf.writestr(
            "word/document.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            "<w:body><w:p><w:r><w:t>E2E Template</w:t></w:r></w:p></w:body>"
            "</w:document>",
        )
    return buf.getvalue()


MINIMAL_DOCX = _make_minimal_docx()
"""Minimal valid DOCX used for seeding DocTemplates in e2e tests."""

MINIMAL_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00"
    b"\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


@pytest.fixture(scope="session")
def event_loop_policy():
    """Pin a single asyncio policy for the session.

    pytest-asyncio 1.x complains when a function-scoped event loop
    is created inside a session that mixes loop-aware fixtures; the
    override here keeps it predictable.
    """
    return asyncio.DefaultEventLoopPolicy()


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _postgres_env(db_name: str, upload_dir: Path) -> dict[str, str]:
    env = os.environ.copy()
    env.update(
        {
            "POSTGRES_HOST": env.get("POSTGRES_HOST", "localhost"),
            "POSTGRES_PORT": env.get("POSTGRES_PORT", "5432"),
            "POSTGRES_USER": env.get("POSTGRES_USER", "qtc360"),
            "POSTGRES_PASSWORD": env.get("POSTGRES_PASSWORD", "qtc360_dev"),
            "POSTGRES_DB": db_name,
            "SECRET_KEY": env.get(
                "SECRET_KEY", "e2e-secret-key-that-is-long-enough-for-tests-only"
            ),
            "ENVIRONMENT": "development",
            "UPLOAD_DIR": str(upload_dir),
            "PYTHONUNBUFFERED": "1",
            # If the parent process (CI) has GOTENBERG_URL set, forward it
            # to the uvicorn sub-process so the S1/S2 assembly can convert
            # DOCX → PDF. Local devs who haven't set it will fall through
            # to the LibreOffice path.
            "GOTENBERG_URL": env.get("GOTENBERG_URL", "http://localhost:3100"),
        }
    )
    return env


def _run(cmd: list[str], env: dict[str, str]) -> None:
    completed = subprocess.run(
        cmd,
        cwd=BACKEND_DIR,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=180,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\n\n{completed.stdout}")


async def _connect_maintenance() -> asyncpg.Connection:
    return await asyncpg.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=int(os.environ.get("POSTGRES_PORT", "5432")),
        user=os.environ.get("POSTGRES_USER", "qtc360"),
        password=os.environ.get("POSTGRES_PASSWORD", "qtc360_dev"),
        database=os.environ.get("POSTGRES_MAINTENANCE_DB", "postgres"),
    )


async def _drop_database(db_name: str) -> None:
    conn = await _connect_maintenance()
    try:
        await conn.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
            db_name,
        )
        await conn.execute(f'DROP DATABASE IF EXISTS "{db_name}"')
    finally:
        await conn.close()


async def _create_database(db_name: str) -> None:
    conn = await _connect_maintenance()
    try:
        await conn.execute(f'CREATE DATABASE "{db_name}"')
    finally:
        await conn.close()


@pytest_asyncio.fixture(scope="session")
async def e2e_context(
    tmp_path_factory: pytest.TempPathFactory,
) -> AsyncIterator[E2EContext]:
    db_name = f"qtc360_e2e_{os.getpid()}_{uuid.uuid4().hex[:8]}"
    upload_dir = tmp_path_factory.mktemp("qtc360_uploads")
    env = _postgres_env(db_name, upload_dir)
    parent_env_keys = [
        "POSTGRES_HOST",
        "POSTGRES_PORT",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "POSTGRES_DB",
        "SECRET_KEY",
        "ENVIRONMENT",
        "UPLOAD_DIR",
    ]
    previous_env = {key: os.environ.get(key) for key in parent_env_keys}
    os.environ.update({key: env[key] for key in parent_env_keys})

    await _create_database(db_name)
    try:
        _run([sys.executable, "-m", "alembic", "upgrade", "head"], env)
        _run([sys.executable, "-m", "app.seed"], env)
        _run([sys.executable, "-m", "app.seed_commissioning"], env)
        if os.environ.get("QTC360_E2E_SEED_DEMO", "0") == "1":
            _run([sys.executable, "-m", "app.seed_demo"], env)

        port = _free_port()
        base_url = f"http://127.0.0.1:{port}"
        # Capture uvicorn output to a file so a 500 inside a sub-process is
        # visible to the developer running the suite.
        log_path = BACKEND_DIR / "e2e_uvicorn.log"
        log_fh = open(log_path, "w", encoding="utf-8")
        proc = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "app.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
            ],
            cwd=BACKEND_DIR,
            env=env,
            stdout=log_fh,
            stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 45
            last_error: Exception | None = None
            while time.monotonic() < deadline:
                if proc.poll() is not None:
                    log_fh.flush()
                    log_text = log_path.read_text(encoding="utf-8", errors="replace")
                    raise RuntimeError(
                        f"uvicorn exited early (code {proc.returncode}).\n"
                        f"--- uvicorn log ({log_path}) ---\n{log_text}\n--- end ---"
                    )
                try:
                    async with httpx.AsyncClient(timeout=2.0, verify=False) as c:
                        r = await c.get(f"{base_url}{API_PREFIX}/auth/me")
                    if r.status_code in {401, 403}:
                        break
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                await asyncio.sleep(0.25)
            else:
                proc.terminate()
                log_fh.flush()
                log_text = log_path.read_text(encoding="utf-8", errors="replace")
                raise RuntimeError(
                    f"Timed out waiting for app startup: {last_error!r}\n"
                    f"--- uvicorn log ({log_path}) ---\n{log_text}\n--- end ---"
                )

            host = env.get("POSTGRES_HOST", "localhost")
            port = env.get("POSTGRES_PORT", "5432")
            user = env.get("POSTGRES_USER", "qtc360")
            password = env.get("POSTGRES_PASSWORD", "qtc360_dev")
            database_url = (
                f"postgresql+asyncpg://{user}:{password}@{host}:{port}/{db_name}"
            )
            yield E2EContext(
                base_url=base_url,
                api_url=f"{base_url}{API_PREFIX}",
                database_name=db_name,
                upload_dir=upload_dir,
                database_url=database_url,
            )
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=10)
            log_fh.close()
    finally:
        if os.environ.get("QTC360_E2E_KEEP_DB", "0") != "1":
            await _drop_database(db_name)
        for key, value in previous_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


@pytest_asyncio.fixture
async def client(e2e_context: E2EContext) -> AsyncIterator[httpx.AsyncClient]:
    """Function-scoped httpx async client.

    `base_url` already includes `/api/v1` (via
    `e2e_context.api_url`), so test bodies can write
    `client.post("/auth/login", …)` directly.
    """
    async with httpx.AsyncClient(
        base_url=e2e_context.api_url, timeout=90.0, verify=False
    ) as c:
        yield c


@pytest_asyncio.fixture(scope="session")
async def seed_data(e2e_context: E2EContext) -> DocumentSeedData:
    from app.models.approval_status import ApprovalStatus
    from app.models.asset import Asset
    from app.models.commissioning import AssetRequirement, RequirementTemplate
    from app.models.discipline import Discipline
    from app.models.project import Project

    # Create a fresh engine + session factory pointing to the per-session
    # test database.  The module-level ``async_session_factory`` in
    # ``app/core/database.py`` is created at import time and may still
    # hold the *original* database URL, so we cannot rely on it here.
    from sqlalchemy.ext.asyncio import (
        AsyncSession,
        async_sessionmaker,
        create_async_engine,
    )

    _engine = create_async_engine(e2e_context.database_url, echo=False)
    _factory = async_sessionmaker(
        _engine, class_=AsyncSession, expire_on_commit=False
    )

    async with _factory() as session:
        # ── Seed DocTemplates (needed for submit-to-approver) ──────────────
        from app.models.doc_template import DocTemplate

        # Find a project that has disciplines (project 1733 has none).
        project = (
            (
                await session.execute(
                    select(Project)
                    .join(Discipline, Discipline.project_id == Project.id)
                    .order_by(Project.created_at)
                )
            )
            .scalars()
            .first()
        )
        assert project is not None, "seed did not create a project with disciplines"
        discipline = (
            (
                await session.execute(
                    select(Discipline)
                    .where(Discipline.project_id == project.id)
                    .order_by(Discipline.code)
                )
            )
            .scalars()
            .first()
        )
        assert discipline is not None, "seed did not create a discipline"

        assets = (
            (
                await session.execute(
                    select(Asset)
                    .where(Asset.project_id == project.id)
                    .order_by(Asset.tag_number)
                )
            )
            .scalars()
            .all()
        )
        assert assets, "commissioning seed did not create assets"
        asset_ids = {asset.tag_number: str(asset.id) for asset in assets}

        statuses = (
            (
                await session.execute(
                    select(ApprovalStatus).where(
                        ApprovalStatus.project_id == project.id
                    )
                )
            )
            .scalars()
            .all()
        )
        status_ids = {status.letter: str(status.id) for status in statuses}
        assert {"A", "B", "C", "D"}.issubset(status_ids), status_ids

        req_rows = (
            await session.execute(
                select(AssetRequirement, RequirementTemplate, Asset)
                .join(
                    RequirementTemplate,
                    AssetRequirement.requirement_template_id == RequirementTemplate.id,
                )
                .join(Asset, AssetRequirement.asset_id == Asset.id)
                .where(Asset.project_id == project.id)
            )
        ).all()
        by_doc_type: dict[str, str] = {}
        for asset_req, tmpl, _asset in req_rows:
            by_doc_type.setdefault(tmpl.evidence_document_type, str(asset_req.id))
        assert {"FAT", "MIR", "WIR", "CIR"}.issubset(by_doc_type), by_doc_type

        # Create DocTemplates for all document types (needed for bundle downloads)
        template_types = {"WIR", "MIR", "CIR", "CRS", "FAT"}
        for doc_type in template_types:
            existing = (
                (
                    await session.execute(
                        select(DocTemplate).where(
                            DocTemplate.project_id == project.id,
                            DocTemplate.doc_type == doc_type,
                            DocTemplate.is_deleted == False,
                        )
                    )
                )
                .scalars()
                .first()
            )
            if not existing:
                session.add(
                    DocTemplate(
                        project_id=project.id,
                        doc_type=doc_type,
                        name=f"E2E {doc_type} Template",
                        file=MINIMAL_DOCX,
                        filename=f"e2e_template_{doc_type}.docx",
                        file_format="docx",
                        version=1,
                        cover_page_count=1,
                        is_active=True,
                    )
                )
        await session.commit()

    await _engine.dispose()
    return DocumentSeedData(
        project_id=str(project.id),
        discipline_id=str(discipline.id),
        asset_ids=asset_ids,
        asset_requirement_ids=by_doc_type,
        approval_status_ids=status_ids,
    )


@pytest_asyncio.fixture(scope="session")
async def tokens(e2e_context: E2EContext) -> dict[str, str]:
    async def login(email: str, password: str) -> str:
        async with httpx.AsyncClient(
            base_url=e2e_context.api_url, timeout=30.0, verify=False
        ) as c:
            r = await c.post("/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200, f"login failed for {email}: {r.text}"
        return r.json()["access_token"]

    return {
        "site": await login("site@jlwme.com", "Site1234"),
        "qaqc": await login("qaqc@jlwme.com", "Qaqc1234"),
        "admin": await login("admin@jlwme.com", "Admin123"),
    }


@pytest.fixture
def auth_headers(tokens: dict[str, str]):
    def _headers(role: str = "site") -> dict[str, str]:
        return {"Authorization": f"Bearer {tokens[role]}"}

    return _headers
