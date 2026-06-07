import pytest_asyncio
import httpx

from tests.e2e._config import BASE_URL


@pytest_asyncio.fixture
async def client():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=60.0) as async_client:
        yield async_client
