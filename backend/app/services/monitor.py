"""Daily watch over open deals, without re-running the analysis.

Deals get riskier just by time passing (the customer stays quiet, the close date slips), even when no one
uploads anything. Once a day this runs the cheap rule-based detection (no AI call, nothing saved to the
analysis history) and compares it with the latest analysis. If the risk level changed, a new problem
appeared, or a deal waiting on the customer has had no reply for too long, the deal is flagged "changed"
so the user can re-check it when they choose. It never starts a re-analysis on its own.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from ..config import get_settings
from .analysis import FOLLOW_UP_AFTER_DAYS
from .detection import detect
from .pipelines import mark_needs_recheck
from .utils import as_aware, iso_day, now_utc

log = logging.getLogger("deal_rescue.monitor")


def _reason(deal: dict[str, Any], det: Any, prev: dict[str, Any] | None, actions: list[dict[str, Any]],
            as_of: datetime) -> str | None:
    latest = deal.get("latest") or {}
    before = {s["code"] for s in (prev or {}).get("signals", []) if s["weight"] > 0}
    if det.risk_level != latest.get("risk_level"):
        why = next((s["label"] for s in det.signals if s["weight"] > 0 and s["code"] not in before), None)
        return (f"Daily check: risk looks {det.risk_level.lower()} now (was {str(latest.get('risk_level')).lower()})"
                + (f", {why.lower()}" if why else ""))
    new = [s for s in det.signals if s["weight"] > 0 and s["code"] not in before]
    if new:
        return f"Daily check: {new[0]['label'].lower()}"
    if latest.get("waiting_on_customer"):
        done = [as_aware(a.get("completed_at")) for a in actions if a.get("status") == "done" and a.get("completed_at")]
        if done and (as_of - max(done)).days >= FOLLOW_UP_AFTER_DAYS:
            return f"Daily check: no reply {FOLLOW_UP_AFTER_DAYS}+ days after your last recovery step, time to follow up"
    return None


async def monitor_once(db: Any, as_of: datetime | None = None) -> int:
    """Check every open, analyzed deal once per day. Returns how many deals were flagged."""
    settings = get_settings()
    as_of = as_aware(as_of) or now_utc()
    today = iso_day(as_of)
    flagged = 0
    deals = await db.deals.find({"status": "open"}).to_list(length=None)
    for deal in deals:
        if not deal.get("latest") or deal.get("needs_recheck") or deal.get("monitored_on") == today:
            continue
        q = {"user_id": deal["user_id"], "deal_id": deal["deal_id"]}
        if await db.jobs.count_documents({"user_id": deal["user_id"], "status": {"$in": ["queued", "running"]}}):
            continue  # an analysis is already running in this pipeline
        acts = await db.activities.find(q).sort("date", 1).to_list(length=None)
        actions = await db.actions.find(q).to_list(length=None)
        prev = await db.analyses.find_one(q, sort=[("version", -1)])
        det = detect(deal, acts, actions, as_of=as_of, silence_days=settings.silence_days)
        reason = _reason(deal, det, prev, actions, as_of)
        if reason:
            await mark_needs_recheck(db, deal["user_id"], deal["deal_id"], reason)
            flagged += 1
        await db.deals.update_one({"_id": deal["_id"]}, {"$set": {"monitored_on": today}})
    if flagged:
        log.info("Daily check flagged %d deal(s) for a re-check", flagged)
    return flagged
