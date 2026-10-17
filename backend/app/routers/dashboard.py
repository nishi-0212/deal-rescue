from __future__ import annotations

import statistics
from typing import Any

from fastapi import APIRouter, Depends

from ..db import get_db
from ..deps import workspace
from ..serialize import clean
from ..services.detection import CATEGORY_LABEL

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/dashboard")
async def dashboard(user: dict = Depends(workspace)) -> dict[str, Any]:
    db = get_db()
    uid = user["id"]
    deals = await db.deals.find({"user_id": uid, "status": "open"}).to_list(length=None)
    actions = await db.actions.find({"user_id": uid, "status": {"$ne": "dismissed"}}).to_list(length=None)
    lat = lambda d: d.get("latest") or {}  # noqa: E731
    stalled = [d for d in deals if lat(d).get("stalled")]
    silent = [lat(d)["days_silent"] for d in stalled if lat(d).get("days_silent") is not None]
    total = sum(d.get("value") or 0 for d in deals)
    stalled_value = sum(d.get("value") or 0 for d in stalled)

    stages: dict[str, dict[str, Any]] = {}
    for d in deals:
        s = stages.setdefault(d.get("stage") or "Unknown", {"stage": d.get("stage") or "Unknown", "moving": 0.0,
                                                           "stalled": 0.0, "count": 0})
        s["stalled" if lat(d).get("stalled") else "moving"] += d.get("value") or 0
        s["count"] += 1
    from ..services.detection import stage_info
    stage_rows = sorted(stages.values(), key=lambda r: stage_info(r["stage"])[0])

    reasons: dict[str, dict[str, Any]] = {}
    for d in stalled:
        cat = lat(d).get("stall_category") or "engagement"
        r = reasons.setdefault(cat, {"category": cat, "label": CATEGORY_LABEL.get(cat, cat), "count": 0, "value": 0.0})
        r["count"] += 1
        r["value"] += d.get("value") or 0

    snaps = await db.snapshots.find({"user_id": uid}).sort("at", -1).limit(12).to_list(length=None)
    snaps.reverse()
    events = await db.events.find({"user_id": uid}).sort("at", -1).limit(10).to_list(length=None)
    active_jobs = await db.jobs.find({"user_id": uid, "status": {"$in": ["queued", "running"]}}).to_list(length=None)
    last = max((lat(d).get("analyzed_at") for d in deals if lat(d).get("analyzed_at")), default=None)
    top = sorted(stalled, key=lambda d: lat(d).get("value_at_risk") or 0, reverse=True)[:5]
    return clean({
        "has_data": bool(deals) or bool(await db.deals.find_one({"user_id": uid})),
        "last_analyzed_at": last,
        "activity_count": await db.activities.count_documents({"user_id": uid}),
        "kpis": {
            "total_pipeline": total, "open_deals": len(deals), "stalled_value": stalled_value,
            "stalled_count": len(stalled), "stalled_share": round(stalled_value / total * 100) if total else 0,
            "value_at_risk": sum(lat(d).get("value_at_risk") or 0 for d in deals),
            "high_risk": sum(1 for d in deals if lat(d).get("risk_level") == "High"),
            "median_days_silent": statistics.median(silent) if silent else 0,
            "actions_done": sum(1 for a in actions if a["status"] == "done"),
            "actions_total": len(actions),
            "actions_in_progress": sum(1 for a in actions if a["status"] == "in_progress"),
        },
        "trend": [{k: s.get(k) for k in ("at", "total_pipeline", "stalled_value", "high_risk", "median_days_silent",
                                          "actions_done")} for s in snaps],
        "stages": stage_rows,
        "reasons": sorted(reasons.values(), key=lambda r: -r["value"]),
        "feed": events,
        "top_at_risk": [{"deal_id": d["deal_id"], "account": d["account"], "name": d["name"],
                         "value_at_risk": lat(d).get("value_at_risk"), "risk_level": lat(d).get("risk_level")}
                        for d in top],
        "active_jobs": active_jobs,
    })
