"""MongoDB access.

The app uses PyMongo's native async client. Tests swap in an async wrapper around
mongomock through `set_database`, so nothing else needs to know which one is active.
"""
from __future__ import annotations

import logging
from typing import Any

from pymongo import ASCENDING, DESCENDING

from .config import get_settings

log = logging.getLogger("deal_rescue.db")

_client: Any = None
_db: Any = None


def set_database(db: Any) -> None:
    """Override the database (used by tests)."""
    global _db
    _db = db


def get_db() -> Any:
    if _db is None:
        raise RuntimeError("Database is not connected")
    return _db


async def connect() -> None:
    global _client, _db
    if _db is not None:
        return
    from pymongo import AsyncMongoClient

    settings = get_settings()
    _client = AsyncMongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=8000, tz_aware=True)
    _db = _client[settings.mongodb_db]
    log.info("Connected to MongoDB database '%s'", settings.mongodb_db)


async def close() -> None:
    global _client, _db
    if _client is not None:
        await _client.close()
    _client = None
    _db = None


async def ensure_indexes(db: Any) -> None:
    await db.users.create_index([("email", ASCENDING)], unique=True)
    await db.deals.create_index([("user_id", ASCENDING), ("deal_id", ASCENDING)], unique=True)
    await db.deals.create_index([("user_id", ASCENDING), ("latest.risk_score", DESCENDING)])
    await db.activities.create_index([("user_id", ASCENDING), ("deal_id", ASCENDING), ("date", ASCENDING)])
    await db.activities.create_index([("user_id", ASCENDING), ("fingerprint", ASCENDING)], unique=True)
    await db.activities.create_index([("user_id", ASCENDING), ("activity_id", ASCENDING)])
    await db.analyses.create_index([("user_id", ASCENDING), ("deal_id", ASCENDING), ("version", DESCENDING)])
    await db.actions.create_index([("user_id", ASCENDING), ("deal_id", ASCENDING), ("status", ASCENDING)])
    await db.drafts.create_index([("user_id", ASCENDING), ("deal_id", ASCENDING)])
    await db.uploads.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    await db.jobs.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    await db.events.create_index([("user_id", ASCENDING), ("at", DESCENDING)])
    await db.snapshots.create_index([("user_id", ASCENDING), ("at", DESCENDING)])


async def next_sequence(db: Any, key: str) -> int:
    """Atomic counter used for readable activity IDs (EML-0001, CALL-0002 …)."""
    from pymongo import ReturnDocument

    doc = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER
    )
    return int(doc["seq"])
