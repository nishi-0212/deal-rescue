from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from ..db import get_db
from ..deps import workspace
from ..schemas import ReanalyzeIn
from ..serialize import clean
from ..services.detection import CATEGORY_LABEL
from ..services.jobs import runner

router = APIRouter(prefix="/api/deals", tags=["deals"])

SORTS = {
    "risk": [("latest.risk_score", -1), ("value", -1)],
    "value": [("value", -1)],
    "silent": [("latest.days_silent", -1)],
    "name": [("account", 1)],
    "at_risk": [("latest.value_at_risk", -1)],
}


async def get_deal_or_404(user_id: str, deal_id: str) -> dict[str, Any]:
    deal = await get_db().deals.find_one({"user_id": user_id, "deal_id": deal_id})
    if not deal:
        raise HTTPException(404, "Deal not found")
    return deal


@router.get("")
async def list_deals(
    user: dict = Depends(workspace),
    owner: str | None = None, stage: str | None = None,
    risk: str | None = Query(default=None, pattern="^(High|Medium|Low|Closed)$"),
    reason: str | None = None, stalled: bool | None = None,
    min_value: float | None = Query(default=None, ge=0), max_value: float | None = Query(default=None, ge=0),
    q: str | None = Query(default=None, max_length=100), sort: str = Query(default="risk"),
    status: str = Query(default="open", pattern="^(open|won|lost|all)$"),
    limit: int = Query(default=100, ge=1, le=500), offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    db = get_db()
    base: dict[str, Any] = {"user_id": user["id"]}
    if status != "all":
        base["status"] = status
    query = dict(base)
    if owner:
        query["owner"] = owner
    if stage:
        query["stage"] = stage
    if risk:
        query["latest.risk_level"] = risk
    if reason:
        query["latest.stall_category"] = reason
    if stalled is not None:
        query["latest.stalled"] = stalled
    if min_value is not None or max_value is not None:
        query["value"] = {k: v for k, v in (("$gte", min_value), ("$lte", max_value)) if v is not None}
    if q:
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [{"account": rx}, {"name": rx}, {"deal_id": rx}, {"owner": rx}]
    total = await db.deals.count_documents(query)
    items = await (db.deals.find(query).sort(SORTS.get(sort, SORTS["risk"])).skip(offset).limit(limit)
                   .to_list(length=None))
    everything = await db.deals.find(base).to_list(length=None)
    reasons = sorted({(d.get("latest") or {}).get("stall_category") for d in everything} - {None})
    facets = {
        "owners": sorted({d.get("owner") for d in everything if d.get("owner")}),
        "stages": sorted({d.get("stage") for d in everything if d.get("stage")}),
        "reasons": [{"value": r, "label": CATEGORY_LABEL.get(r, r)} for r in reasons],
    }
    return {"items": clean(items), "total": total, "facets": facets}


@router.post("/reanalyze", status_code=202)
async def reanalyze(body: ReanalyzeIn, user: dict = Depends(workspace)) -> dict[str, Any]:
    db = get_db()
    if body.pending_only:
        found = await db.deals.find({"user_id": user["id"], "needs_recheck": True}).to_list(length=None)
        ids = [d["deal_id"] for d in found]
        if not ids:
            raise HTTPException(404, "No changes waiting for a re-check.")
    elif body.deal_ids:
        found = await db.deals.find({"user_id": user["id"], "deal_id": {"$in": body.deal_ids}}).to_list(length=None)
        ids = [d["deal_id"] for d in found]
    else:
        ids = [d["deal_id"] for d in await db.deals.find({"user_id": user["id"]}).to_list(length=None)]
    if not ids:
        raise HTTPException(404, "No deals to analyze. Upload data first.")
    job = await runner.enqueue(user["id"], ids, trigger="manual", force=body.force,
                               label="Re-analysis" if len(ids) > 1 else f"Re-analysis: {ids[0]}")
    return {"job": clean(job)}


@router.get("/{deal_id}")
async def deal_detail(deal_id: str, user: dict = Depends(workspace)) -> dict[str, Any]:
    db = get_db()
    deal = await get_deal_or_404(user["id"], deal_id)
    q = {"user_id": user["id"], "deal_id": deal_id}
    analysis = await db.analyses.find_one(q, sort=[("version", -1)])
    acts = await db.activities.find(q).sort("date", -1).to_list(length=None)
    actions = await db.actions.find(q).sort([("status", 1), ("priority", 1), ("due_date", 1)]).to_list(length=None)
    drafts = await db.drafts.find(q).sort("created_at", -1).to_list(length=None)
    history = await db.analyses.find(q).sort("version", -1).limit(20).to_list(length=None)
    hist = [{"version": h["version"], "created_at": h["created_at"], "trigger": h["trigger"], "source": h["source"],
             "risk_score": h["risk_score"], "risk_level": h["risk_level"], "stalled": h["stalled"],
             "stall_reason": h.get("stall_reason"), "change_summary": h.get("change_summary"),
             "changes": h.get("changes", [])} for h in history]
    return clean({"deal": deal, "analysis": analysis, "timeline": acts, "actions": actions, "drafts": drafts,
                  "history": hist})


@router.get("/{deal_id}/analyses/{version}")
async def analysis_version(deal_id: str, version: int, user: dict = Depends(workspace)) -> dict[str, Any]:
    await get_deal_or_404(user["id"], deal_id)
    doc = await get_db().analyses.find_one({"user_id": user["id"], "deal_id": deal_id, "version": version})
    if not doc:
        raise HTTPException(404, "Analysis version not found")
    return clean(doc)
