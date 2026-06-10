# Isolated document lifecycle E2E tests

These tests create a throwaway PostgreSQL database, run Alembic migrations, seed the minimum project/master/commissioning data, start the FastAPI app on a random localhost port, run the lifecycle tests, and drop the database afterward.

Run from `backend/`:

```bash
uv run pytest tests/e2e_documents -v --tb=short
```

Useful environment variables:

```bash
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=qtc360
POSTGRES_PASSWORD=qtc360_dev
QTC360_E2E_KEEP_DB=1        # keep failed/success DB for debugging
QTC360_E2E_SEED_DEMO=0      # default: do not run app.seed_demo
```

The suite intentionally does not use your local `qtc360` database. Each run uses a database named like `qtc360_e2e_<pid>_<random>`.
