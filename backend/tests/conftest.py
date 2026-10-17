"""API test setup: an in-memory MongoDB (mongomock) behind an async wrapper, no network, no LLM."""
from __future__ import annotations

import os

os.environ.update({
    "GROQ_API_KEY": "", "JWT_SECRET": "test-secret", "ANALYSIS_INLINE": "true",
    "MONGODB_URI": "mongodb://unused", "FRONTEND_ORIGINS": "http://test", "SMTP_HOST": "",
})

import mongomock  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app import db as dbmod  # noqa: E402
from app.config import get_settings  # noqa: E402

get_settings.cache_clear()


class AsyncCursor:
    def __init__(self, cursor):
        self._c = cursor

    def sort(self, key, direction=None):
        self._c = self._c.sort(key, direction) if direction is not None else self._c.sort(key)
        return self

    def skip(self, n):
        self._c = self._c.skip(n)
        return self

    def limit(self, n):
        self._c = self._c.limit(n)
        return self

    async def to_list(self, length=None):
        items = list(self._c)
        return items if length is None else items[:length]


class AsyncCollection:
    def __init__(self, coll):
        self._c = coll

    def find(self, *args, **kwargs):
        return AsyncCursor(self._c.find(*args, **kwargs))

    def __getattr__(self, name):
        fn = getattr(self._c, name)

        async def call(*args, **kwargs):
            return fn(*args, **kwargs)

        return call


class AsyncDB:
    def __init__(self, db):
        self._db = db

    def __getattr__(self, name):
        return AsyncCollection(self._db[name])

    def __getitem__(self, name):
        return AsyncCollection(self._db[name])


@pytest_asyncio.fixture
async def db():
    client = mongomock.MongoClient(tz_aware=True)
    fake = AsyncDB(client["deal_rescue_test"])
    dbmod.set_database(fake)
    await dbmod.ensure_indexes(fake)
    yield fake
    dbmod.set_database(None)


@pytest_asyncio.fixture
async def client(db):
    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def register(client, email="rep@example.com", name="Priya"):
    r = await client.post("/api/auth/register", json={"name": name, "email": email, "password": "correct-horse-1"})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    pipelines = (await client.get("/api/pipelines", headers=h)).json()
    return {**h, "X-Pipeline-Id": pipelines[0]["id"]}


@pytest_asyncio.fixture
async def auth(client):
    return await register(client)


@pytest.fixture
def anyio_backend():
    return "asyncio"
