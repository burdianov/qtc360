#!/usr/bin/env bash
set -e
pip install uv
uv sync
uv run alembic upgrade head
uv run python -m app.seed
uv run python -m app.seed_commissioning
uv run python -m app.seed_demo
