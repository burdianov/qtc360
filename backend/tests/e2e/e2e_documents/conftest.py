"""Re-export shim for the e2e_documents sub-suite.

All real fixtures, dataclasses, and constants now live in
``tests/e2e/conftest.py``. This file re-exports them so the
existing ``from .conftest import …`` lines in
``e2e_documents/helpers.py`` and ``from
.e2e_documents.conftest import MINIMAL_DOCX`` lines in
``test_reports_engine.py`` keep working without edits.

The only piece that stays local is the ``event_loop_policy``
override, which is harmless to expose at both levels and
prevents a regression if anyone re-defines the fixtures here.
"""

from __future__ import annotations

from tests.e2e.conftest import (  # noqa: F401
    API_PREFIX,
    BACKEND_DIR,
    E2EContext,
    DocumentSeedData,
    MINIMAL_DOCX,
    MINIMAL_PDF,
    MINIMAL_PNG,
    auth_headers,
    client,
    e2e_context,
    event_loop_policy,
    seed_data,
    tokens,
)
