from __future__ import annotations

import logging
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query

from ..db import get_db
from ..deps import workspace
from ..schemas import ActionUpdate
from ..serialize import clean
from ..services.analysis import record_event
from ..services.pipelines import mark_needs_recheck
from ..services.utils import now_utc

router = APIRouter(prefix="/api/actions", tags=["recovery actions"])
log = logging.getLogger("deal_rescue.actions")
STATUS_LABEL = {"open": "Open", "in_progress": "In progress", "done": "Done", "dismissed": "Dismissed"}


@router.get("")
async def list_actions(user: dict = Depends(workspace),
                       status: str | None = Query(default=None, pattern="^(open|in_progress|done|dismissed|active)$"),
                       deal_id: str | None = None, owner: str | None = None) -> list[dict[str, Any]]:
    db = get_db()
    q: dict[str, Any] = {"user_id": user["id"]}
    if status == "active":
        q["status"] = {"$in": ["open", "in_progress"]}
    elif status:
        q["status"] = status
    if deal_id:
        q["deal_id"] = deal_id
    if owner:
        q["owner"] = owner
    items = await db.actions.find(q).sort([("priority", 1), ("due_date", 1)]).limit(500).to_list(length=None)
    deals = {d["deal_id"]: d for d in await db.deals.find({"user_id": user["id"]}).to_list(length=None)}
    for a in items:
        d = deals.get(a["deal_id"]) or {}
        a["deal"] = {"name": d.get("name"), "account": d.get("account"), "value": d.get("value"),
                     "risk_level": (d.get("latest") or {}).get("risk_level")}
    return clean(items)


@router.patch("/{action_id}")
async def update_action(action_id: str, body: ActionUpdate, user: dict = Depends(workspace)) -> dict[str, Any]:
    db = get_db()
    if not ObjectId.is_valid(action_id):
        raise HTTPException(404, "Action not found")
    action = await db.actions.find_one({"_id": ObjectId(action_id), "user_id": user["id"]})
    if not action:
        raise HTTPException(404, "Action not found")
    now = now_utc()
    changes: dict[str, Any] = {"updated_at": now}
    history_entry = None
    if body.owner is not None:
        changes["owner"] = body.owner.strip() or action["owner"]
    if body.due_date is not None:
        changes["due_date"] = body.due_date
    status_changed = body.status is not None and body.status != action["status"]
    if status_changed:
        changes["status"] = body.status
        changes["completed_at"] = now if body.status == "done" else None
        history_entry = {"at": now, "status": body.status, "note": body.note}
    update: dict[str, Any] = {"$set": changes}
    if history_entry:
        update["$push"] = {"history": history_entry}
    await db.actions.update_one({"_id": action["_id"]}, update)
    job = None
    if status_changed:
        deal = await db.deals.find_one({"user_id": user["id"], "deal_id": action["deal_id"]})
        await record_event(db, user["id"], "action",
                           f"{(deal or {}).get('account', action['deal_id'])}: “{action['title']}” → "
                           f"{STATUS_LABEL[body.status]}", action["deal_id"])
        # No automatic re-analysis: flag the deal so the user can re-check it when they're ready.
        await mark_needs_recheck(db, user["id"], action["deal_id"],
                                 f"“{action['title']}” marked {STATUS_LABEL[body.status].lower()}")
        log.info("Action %s -> %s", action_id, body.status)
    fresh = await db.actions.find_one({"_id": action["_id"]})
    return {"action": clean(fresh), "job": clean(job) if job else None}
