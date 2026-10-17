"""Prompt builders for the diagnosis and email-draft calls. Pure functions."""
from __future__ import annotations

import json
from typing import Any

from .detection import Detection
from .utils import iso_day

DIAGNOSIS_SYSTEM = """You are a senior sales operations analyst. You diagnose why a B2B deal has stalled and \
write a recovery plan a sales rep can act on today.

Rules you must follow:
- Use ONLY the deal facts, signals and activity records provided. Never invent people, dates, numbers or events.
- Every root cause and objection must cite evidence_ids taken from the activity IDs provided (e.g. "EML-0004") \
or "CRM" for CRM fields. Findings without evidence will be discarded.
- If the evidence only suggests something, set status "possible" or "likely", not "confirmed".
- Write plainly and briefly, the way a good sales manager talks. No jargon, no filler.
- Recovery plan: 2 to 5 concrete actions, most important first. Each action says who does it, when, and why.
- action_type must be one of: contact_customer, involve_decision_maker, technical_meeting, security_questionnaire, \
revise_pricing, escalate_internally, update_forecast, procurement_help, other.
- "addresses" lists the signal codes the action resolves.
- Respond with a single JSON object and nothing else."""

DIAGNOSIS_SHAPE = {
    "summary": "2-3 sentences: what the deal is, where it is, why it is stuck",
    "stage_assessment": "1 sentence on whether the current stage is accurate",
    "root_causes": [{"title": "short", "explanation": "1-2 sentences", "category": "security|pricing|...",
                     "status": "confirmed|likely|possible", "confidence": 0.8, "evidence_ids": ["EML-0004"]}],
    "unresolved_objections": [{"objection": "text", "raised_by": "name or role", "evidence_ids": ["CALL-0002"]}],
    "missing_stakeholders": [{"role": "Economic buyer", "why_needed": "text", "evidence_ids": ["CRM"]}],
    "last_meaningful_interaction": {"activity_id": "EML-0007", "summary": "1 sentence"},
    "recommended_next_action": "the single most important next step",
    "recovery_plan": [{"title": "imperative action", "action_type": "contact_customer", "owner": "name or role",
                       "due_in_days": 2, "expected_outcome": "text", "why": "1-2 sentences",
                       "priority": "P1|P2|P3", "evidence_ids": ["EML-0004"], "addresses": ["BLOCKER_SECURITY"]}],
}

DRAFT_SYSTEM = """You write short, warm, specific sales emails for a B2B rep. You use only facts from the \
deal history provided and never promise things that aren't in it. Keep it under 150 words, plain text, \
no subject-line clichés, no exclamation marks. Sign off with the rep's first name. \
Respond with a single JSON object: {"subject": str, "body": str, "to_name": str|null, "to_email": str|null, \
"evidence_ids": [ids of the records you relied on]}."""

DRAFT_GOALS = {
    "follow_up": "Restart a quiet conversation with a specific, useful reason to reply.",
    "objection_handling": "Address the customer's main open objection directly and propose how to close it.",
    "meeting_request": "Ask for a short meeting with a clear agenda tied to what is blocking the deal.",
    "procurement_escalation": "Find out exactly what procurement/legal still needs and who owns it, and offer help.",
    "decision_maker_outreach": "Reach the budget owner (or ask the champion for an introduction) with a crisp business reason.",
}


def _activity_lines(activities: list[dict[str, Any]], limit: int = 40, body_chars: int = 600) -> list[dict[str, Any]]:
    rows = []
    for a in activities[-limit:]:
        rows.append({
            "id": a["activity_id"], "date": iso_day(a["date"]), "type": a["type"], "direction": a.get("direction"),
            "from": a.get("from_"), "to": a.get("to"), "subject": a.get("subject"), "outcome": a.get("outcome"),
            "text": (a.get("body") or "")[:body_chars],
        })
    return rows


def deal_facts(deal: dict[str, Any]) -> dict[str, Any]:
    return {
        "deal_id": deal["deal_id"], "name": deal.get("name"), "account": deal.get("account"),
        "value": deal.get("value"), "currency": deal.get("currency"), "stage": deal.get("stage"),
        "owner": deal.get("owner"), "expected_close": iso_day(deal.get("expected_close")),
        "crm_probability": deal.get("probability"), "forecast_category": deal.get("forecast_category"),
        "contacts": deal.get("contacts") or [],
    }


def diagnosis_messages(deal: dict[str, Any], det: Detection, activities: list[dict[str, Any]],
                       done_actions: list[dict[str, Any]]) -> list[dict[str, str]]:
    payload = {
        "deal": deal_facts(deal),
        "computed": {
            "risk_score": det.risk_score, "risk_level": det.risk_level, "days_since_customer_contact": det.days_silent,
            "days_in_stage": det.days_in_stage, "typical_days_in_stage": det.stage_benchmark,
        },
        "signals": [{"code": s["code"], "label": s["label"], "detail": s["detail"], "weight": s["weight"],
                     "evidence_ids": s["evidence_ids"], "already_being_fixed": s["mitigated"]} for s in det.signals],
        "stakeholders": det.stakeholders,
        "completed_recovery_actions": [{"title": a["title"], "completed": iso_day(a.get("completed_at"))}
                                       for a in done_actions],
        "activities_oldest_first": _activity_lines(activities),
    }
    user = ("Diagnose this deal. Return JSON with exactly this shape:\n" + json.dumps(DIAGNOSIS_SHAPE) +
            "\n\nDATA:\n" + json.dumps(payload, default=str))
    return [{"role": "system", "content": DIAGNOSIS_SYSTEM}, {"role": "user", "content": user}]


def draft_messages(kind: str, deal: dict[str, Any], diagnosis: dict[str, Any] | None,
                   activities: list[dict[str, Any]], contact: dict[str, Any] | None,
                   action: dict[str, Any] | None = None, reply_to: dict[str, Any] | None = None) -> list[dict[str, str]]:
    payload = {
        "goal": DRAFT_GOALS[kind], "email_type": kind, "deal": deal_facts(deal),
        "recovery_action_this_email_carries_out": ({"title": action.get("title"), "why": action.get("why"),
                                                     "expected_outcome": action.get("expected_outcome")}
                                                    if action else None),
        "reply_to_this_customer_email": (_activity_lines([reply_to], limit=1, body_chars=1500)[0] if reply_to else None),
        "recipient": contact, "rep_name": deal.get("owner"),
        "diagnosis": {k: (diagnosis or {}).get(k) for k in ("summary", "root_causes", "unresolved_objections",
                                                            "recommended_next_action")},
        "recent_activities": _activity_lines(activities, limit=12, body_chars=500),
    }
    return [{"role": "system", "content": DRAFT_SYSTEM},
            {"role": "user", "content": json.dumps(payload, default=str)}]
