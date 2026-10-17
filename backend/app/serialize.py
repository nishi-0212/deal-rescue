from __future__ import annotations

from datetime import datetime
from typing import Any

from bson import ObjectId

HIDDEN = {"user_id", "fingerprint", "input_fingerprint"}


def clean(value: Any) -> Any:
    """Make Mongo documents JSON-friendly: ObjectId -> str, _id -> id, drop internal fields."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, list):
        return [clean(v) for v in value]
    if isinstance(value, set):
        return [clean(v) for v in sorted(value)]
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if k in HIDDEN:
                continue
            out["id" if k == "_id" else k] = clean(v)
        return out
    return value
