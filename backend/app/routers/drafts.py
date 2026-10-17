from __future__ import annotations

import logging
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException

from ..db import get_db
from ..deps import workspace
from ..schemas import EMAIL_RE, DraftCreate, DraftSend, DraftUpdate
from ..serialize import clean
from ..services.analysis import record_event
from ..services.drafting import create_draft
from ..services.pipelines import mark_needs_recheck
from ..services.mailer import MailNotConfigured, send_email
from ..services.utils import now_utc
from .deals import get_deal_or_404

router = APIRouter(tags=["drafts"])
log = logging.getLogger("deal_rescue.drafts")


async def _get(user_id: str, draft_id: str) -> dict[str, Any]:
    if not ObjectId.is_valid(draft_id):
        raise HTTPException(404, "Draft not found")
    d = await get_db().drafts.find_one({"_id": ObjectId(draft_id), "user_id": user_id})
    if not d:
        raise HTTPException(404, "Draft not found")
    return d


@router.post("/api/deals/{deal_id}/drafts", status_code=201)
async def new_draft(deal_id: str, body: DraftCreate, user: dict = Depends(workspace)) -> dict[str, Any]:
    deal = await get_deal_or_404(user["id"], deal_id)
    action = None
    if body.action_id:
        if not ObjectId.is_valid(body.action_id):
            raise HTTPException(404, "Action not found")
        action = await get_db().actions.find_one({"_id": ObjectId(body.action_id), "user_id": user["id"],
                                                  "deal_id": deal_id})
        if not action:
            raise HTTPException(404, "Action not found")
    doc = await create_draft(get_db(), user["id"], deal, body.type, body.contact_email, action)
    return clean(doc)


@router.get("/api/drafts")
async def list_drafts(user: dict = Depends(workspace), deal_id: str | None = None,
                      status: str | None = None) -> list[dict[str, Any]]:
    q: dict[str, Any] = {"user_id": user["id"]}
    if deal_id:
        q["deal_id"] = deal_id
    if status in ("draft", "approved", "sent"):
        q["status"] = status
    docs = await get_db().drafts.find(q).sort("created_at", -1).limit(200).to_list(length=None)
    deals = {d["deal_id"]: d for d in await get_db().deals.find({"user_id": user["id"]}).to_list(length=None)}
    for d in docs:
        deal = deals.get(d["deal_id"]) or {}
        d["deal"] = {"name": deal.get("name"), "account": deal.get("account")}
    return clean(docs)


@router.patch("/api/drafts/{draft_id}")
async def edit_draft(draft_id: str, body: DraftUpdate, user: dict = Depends(workspace)) -> dict[str, Any]:
    d = await _get(user["id"], draft_id)
    if d["status"] == "sent":
        raise HTTPException(409, "This email was already sent and can't be edited")
    changes = {k: v for k, v in body.model_dump().items() if v is not None}
    if "to_email" in changes and changes["to_email"] and not EMAIL_RE.match(changes["to_email"]):
        raise HTTPException(422, "Recipient email is not valid")
    content_changed = any(changes.get(k) is not None and changes[k] != d.get(k) for k in changes)
    if content_changed:
        changes["updated_at"] = now_utc()
        if d["status"] == "approved":
            changes["status"], changes["approved_at"] = "draft", None  # edits need re-approval
        await get_db().drafts.update_one({"_id": d["_id"]}, {"$set": changes})
    return clean(await _get(user["id"], draft_id))


@router.post("/api/drafts/{draft_id}/approve")
async def approve_draft(draft_id: str, user: dict = Depends(workspace)) -> dict[str, Any]:
    d = await _get(user["id"], draft_id)
    if d["status"] == "sent":
        raise HTTPException(409, "Already sent")
    if not d.get("to_email"):
        raise HTTPException(422, "Add a recipient email before approving")
    await get_db().drafts.update_one({"_id": d["_id"]}, {"$set": {"status": "approved", "approved_at": now_utc()}})
    return clean(await _get(user["id"], draft_id))


@router.post("/api/drafts/{draft_id}/send")
async def send_draft(draft_id: str, body: DraftSend, user: dict = Depends(workspace)) -> dict[str, Any]:
    """Send an approved draft by SMTP. Requires explicit confirmation; never automatic."""
    d = await _get(user["id"], draft_id)
    if d["status"] != "approved":
        raise HTTPException(409, "Approve the draft before sending it")
    if not body.confirm:
        raise HTTPException(422, "Sending needs explicit confirmation")
    try:
        await send_email(d["to_email"], d["subject"], d["body"])
    except MailNotConfigured as exc:
        raise HTTPException(501, f"{exc}. Use 'Open in mail app' or copy the text instead.") from exc
    except Exception as exc:
        log.exception("SMTP send failed")
        raise HTTPException(502, "The mail server rejected the message") from exc
    return await _mark_sent(user["id"], d, "Sent by email")


@router.post("/api/drafts/{draft_id}/mark-sent")
async def mark_sent(draft_id: str, user: dict = Depends(workspace)) -> dict[str, Any]:
    """Record that you sent an approved draft yourself (for example from your mail app)."""
    d = await _get(user["id"], draft_id)
    if d["status"] != "approved":
        raise HTTPException(409, "Approve the draft first")
    return await _mark_sent(user["id"], d, "Marked as sent")


async def _mark_sent(user_id: str, d: dict[str, Any], how: str) -> dict[str, Any]:
    db = get_db()
    now = now_utc()
    await db.drafts.update_one({"_id": d["_id"]}, {"$set": {"status": "sent", "sent_at": now}})
    await record_event(db, user_id, "draft", f"{how}: “{d['subject']}”", d["deal_id"])
    # The email was the recovery action: mark it done and flag the deal for a re-check (run by the user).
    if d.get("action_id") and ObjectId.is_valid(d["action_id"]):
        action = await db.actions.find_one({"_id": ObjectId(d["action_id"]), "user_id": user_id})
        if action and action["status"] != "done":
            await db.actions.update_one({"_id": action["_id"]}, {
                "$set": {"status": "done", "completed_at": now, "updated_at": now},
                "$push": {"history": {"at": now, "status": "done", "note": f"Email sent: {d['subject']}"}}})
            await mark_needs_recheck(db, user_id, d["deal_id"], f"Email sent: “{d['subject']}”")
    return clean(await _get(user_id, str(d["_id"])))


@router.delete("/api/drafts/{draft_id}", status_code=204)
async def delete_draft(draft_id: str, user: dict = Depends(workspace)) -> None:
    d = await _get(user["id"], draft_id)
    await get_db().drafts.delete_one({"_id": d["_id"]})
