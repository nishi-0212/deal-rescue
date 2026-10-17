"""Rule-based stall detection.

Every signal carries the IDs of the records that prove it ("EML-0004", "CALL-0002", or
"CRM" for a CRM field), a weight and a category. The weights add up to a 0–100 risk
score. The AI layer explains these signals; it never invents new numbers.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from .utils import as_aware, days_between, iso_day

CUSTOMER_DEAD_OUTCOMES = {"declined", "cancelled", "no_show", "no_answer", "rescheduled", "scheduled", "pending"}
NEGATIVE_MEETING_OUTCOMES = {"declined", "cancelled", "no_show", "no_answer", "rescheduled"}

STAGES = [
    # (keywords, order, benchmark days)
    (("discovery", "qualif", "lead", "prospect"), 0, 21),
    (("demo", "evaluat", "technical", "poc", "pilot", "trial", "solution"), 1, 30),
    (("proposal", "quote", "pricing", "business case"), 2, 21),
    (("negotiat", "commit", "verbal"), 3, 21),
    (("procure", "legal", "contract", "paperwork", "closing"), 4, 30),
]

CATEGORY_LABEL = {
    "engagement": "Customer went quiet",
    "stage": "Stuck in stage too long",
    "unanswered": "Customer is waiting on us",
    "no_reply": "No reply to follow-ups",
    "followup": "Missed follow-up",
    "meeting": "Meetings declined or cancelled",
    "forecast": "Forecast doesn't match engagement",
    "close_date": "Close date at risk",
    "security": "Security review blocking",
    "pricing": "Pricing concern unresolved",
    "procurement": "Procurement blocker",
    "legal": "Legal review pending",
    "approval": "Approval not secured",
    "competitor": "Competitor in play",
    "deadline": "Hard deadline approaching",
    "stakeholders": "Missing decision-maker",
    "positive": "Recent engagement",
}

# When two signals have the same weight, the more specific one becomes the stall reason.
CATEGORY_PRIORITY = ["security", "deadline", "procurement", "legal", "approval", "pricing", "stakeholders", "unanswered",
                     "competitor", "meeting", "no_reply", "followup", "forecast", "stage", "close_date",
                     "engagement"]

TOPICS: dict[str, dict[str, Any]] = {
    "security": {"weight": 16, "terms": ["security review", "security questionnaire", "questionnaire", "soc 2", "soc2",
                                          "pen test", "penetration test", "infosec", "data residency", "gdpr",
                                          "dpia", "sso", "iso 27001", "vendor risk"]},
    "pricing": {"weight": 13, "terms": ["too expensive", "discount", "over budget", "budget is", "out of budget",
                                         "price increase", "cheaper", "cost concern", "pricing concern", "price is too",
                                         "revised pricing", "lower price", "too high"]},
    "deadline": {"weight": 12, "terms": ["spend freeze", "budget freeze", "freezing new spend", "freeze", "freezing",
                                          "unless contracts are signed", "unless signed", "hard deadline",
                                          "end of quarter", "fiscal year end"]},
    "procurement": {"weight": 11, "terms": ["procurement", "vendor form", "vendor onboarding", "purchase order",
                                             "po", "supplier form", "vendor registration", "rfp", "w-9", "w9"]},
    "legal": {"weight": 11, "terms": ["legal", "redline", "msa", "contract review", "liability", "indemnit",
                                       "terms and conditions"]},
    "approval": {"weight": 12, "terms": ["approval", "sign-off", "sign off", "signoff", "board meeting",
                                          "needs to approve", "budget holder"]},
    "competitor": {"weight": 10, "terms": ["competitor", "another vendor", "other vendors", "alternative",
                                            "evaluating other", "incumbent"]},
}
# A mention only counts as "resolved" if it says so and doesn't also say it is still blocked.
BLOCKING_CUES = ["not until", "until we", "until the", "still", "waiting", "can't", "cannot", "won't", "will not",
                 "unless", "outstanding", "pending", "any update", "no update", "missing", "blocked", "?"]
RESOLUTION_WORDS = ["resolved", "approved", "completed", "signed", "accepted", "cleared", "sent back", "submitted",
                    "agreed", "passed", "closed out", "returned", "all set", "finalized", "finalised"]

ROLE_RULES = {
    "economic_buyer": ["cfo", "ceo", "coo", "chief financial", "chief executive", "vp finance", "finance director",
                       "head of finance", "controller", "managing partner", "budget owner", "economic buyer", "founder", "president",
                       "managing director", "owner"],
    "technical_evaluator": ["cto", "ciso", "it", "it director", "it lead", "it manager", "security", "engineer",
                            "architect", "technical", "devops", "head of data", "data lead", "infrastructure"],
    "procurement": ["procurement", "purchasing", "sourcing", "legal", "counsel", "vendor management"],
    "champion": ["champion", "sponsor"],
}
ROLE_LABEL = {
    "economic_buyer": "Economic buyer (budget owner)",
    "technical_evaluator": "Technical evaluator",
    "procurement": "Procurement / legal",
    "champion": "Champion",
}
ROLE_MENTIONS = {
    "economic_buyer": ["cfo", "finance team", "budget owner", "ceo", "board"],
    "technical_evaluator": ["it team", "security team", "cto", "ciso", "engineering team"],
    "procurement": ["procurement", "legal team", "purchasing"],
}


@dataclass
class Detection:
    signals: list[dict[str, Any]] = field(default_factory=list)
    risk_score: int = 0
    risk_level: str = "Low"
    stalled: bool = False
    stall_category: str | None = None
    stall_reason: str | None = None
    confidence: float = 0.5
    days_silent: int | None = None
    days_in_stage: int | None = None
    stage_benchmark: int | None = None
    last_customer_touch: dict[str, Any] | None = None
    last_activity: dict[str, Any] | None = None
    value_at_risk: float = 0.0
    stakeholders: list[dict[str, Any]] = field(default_factory=list)
    engagement: list[dict[str, Any]] = field(default_factory=list)
    allowed_evidence: set[str] = field(default_factory=set)

    def as_dict(self) -> dict[str, Any]:
        d = {k: v for k, v in self.__dict__.items() if k != "allowed_evidence"}
        return d


def stage_info(stage: str | None) -> tuple[int, int]:
    s = (stage or "").lower()
    for words, order, bench in STAGES:
        if any(w in s for w in words):
            return order, bench
    return 1, 30


_TERM_CACHE: dict[str, re.Pattern[str]] = {}


def has_term(text: str, term: str) -> bool:
    """Whole-word, case-insensitive match ("sso" must not match "also")."""
    pat = _TERM_CACHE.get(term)
    if pat is None:
        pat = re.compile(r"(?<![a-z0-9])" + re.escape(term.strip().lower()) + r"(?![a-z0-9])")
        _TERM_CACHE[term] = pat
    return bool(pat.search(text.lower()))


def classify_role(text: str | None) -> str | None:
    if not text:
        return None
    for role, words in ROLE_RULES.items():
        if any(has_term(text, w) for w in words):
            return role
    return None


def _text(a: dict[str, Any]) -> str:
    return f"{a.get('subject') or ''}\n{a.get('body') or ''}".lower()


def _is_customer_touch(a: dict[str, Any]) -> bool:
    if a.get("direction") == "inbound":
        return True
    if a.get("type") in ("call", "meeting") and (a.get("outcome") or "completed") not in CUSTOMER_DEAD_OUTCOMES:
        return True
    return False


def _is_our_reply(a: dict[str, Any]) -> bool:
    if a.get("type") == "email" and a.get("direction") == "outbound":
        return True
    return a.get("type") in ("call", "meeting") and (a.get("outcome") or "completed") not in CUSTOMER_DEAD_OUTCOMES


def _resolves(a: dict[str, Any]) -> bool:
    t = _text(a)
    if a.get("outcome") in NEGATIVE_MEETING_OUTCOMES:
        return False
    return any(has_term(t, r) for r in RESOLUTION_WORDS) and not any(c in t for c in BLOCKING_CUES)


def _sig(code: str, category: str, weight: float, evidence: list[str], detail: str,
         label: str | None = None) -> dict[str, Any]:
    return {"code": code, "category": category, "label": label or CATEGORY_LABEL.get(category, category),
            "weight": round(weight, 1), "evidence_ids": list(dict.fromkeys(e for e in evidence if e)),
            "detail": detail, "mitigated": False}


def _severity(w: float) -> str:
    return "high" if w >= 14 else "medium" if w >= 8 else "low"


def detect(deal: dict[str, Any], activities: list[dict[str, Any]], actions: list[dict[str, Any]] | None = None,
           as_of: datetime | None = None, silence_days: int = 14) -> Detection:
    as_of = as_aware(as_of) or datetime.now().astimezone()
    acts = sorted([a for a in activities if a.get("date")], key=lambda a: as_aware(a["date"]))
    acts_past = [a for a in acts if as_aware(a["date"]) <= as_of + timedelta(hours=12)]
    det = Detection()
    det.allowed_evidence = {"CRM"} | {a["activity_id"] for a in acts if a.get("activity_id")}
    order, bench = stage_info(deal.get("stage"))
    det.stage_benchmark = bench

    # --- timing facts
    customer = [a for a in acts_past if _is_customer_touch(a)]
    last_touch = customer[-1] if customer else None
    if last_touch:
        det.last_customer_touch = {"activity_id": last_touch["activity_id"], "date": iso_day(last_touch["date"]),
                                   "type": last_touch["type"], "subject": last_touch.get("subject")}
        det.days_silent = days_between(last_touch["date"], as_of)
    else:
        ref = deal.get("last_activity_date") or deal.get("crm_created") or deal.get("created_at")
        det.days_silent = days_between(ref, as_of)
    if acts_past:
        la = acts_past[-1]
        det.last_activity = {"activity_id": la["activity_id"], "date": iso_day(la["date"]), "type": la["type"],
                             "subject": la.get("subject")}
    if deal.get("stage_entered"):
        det.days_in_stage = days_between(deal["stage_entered"], as_of)
    elif deal.get("days_in_stage_reported") is not None:
        det.days_in_stage = int(deal["days_in_stage_reported"])

    det.stakeholders = _stakeholders(deal, acts_past, as_of)
    det.engagement = _engagement(acts_past, as_of)

    if deal.get("status") in ("won", "lost"):
        det.risk_level = "Closed"
        det.confidence = 0.9
        return det

    sig: list[dict[str, Any]] = []
    tid = lambda a: a["activity_id"]  # noqa: E731

    # customer emails waiting on us (computed first: silence that is our fault is reported as "waiting on us")
    last_reply_at = None
    for a in acts_past:
        if _is_our_reply(a):
            last_reply_at = as_aware(a["date"])
    waiting = [a for a in acts_past if a.get("type") == "email" and a.get("direction") == "inbound"
               and (last_reply_at is None or as_aware(a["date"]) > last_reply_at)
               and (as_of - as_aware(a["date"])).days >= 2]
    waiting_ids = {a["activity_id"] for a in waiting}

    # 1. silence
    ds = det.days_silent
    if ds is not None and ds >= silence_days and not (last_touch and last_touch["activity_id"] in waiting_ids):
        w = 18 + min(12, (ds - silence_days) * 0.6)
        ev = [tid(last_touch)] if last_touch else ["CRM"]
        sig.append(_sig("NO_RECENT_ENGAGEMENT", "engagement", w, ev,
                        f"No reply or meeting with the customer for {ds} days."))
    elif ds is not None and ds <= 5 and last_touch is not None:
        sig.append(_sig("RECENT_ENGAGEMENT", "positive", -10, [tid(last_touch)],
                        f"The customer engaged {ds} day(s) ago."))

    # 2. stage age
    dis = det.days_in_stage
    if dis is not None and dis > bench * 1.5:
        w = 12 + min(10, (dis - bench * 1.5) / bench * 10)
        sig.append(_sig("LONG_STAGE", "stage", w, ["CRM"],
                        f"{dis} days in {deal.get('stage')}; deals usually move on within about {bench} days."))

    # 3. customer emails waiting on us
    if waiting:
        oldest = (as_of - as_aware(waiting[0]["date"])).days
        w = min(28, 13 + 5 * (len(waiting) - 1) + min(10, oldest * 0.4))
        sig.append(_sig("UNANSWERED_CUSTOMER_EMAIL", "unanswered", w, [tid(a) for a in waiting],
                        f"{len(waiting)} customer email(s) have had no reply from us, the oldest from "
                        f"{iso_day(waiting[0]['date'])}."))

    # 4. our follow-ups ignored
    after_touch = [a for a in acts_past if a.get("type") == "email" and a.get("direction") == "outbound"
                   and (last_touch is None or as_aware(a["date"]) > as_aware(last_touch["date"]))]
    if len(after_touch) >= 2:
        sig.append(_sig("NO_REPLY_TO_FOLLOWUPS", "no_reply", min(18, 8 + 3 * len(after_touch)),
                        [tid(a) for a in after_touch],
                        f"{len(after_touch)} follow-ups sent since the customer last replied, with no answer."))

    # 5. missed follow-ups
    def _followed_up(task: dict[str, Any]) -> bool:
        return any(_is_our_reply(x) and as_aware(x["date"]) > as_aware(task["date"]) for x in acts_past)

    missed = [a for a in acts if a.get("type") == "follow_up" and a.get("outcome") != "completed"
              and not _followed_up(a)
              and (a.get("outcome") == "missed" or (a.get("due_date") and as_aware(a["due_date"]) < as_of))]
    if missed:
        sig.append(_sig("MISSED_FOLLOW_UP", "followup", min(16, 9 + 3 * (len(missed) - 1)), [tid(a) for a in missed],
                        f"{len(missed)} planned follow-up(s) were missed or are overdue."))

    # 6. declined / cancelled meetings in the last 45 days
    neg = [a for a in acts_past if a.get("type") in ("call", "meeting")
           and a.get("outcome") in NEGATIVE_MEETING_OUTCOMES and (as_of - as_aware(a["date"])).days <= 45]
    if neg:
        sig.append(_sig("MEETING_DECLINED", "meeting", min(20, 12 + 4 * (len(neg) - 1)), [tid(a) for a in neg],
                        f"{len(neg)} meeting(s) or call(s) were declined, cancelled or missed by the customer."))

    # 7. forecast contradiction
    prob = deal.get("probability")
    fc = (deal.get("forecast_category") or "").lower()
    optimistic = (prob is not None and prob >= 70) or any(w in fc for w in ("commit", "best", "closing", "likely"))
    if optimistic and ((ds or 0) >= silence_days or neg or waiting):
        label = f"{prob}%" if prob is not None else deal.get("forecast_category")
        sig.append(_sig("FORECAST_MISMATCH", "forecast", 15, ["CRM"] + [tid(a) for a in neg[:2]],
                        f"CRM forecast says {label}, but the customer has gone quiet or declined meetings."))

    # 8. close date
    ec = deal.get("expected_close")
    if ec:
        days_left = (as_aware(ec) - as_of).days
        if days_left < 0:
            sig.append(_sig("CLOSE_DATE_PASSED", "close_date", 12, ["CRM"],
                            f"Expected close date {iso_day(ec)} passed {abs(days_left)} days ago and the deal is still open."))
        elif days_left <= 14 and (ds or 0) >= 10:
            sig.append(_sig("CLOSE_DATE_AT_RISK", "close_date", 8, ["CRM"],
                            f"Expected to close in {days_left} days with {ds} days of silence."))

    # 9. blockers raised in conversations
    for topic, cfg in TOPICS.items():
        mentions = [a for a in acts_past if any(has_term(_text(a), t) for t in cfg["terms"])]
        if not mentions:
            continue
        raising = [a for a in mentions if not _resolves(a)]
        if not raising or _resolves(mentions[-1]):
            continue
        first = raising[0]
        mentions = raising
        raised_by_customer = any(a.get("direction") in ("inbound", "two_way") for a in mentions)
        w = cfg["weight"] if raised_by_customer else cfg["weight"] * 0.6
        sig.append(_sig(f"BLOCKER_{topic.upper()}", topic, w, [tid(a) for a in mentions[:4]],
                        f"{CATEGORY_LABEL[topic]}: first raised {iso_day(first['date'])}, no sign it was resolved."))

    # 10. stakeholders
    have = {s["category"] for s in det.stakeholders if s.get("category") and s["status"] != "missing"}
    engaged = {s["category"] for s in det.stakeholders if s.get("status") == "engaged"}
    needs = []
    value = float(deal.get("value") or 0)
    if order >= 2 or (order >= 1 and value >= 100_000):
        needs.append(("economic_buyer", 15))
    if order >= 1:
        needs.append(("technical_evaluator", 9))
    if order >= 3:
        needs.append(("procurement", 6))
    for role, w in needs:
        mention_terms = ROLE_MENTIONS.get(role, [])
        mention_ids = [tid(a) for a in acts_past if any(has_term(_text(a), t) for t in mention_terms)][:3]
        if role not in have:
            det.stakeholders.append({"name": None, "role": ROLE_LABEL[role], "category": role,
                                     "status": "missing", "last_seen": None,
                                     "evidence_ids": mention_ids or ["CRM"]})
            sig.append(_sig(f"MISSING_{role.upper()}", "stakeholders", w, mention_ids or ["CRM"],
                            f"No {ROLE_LABEL[role].lower()} is involved in this deal yet.",
                            label=f"Missing {ROLE_LABEL[role].lower()}"))
        elif role not in engaged and role == "economic_buyer":
            sig.append(_sig("ECONOMIC_BUYER_NOT_ENGAGED", "stakeholders", w * 0.6, mention_ids or ["CRM"],
                            "The budget owner is listed but hasn't taken part recently.",
                            label="Budget owner not engaged"))

    # 11. completed recovery actions soften the signals they address
    done = [a for a in (actions or []) if a.get("status") == "done"]
    for s in sig:
        if any(s["code"] in (a.get("addresses") or []) for a in done):
            s["weight"] = round(s["weight"] * 0.4, 1)
            s["mitigated"] = True
            s["detail"] += " A recovery action for this was completed."

    for s in sig:
        s["severity"] = "positive" if s["weight"] < 0 else _severity(s["weight"])
    sig.sort(key=lambda s: (-s["weight"], CATEGORY_PRIORITY.index(s["category"])
                            if s["category"] in CATEGORY_PRIORITY else 99))
    det.signals = sig

    # Saturating curve: piling on more signals keeps raising the score without hitting a hard cap.
    total = sum(s["weight"] for s in sig)
    score = max(0, min(100, round(100 * (1 - math.exp(-total / 60))))) if total > 0 else 0
    det.risk_score = score
    det.risk_level = "High" if score >= 70 else "Medium" if score >= 40 else "Low"
    det.stalled = score >= 40 or (ds or 0) >= silence_days + 7 or any(s["code"] == "LONG_STAGE" for s in sig)
    top = [s for s in sig if s["weight"] > 0]
    if top:
        best = max(top, key=lambda s: (s["weight"], -CATEGORY_PRIORITY.index(s["category"])
                                       if s["category"] in CATEGORY_PRIORITY else -99))
        det.stall_category = best["category"]
        det.stall_reason = best["label"]
    evidence = {e for s in sig for e in s["evidence_ids"] if e != "CRM"}
    if not acts:
        det.confidence = 0.4
    else:
        det.confidence = round(min(0.95, 0.45 + 0.07 * min(len(evidence), 6) + (0.05 if len(acts) >= 5 else 0)), 2)
    det.value_at_risk = round(value * score / 100)
    return det


def _stakeholders(deal: dict[str, Any], acts: list[dict[str, Any]], as_of: datetime) -> list[dict[str, Any]]:
    out = []
    for c in deal.get("contacts") or []:
        name, mail = c.get("name"), c.get("email")
        seen = None
        seen_id = None
        for a in acts:
            if a.get("direction") == "inbound":
                blob = str(a.get("from_") or "")
            elif a.get("type") in ("call", "meeting") and _is_customer_touch(a):
                blob = " ".join(str(a.get(k) or "") for k in ("from_", "to", "participants"))
            else:
                continue
            if _person_match_any(blob, name, mail):
                seen, seen_id = a["date"], a["activity_id"]
        days = days_between(seen, as_of) if seen else None
        status = "engaged" if days is not None and days <= 14 else "quiet" if days is not None else "never"
        out.append({"name": name, "role": c.get("role"), "email": mail,
                    "category": classify_role(c.get("role")) or "contact",
                    "status": status, "last_seen": iso_day(seen), "evidence_ids": [seen_id] if seen_id else []})
    return out


def _person_match_any(blob: str, name: str | None, mail: str | None) -> bool:
    b = blob.lower()
    if mail and mail.lower() in b:
        return True
    if name:
        parts = [p for p in re.findall(r"[a-z]+", name.lower()) if len(p) > 1]
        if parts and all(re.search(rf"\b{re.escape(p)}\b", b) for p in parts):
            return True
    return False


def _engagement(acts: list[dict[str, Any]], as_of: datetime, weeks: int = 10) -> list[dict[str, Any]]:
    start = (as_of - timedelta(days=as_of.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    buckets = []
    for i in range(weeks - 1, -1, -1):
        ws = start - timedelta(weeks=i)
        we = ws + timedelta(weeks=1)
        wk = [a for a in acts if ws <= as_aware(a["date"]) < we]
        buckets.append({
            "week_start": ws.date().isoformat(),
            "customer": sum(1 for a in wk if _is_customer_touch(a)),
            "ours": sum(1 for a in wk if a.get("direction") == "outbound"),
        })
    return buckets
