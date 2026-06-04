import pytest_asyncio
import httpx


BASE_URL = "http://localhost:8000"


@pytest_asyncio.fixture
async def client():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=60.0) as async_client:
        yield async_client