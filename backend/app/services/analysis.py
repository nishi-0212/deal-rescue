"""Run the full analysis for a deal and persist a new, versioned result."""
from __future__ import annotations

import logging
import statistics
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from typing import Any

from ..config import get_settings
from . import fallback
from .ai_schemas import Diagnosis, ground
from .detection import detect
from .diff import compare
from .llm import LLMError, complete_json
from .prompts import diagnosis_messages
from .utils import as_aware, fingerprint, iso_day, norm_key, now_utc

log = logging.getLogger("deal_rescue.analysis")

ACTION_TYPE_SIGNALS = {
    "security_questionnaire": ["BLOCKER_SECURITY"],
    "revise_pricing": ["BLOCKER_PRICING"],
    "involve_decision_maker": ["MISSING_ECONOMIC_BUYER", "ECONOMIC_BUYER_NOT_ENGAGED", "BLOCKER_APPROVAL"],
    "technical_meeting": ["MISSING_TECHNICAL_EVALUATOR", "BLOCKER_SECURITY"],
    "procurement_help": ["BLOCKER_PROCUREMENT", "MISSING_PROCUREMENT"],
    "update_forecast": ["FORECAST_MISMATCH", "CLOSE_DATE_PASSED", "CLOSE_DATE_AT_RISK"],
    "contact_customer": ["UNANSWERED_CUSTOMER_EMAIL", "NO_RECENT_ENGAGEMENT", "MISSED_FOLLOW_UP", "MEETING_DECLINED",
                         "NO_REPLY_TO_FOLLOWUPS"],
    "escalate_internally": ["LONG_STAGE", "BLOCKER_LEGAL"],
}


# A finished recovery step keeps covering its problem until the customer does something new, or until
# this many days pass with the problem still there (then one follow-up is suggested).
FOLLOW_UP_AFTER_DAYS = 14
OPEN_STATES = ("open", "in_progress")


async def record_event(db: Any, user_id: str, kind: str, text: str, deal_id: str | None = None) -> None:
    await db.events.insert_one({"user_id": user_id, "deal_id": deal_id, "kind": kind, "text": text, "at": now_utc()})


async def load_deal_context(db: Any, user_id: str, deal_id: str):
    deal = await db.deals.find_one({"user_id": user_id, "deal_id": deal_id})
    if not deal:
        return None, [], []
    acts = await db.activities.find({"user_id": user_id, "deal_id": deal_id}).sort("date", 1).to_list(length=None)
    actions = await db.actions.find({"user_id": user_id, "deal_id": deal_id}).to_list(length=None)
    return deal, acts, actions


def _input_fingerprint(deal: dict[str, Any], acts: list[dict[str, Any]], actions: list[dict[str, Any]],
                       as_of: datetime, llm: bool) -> str:
    fields = [deal.get(k) for k in ("value", "stage", "owner", "expected_close", "probability", "forecast_category",
                                    "status", "stage_entered", "contacts")]
    return fingerprint(fields, [a["activity_id"] for a in acts], sorted((str(a["_id"]), a["status"]) for a in actions),
                       iso_day(as_of), llm)


StageFn = Callable[[str], Awaitable[None]]


async def _noop(_: str) -> None:
    return None


async def analyze_deal(db: Any, user_id: str, deal_id: str, trigger: str = "manual", force: bool = False,
                       as_of: datetime | None = None, on_stage: StageFn | None = None) -> dict[str, Any] | None:
    """Analyze one deal. `on_stage` is called with reading → detecting → diagnosing → planning for live progress."""
    settings = get_settings()
    stage = on_stage or _noop
    as_of = as_aware(as_of) or now_utc()
    await stage("reading")
    deal, acts, actions = await load_deal_context(db, user_id, deal_id)
    if not deal:
        return None
    prev = await db.analyses.find_one({"user_id": user_id, "deal_id": deal_id}, sort=[("version", -1)])
    fp = _input_fingerprint(deal, acts, actions, as_of, settings.llm_enabled)
    if prev and not force and prev.get("input_fingerprint") == fp:
        return prev

    await stage("detecting")
    det = detect(deal, acts, actions, as_of=as_of, silence_days=settings.silence_days)
    await stage("diagnosing")
    done_actions = [a for a in actions if a.get("status") == "done"]
    source, model, notes = "rules", None, []
    diag: Diagnosis | None = None
    if settings.llm_enabled and deal.get("status") == "open":
        try:
            raw = await complete_json(diagnosis_messages(deal, det, acts, done_actions), Diagnosis)
            raw, notes = ground(raw, det.allowed_evidence, {s["code"] for s in det.signals})
            if raw.root_causes or not [s for s in det.signals if s["weight"] > 0]:
                diag, source, model = raw, "ai", settings.groq_model
            else:
                notes.append("AI findings had no valid evidence; used rule-based findings instead.")
        except LLMError as exc:
            notes.append(f"AI unavailable, used rule-based analysis ({str(exc)[:120]}).")
            log.warning("Diagnosis fell back to rules for %s: %s", deal_id, exc)
    if diag is None:
        diag = fallback.diagnose(deal, det, acts)
    for item in diag.recovery_plan:
        if not item.addresses:
            codes = {s["code"] for s in det.signals}
            item.addresses = [c for c in ACTION_TYPE_SIGNALS.get(item.action_type, []) if c in codes][:3]

    await stage("planning")
    new_doc: dict[str, Any] = {
        "user_id": user_id, "deal_id": deal_id, "version": (prev["version"] + 1) if prev else 1,
        "created_at": now_utc(), "as_of": as_of, "trigger": trigger, "source": source, "model": model,
        "input_fingerprint": fp, "grounding_notes": notes,
        "risk_score": det.risk_score, "risk_level": det.risk_level, "stalled": det.stalled,
        "stall_reason": det.stall_reason, "stall_category": det.stall_category, "confidence": det.confidence,
        "days_silent": det.days_silent, "days_in_stage": det.days_in_stage, "stage_benchmark": det.stage_benchmark,
        "last_customer_touch": det.last_customer_touch, "last_activity": det.last_activity,
        "value_at_risk": det.value_at_risk, "signals": det.signals,
        "first_risk_score": (prev.get("first_risk_score") or prev["risk_score"]) if prev else det.risk_score, "stakeholders": det.stakeholders,
        "engagement": det.engagement, "diagnosis": diag.model_dump(),
    }
    since = prev["created_at"] if prev else None
    new_ids = [a["activity_id"] for a in acts if since and a.get("created_at") and as_aware(a["created_at"]) > as_aware(since)]
    done_titles = [a["title"] for a in done_actions if since and a.get("completed_at")
                   and as_aware(a["completed_at"]) > as_aware(since)]
    changes, summary = compare(prev, new_doc, new_ids, done_titles)
    new_doc["changes"], new_doc["change_summary"] = changes, summary
    new_doc["previous"] = ({"version": prev["version"], "risk_score": prev["risk_score"],
                            "risk_level": prev["risk_level"]} if prev else None)
    res = await db.analyses.insert_one(new_doc)
    new_doc["_id"] = res.inserted_id

    prev_codes = {sg["code"] for sg in (prev or {}).get("signals", []) if sg["weight"] > 0}
    added = await _sync_actions(db, user_id, deal, diag, det, acts, new_doc["version"], as_of, actions, prev_codes)
    all_actions = await db.actions.find({"user_id": user_id, "deal_id": deal_id}).to_list(length=None)
    live = [a for a in all_actions if a["status"] != "dismissed"]
    # Every recovery step is done and nothing new came up: the ball is in the customer's court.
    waiting = bool(deal.get("status") == "open" and det.stalled and live
                   and not any(a["status"] in OPEN_STATES for a in live))
    next_action = diag.recommended_next_action
    if waiting:
        last_done = max((as_aware(a.get("completed_at")) for a in live if a.get("completed_at")), default=as_of)
        next_action = (f"You've finished every recovery step. Wait for {deal.get('account') or 'the customer'} to "
                       f"respond. If nothing comes back by {iso_day(last_done + timedelta(days=FOLLOW_UP_AFTER_DAYS))}, "
                       f"Deal Rescue will suggest a follow-up.")
    if prev and added:
        extra = [{"kind": "actions_added", "text": f"New recovery step: {t} ({why})."} for t, why in added]
        new_doc["changes"] = (new_doc["changes"] or []) + extra
        await db.analyses.update_one({"_id": new_doc["_id"]}, {"$set": {"changes": new_doc["changes"]}})
    latest = {
        "analysis_version": new_doc["version"], "analyzed_at": new_doc["created_at"], "source": source,
        "risk_score": det.risk_score, "risk_level": det.risk_level, "stalled": det.stalled,
        "stall_reason": det.stall_reason, "stall_category": det.stall_category, "confidence": det.confidence,
        "days_silent": det.days_silent, "days_in_stage": det.days_in_stage, "value_at_risk": det.value_at_risk,
        "next_action": next_action, "change_summary": summary, "waiting_on_customer": waiting,
        "previous_risk_score": prev["risk_score"] if prev else None,
        "first_risk_score": ((prev.get("first_risk_score") if prev else None)
                             or (prev["risk_score"] if prev else det.risk_score)),
        "recovery": {"done": sum(1 for a in live if a["status"] == "done"), "total": len(live),
                     "started": sum(1 for a in live if a["status"] in ("done", "in_progress"))},
    }
    await db.deals.update_one({"_id": deal["_id"]}, {"$set": {"latest": latest, "updated_at": now_utc(),
                                                               "needs_recheck": False, "pending_changes": 0,
                                                               "recheck_reason": None}})
    if prev and changes and any(c["kind"] in ("risk_level", "signal_added", "signal_resolved") for c in changes):
        await record_event(db, user_id, "risk_change", f"{deal['account']}: {summary}", deal_id)
    elif not prev:
        await record_event(db, user_id, "analyzed",
                           f"{deal['account']} analyzed: {det.risk_level} risk"
                           + (f" · {det.stall_reason}" if det.stalled and det.stall_reason else ""), deal_id)
    return new_doc


def _plan_item_codes(item: Any, signal_codes: set[str]) -> list[str]:
    return [c for c in (item.addresses or []) if c in signal_codes] or \
        [c for c in ACTION_TYPE_SIGNALS.get(item.action_type, []) if c in signal_codes]


def _reopened(action: dict[str, Any], codes: list[str], det: Any, acts_by_id: dict[str, Any],
              as_of: datetime) -> str | None:
    """Why a finished step's problem needs a new step, or None if it's still covered."""
    done_at = as_aware(action.get("completed_at"))
    if not done_at:
        return None
    for sgn in det.signals:
        if sgn["code"] not in codes:
            continue
        for eid in sgn.get("evidence_ids") or []:
            a = acts_by_id.get(eid)
            if a and a.get("direction") != "outbound" and as_aware(a.get("date")) and as_aware(a["date"]) > done_at:
                return "the customer raised something new"
    if (as_of - done_at).days >= FOLLOW_UP_AFTER_DAYS:
        return f"no progress {FOLLOW_UP_AFTER_DAYS}+ days after “{action['title']}”"
    return None


async def _sync_actions(db: Any, user_id: str, deal: dict[str, Any], diag: Diagnosis, det: Any,
                        acts: list[dict[str, Any]], version: int, as_of: datetime,
                        existing: list[dict[str, Any]], prev_codes: set[str] | None = None) -> list[tuple[str, str]]:
    """Add plan items only for problems no existing step already covers.

    Re-analysis regenerates the plan (and the AI words it differently each time), so matching by title alone
    would keep piling up near-duplicates. Instead each item is matched to the problems (signal codes) it
    addresses: an open, in-progress or dismissed step for the same problem means skip; a finished one means
    skip too, unless the customer has done something new since or it has been FOLLOW_UP_AFTER_DAYS days.
    A problem with no step at all only gets one if it is new since the last analysis: the first plan already
    chose the most important steps, so a re-check must not quietly add steps for problems that were there.
    Returns (title, reason) for each step added on a re-check.
    """
    signal_codes = {sg["code"] for sg in det.signals if sg["weight"] > 0}
    acts_by_id = {a["activity_id"]: a for a in acts}
    before = list(existing)  # coverage is judged against steps that existed before this run
    keys = {norm_key(a["title"]): a for a in existing}
    first_run = not before
    added: list[tuple[str, str]] = []
    now = now_utc()

    prev_codes = prev_codes or set()

    def still_needed(cover: list[dict[str, Any]], codes: list[str]) -> tuple[bool, str]:
        if not cover:
            return (not set(codes) <= prev_codes), "a new problem showed up"
        if any(a["status"] in (*OPEN_STATES, "dismissed") for a in cover):
            return False, ""
        why = [_reopened(a, codes, det, acts_by_id, as_of) for a in cover]
        return (all(why), why[0] or "") if why else (True, "")

    for item in diag.recovery_plan:
        k = norm_key(item.title)
        if not k:
            continue
        codes = _plan_item_codes(item, signal_codes)
        reason = "recommended by analysis"
        if not first_run:
            if codes:
                needed = [still_needed([a for a in before if c in (a.get("addresses") or [])], [c]) for c in codes]
                if not any(n for n, _ in needed):
                    continue
                reason = next(r for n, r in needed if n)
            else:
                same = [a for a in before if a.get("action_type") == item.action_type]
                ok, reason = still_needed(same, [])
                if not same or not ok:
                    continue  # a vague extra step with no problem behind it: don't grow the plan for it
        same_title = keys.get(k)
        if same_title is not None and same_title["status"] != "done":
            continue
        title = item.title if same_title is None else f"Follow up: {item.title}"
        if title != item.title and norm_key(title) in keys:
            continue
        doc = {
            "user_id": user_id, "deal_id": deal["deal_id"], "title": title, "action_type": item.action_type,
            "why": item.why, "owner": item.owner, "priority": item.priority,
            "due_date": iso_day(as_of + timedelta(days=item.due_in_days)),
            "expected_outcome": item.expected_outcome, "evidence_ids": item.evidence_ids,
            "addresses": codes or item.addresses, "status": "open", "created_from_version": version,
            "completed_at": None, "history": [{"at": now, "status": "open", "note": reason[:1].upper() + reason[1:]}],
            "created_at": now, "updated_at": now,
        }
        await db.actions.insert_one(doc)
        existing.append(doc)
        keys[norm_key(title)] = doc
        if not first_run:
            added.append((title, reason))
    return added


async def take_snapshot(db: Any, user_id: str) -> dict[str, Any]:
    deals = await db.deals.find({"user_id": user_id, "status": "open"}).to_list(length=None)
    actions = await db.actions.find({"user_id": user_id, "status": {"$ne": "dismissed"}}).to_list(length=None)
    stalled = [d for d in deals if (d.get("latest") or {}).get("stalled")]
    silent = [d["latest"]["days_silent"] for d in stalled if d["latest"].get("days_silent") is not None]
    snap = {
        "user_id": user_id, "at": now_utc(),
        "total_pipeline": sum(d.get("value") or 0 for d in deals),
        "stalled_value": sum(d.get("value") or 0 for d in stalled),
        "high_risk": sum(1 for d in deals if (d.get("latest") or {}).get("risk_level") == "High"),
        "median_days_silent": statistics.median(silent) if silent else 0,
        "actions_done": sum(1 for a in actions if a["status"] == "done"),
        "actions_total": len(actions),
    }
    await db.snapshots.insert_one(dict(snap))
    return snap
