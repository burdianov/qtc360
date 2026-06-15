#!/usr/bin/env bash
# Cross-platform (POSIX / Git Bash) wrapper for the docker-based e2e suite.
#
# Usage:
#   ./scripts/run_e2e.sh                  # run the full suite
#   ./scripts/run_e2e.sh -k checklist     # one keyword
#   ./scripts/run_e2e.sh tests/e2e/test_ref_config.py -v
#
# All extra args are passed through to pytest (as the PYTEST_ARGS env var).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Build first so the user sees the build progress before compose starts.
# docker-compose.e2e.yml has three services (init/backend/tests) that
# share the same Dockerfile.e2e, so a parameter-less `build` is enough.
echo "[run_e2e] building backend-e2e image …"
docker compose -f docker-compose.e2e.yml build

if [ "$#" -gt 0 ]; then
    # Quoted so spaces inside a single argument survive. The compose file
    # then re-splits on whitespace via `sh -c '... $PYTEST_ARGS'`.
    PYTEST_ARGS=$(printf ' %q' "$@")
    export PYTEST_ARGS
fi

echo "[run_e2e] bringing up postgres + gotenberg + backend-e2e …"
docker compose -f docker-compose.e2e.yml up --abort-on-container-exit --exit-code-from backend-e2e
