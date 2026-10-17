"""Pipelines are separate workspaces (like chats): each has its own deals, analyses, actions and drafts.

All pipeline data is stored with `user_id` = "<user id>:<pipeline id>" (the *scope*), so every query in
the app is automatically limited to the signed-in user's current pipeline.
"""
from __future__ import annotations

from typing import Any

from bson import ObjectId

from .utils import now_utc

DEFAULT_NAME = "Untitled pipeline"
SCOPED_COLLECTIONS = ["deals", "activities", "analyses", "actions", "drafts", "uploads", "jobs", "events", "snapshots"]


def scope_of(user_id: str, pipeline_id: str) -> str:
    return f"{user_id}:{pipeline_id}"


def split_scope(scope: str) -> tuple[str, str | None]:
    uid, _, pid = scope.partition(":")
    return uid, (pid or None)


async def create_pipeline(db: Any, user_id: str, name: str | None = None) -> dict[str, Any]:
    now = now_utc()
    doc = {"user_id": user_id, "name": (name or DEFAULT_NAME).strip()[:80] or DEFAULT_NAME,
           "created_at": now, "updated_at": now}
    res = await db.pipelines.insert_one(doc)
    doc["_id"] = res.inserted_id
    return doc


async def is_empty(db: Any, scope: str) -> bool:
    """A pipeline with no deals or activity yet. Empty pipelines are hidden from Recents and reused."""
    return (await db.deals.count_documents({"user_id": scope}) == 0
            and await db.activities.count_documents({"user_id": scope}) == 0
            and await db.jobs.count_documents({"user_id": scope, "status": {"$in": ["queued", "running"]}}) == 0)


async def touch(db: Any, scope: str, name_if_untitled: str | None = None) -> None:
    """Mark a pipeline as recently used; give it a real name the first time data arrives."""
    _, pid = split_scope(scope)
    if not pid or not ObjectId.is_valid(pid):
        return
    p = await db.pipelines.find_one({"_id": ObjectId(pid)})
    if not p:
        return
    changes: dict[str, Any] = {"updated_at": now_utc()}
    if name_if_untitled and p.get("name") == DEFAULT_NAME:
        changes["name"] = name_if_untitled[:80]
    await db.pipelines.update_one({"_id": p["_id"]}, {"$set": changes})


async def delete_scope_data(db: Any, scope: str) -> dict[str, int]:
    removed = {}
    for c in SCOPED_COLLECTIONS:
        res = await db[c].delete_many({"user_id": scope})
        removed[c] = res.deleted_count
    await db.counters.delete_many({"_id": {"$regex": f"^{scope}:"}})
    return removed


async def stats(db: Any, scope: str) -> dict[str, Any]:
    deals = await db.deals.find({"user_id": scope}).to_list(length=None)
    open_deals = [d for d in deals if d.get("status") == "open"]
    lat = lambda d: d.get("latest") or {}  # noqa: E731
    actions = await db.actions.find({"user_id": scope, "status": {"$ne": "dismissed"}}).to_list(length=None)
    drafts = await db.drafts.find({"user_id": scope}).to_list(length=None)
    running = await db.jobs.count_documents({"user_id": scope, "status": {"$in": ["queued", "running"]}})
    return {
        "deals": len(deals),
        "analyzed": sum(1 for d in deals if d.get("latest")),
        "stalled": sum(1 for d in open_deals if lat(d).get("stalled")),
        "high_risk": sum(1 for d in open_deals if lat(d).get("risk_level") == "High"),
        "pipeline_value": sum(d.get("value") or 0 for d in open_deals),
        "stalled_value": sum(d.get("value") or 0 for d in open_deals if lat(d).get("stalled")),
        "activities": await db.activities.count_documents({"user_id": scope}),
        "actions_total": len(actions),
        "actions_done": sum(1 for a in actions if a["status"] == "done"),
        "drafts": sum(1 for d in drafts if d["status"] != "sent"),
        "sent": sum(1 for d in drafts if d["status"] == "sent"),
        "running": running > 0,
        "needs_recheck": sum(1 for d in open_deals if d.get("needs_recheck")),
        "waiting": sum(1 for d in open_deals if lat(d).get("stalled") and lat(d).get("waiting_on_customer")),
        # stalled deals where at least one recovery action has been started or finished
        "stalled_started": len({a["deal_id"] for a in actions if a["status"] in ("in_progress", "done")}
                               & {d["deal_id"] for d in open_deals if lat(d).get("stalled")}),
    }


async def migrate_legacy(db: Any, user_id: str, pipeline_id: str) -> int:
    """Move data created before pipelines existed (scoped by plain user id) into a pipeline."""
    scope = scope_of(user_id, pipeline_id)
    moved = 0
    for c in SCOPED_COLLECTIONS:
        res = await db[c].update_many({"user_id": user_id}, {"$set": {"user_id": scope}})
        moved += getattr(res, "modified_count", 0) or 0
    return moved


async def mark_needs_recheck(db: Any, scope: str, deal_id: str, reason: str) -> None:
    """Note a change the latest analysis hasn't seen yet. Re-analysis only runs when the user asks for it."""
    await db.deals.update_one({"user_id": scope, "deal_id": deal_id},
                              {"$set": {"needs_recheck": True, "recheck_reason": reason, "recheck_since": now_utc()},
                               "$inc": {"pending_changes": 1}})
