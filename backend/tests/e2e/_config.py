"""
HTTP endpoint configuration for e2e tests.

Imported by the test files. The base URL is configurable via the
``TEST_BASE_URL`` environment variable, defaulting to
``http://localhost:8000``:

    TEST_BASE_URL=http://localhost:50000 uv run pytest tests/e2e
"""

import os


BASE_URL: str = os.environ.get("TEST_BASE_URL", "http://localhost:50000").rstrip("/")
BASE: str = f"{BASE_URL}/api/v1"
