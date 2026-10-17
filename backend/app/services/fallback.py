"""Rule-based diagnosis, recovery plan and email drafts.

Used when no LLM key is configured or the LLM call fails, so every workflow works offline.
Output uses the same models as the AI path, so the rest of the app can't tell the difference
(apart from the `source` field shown in the UI).
"""
from __future__ import annotations

from typing import Any

from .ai_schemas import Diagnosis, EmailDraft, LastInteraction, MissingStakeholder, Objection, PlanItem, RootCause
from .detection import ROLE_LABEL, Detection

PLAN = {
    "UNANSWERED_CUSTOMER_EMAIL": ("Reply to the customer's open question", "contact_customer", "{owner}", 1, "P1",
                                  "The customer gets an answer and the conversation restarts",
                                  "The customer is waiting on us. Every day without a reply makes the deal colder."),
    "BLOCKER_SECURITY": ("Complete and send back the security questionnaire", "security_questionnaire",
                         "Solutions engineer", 3, "P1", "Their security review can restart",
                         "Security review is an open blocker that only we can clear."),
    "BLOCKER_PRICING": ("Prepare a revised pricing option", "revise_pricing", "Deal desk", 3, "P1",
                        "A price the customer can take to their budget owner",
                        "A pricing concern was raised and hasn't been answered."),
    "BLOCKER_PROCUREMENT": ("Finish the procurement paperwork and confirm next steps", "procurement_help", "{owner}", 3,
                            "P1", "Vendor setup completed and a date for the PO",
                            "Procurement steps are pending and can quietly add weeks."),
    "BLOCKER_LEGAL": ("Get legal to turn around the contract comments", "escalate_internally", "Legal", 4, "P2",
                      "Contract comments resolved so signature can be scheduled",
                      "Contract review is open with no recent progress."),
    "BLOCKER_APPROVAL": ("Ask the champion what the approval path looks like", "contact_customer", "{owner}", 2, "P1",
                         "A named approver and a date for the decision",
                         "The deal needs an approval nobody has secured yet."),
    "BLOCKER_DEADLINE": ("Agree a signing plan that beats their deadline", "contact_customer", "{owner}", 1, "P1",
                         "A dated plan to signature before the deadline",
                         "The customer has a hard deadline; missing it likely pushes the deal out."),
    "BLOCKER_COMPETITOR": ("Send a short comparison and ask for their decision timeline", "contact_customer", "{owner}",
                           3, "P2", "Clear decision criteria and timeline",
                           "Another vendor is being considered."),
    "MISSING_ECONOMIC_BUYER": ("Ask the champion to introduce the budget owner", "involve_decision_maker", "{owner}", 3,
                               "P1", "A meeting with the person who signs off the budget",
                               "No one who can approve the spend is involved yet."),
    "ECONOMIC_BUYER_NOT_ENGAGED": ("Re-engage the budget owner with a short business case", "involve_decision_maker",
                                   "{owner}", 4, "P1", "Budget owner confirms priority and timing",
                                   "The budget owner hasn't been part of recent conversations."),
    "MISSING_TECHNICAL_EVALUATOR": ("Set up a technical session with their IT or security lead", "technical_meeting",
                                    "Solutions engineer", 5, "P2", "Technical questions answered by the right person",
                                    "Nobody technical on their side has evaluated the product."),
    "MISSING_PROCUREMENT": ("Find out who runs procurement and what they need", "contact_customer", "{owner}", 5, "P3",
                            "Procurement contact and checklist known early",
                            "Late-stage deals stall when procurement appears at the last minute."),
    "MEETING_DECLINED": ("Re-book the meeting with a shorter, specific agenda", "contact_customer", "{owner}", 2, "P2",
                         "A confirmed meeting on the calendar",
                         "The customer declined or missed the last meeting."),
    "NO_REPLY_TO_FOLLOWUPS": ("Try a different contact or channel", "contact_customer", "{owner}", 2, "P2",
                              "A reply from anyone on the customer side",
                              "Several follow-ups to the same person have gone unanswered."),
    "MISSED_FOLLOW_UP": ("Do the missed follow-up today", "contact_customer", "{owner}", 0, "P1",
                         "The promised follow-up is delivered",
                         "We promised a follow-up and didn't do it."),
    "NO_RECENT_ENGAGEMENT": ("Re-engage with a specific, useful reason to talk", "contact_customer", "{owner}", 2, "P2",
                             "A reply and a next step agreed",
                             "The customer has been silent for a long time."),
    "LONG_STAGE": ("Review the deal with your manager and agree a dated plan", "escalate_internally", "Sales manager", 5,
                   "P3", "A clear go / no-go and a mutual plan",
                   "The deal has been in this stage much longer than usual."),
    "FORECAST_MISMATCH": ("Move the forecast down until the customer re-engages", "update_forecast", "Sales manager", 1,
                          "P2", "A forecast that matches what the customer is doing",
                          "The CRM forecast is more optimistic than the customer's behaviour."),
    "CLOSE_DATE_PASSED": ("Agree a new close date with the customer", "update_forecast", "{owner}", 2, "P2",
                          "A realistic close date in the CRM", "The expected close date has passed."),
    "CLOSE_DATE_AT_RISK": ("Confirm the close date is still realistic", "contact_customer", "{owner}", 2, "P2",
                           "Close date confirmed or moved", "The close date is close and the deal has gone quiet."),
}

OBJECTION_TEXT = {
    "security": "Security / compliance requirements are still open",
    "pricing": "Pricing or budget concern hasn't been answered",
    "procurement": "Procurement paperwork is outstanding",
    "legal": "Contract terms are still being reviewed",
    "approval": "Internal approval hasn't been secured",
    "competitor": "They are also looking at other vendors",
}

ROLE_WHY = {
    "economic_buyer": "Someone with budget authority has to approve a deal of this size.",
    "technical_evaluator": "A technical owner has to confirm the product fits their systems.",
    "procurement": "Procurement or legal will need to sign off before the contract is signed.",
}


def _first_name(name: str | None) -> str:
    return (name or "").split()[0] if name else "there"


def _money(v: float | None, cur: str = "USD") -> str:
    v = float(v or 0)
    sym = {"USD": "$", "EUR": "€", "GBP": "£", "INR": "₹"}.get(cur, "")
    if v >= 1_000_000:
        return f"{sym}{v / 1_000_000:.2f}M"
    if v >= 1_000:
        return f"{sym}{v / 1_000:.0f}k"
    return f"{sym}{v:.0f}"


def diagnose(deal: dict[str, Any], det: Detection, activities: list[dict[str, Any]]) -> Diagnosis:
    owner = deal.get("owner") or "Deal owner"
    neg = [s for s in det.signals if s["weight"] > 0]
    causes = []
    for s in neg[:4]:
        has_records = any(e != "CRM" for e in s["evidence_ids"])
        status = "confirmed" if has_records and s["weight"] >= 12 else "likely" if s["weight"] >= 9 else "possible"
        causes.append(RootCause(title=s["label"], explanation=s["detail"], category=s["category"], status=status,
                                confidence=round(min(0.95, 0.45 + s["weight"] / 40), 2),
                                evidence_ids=s["evidence_ids"]))
    objections = [Objection(objection=OBJECTION_TEXT[s["category"]], raised_by="customer",
                            evidence_ids=s["evidence_ids"]) for s in neg if s["category"] in OBJECTION_TEXT]
    missing = [MissingStakeholder(role=ROLE_LABEL.get(st["category"], st["role"]),
                                  why_needed=ROLE_WHY.get(st["category"], "Needed to move the deal forward."),
                                  evidence_ids=st.get("evidence_ids") or ["CRM"])
               for st in det.stakeholders if st["status"] == "missing"]
    lt = det.last_customer_touch or det.last_activity
    last = LastInteraction(
        activity_id=lt["activity_id"] if lt else None,
        summary=(f"{lt['type'].replace('_', ' ').capitalize()} on {lt['date']}: {lt.get('subject') or 'no subject'}"
                 if lt else "No customer interaction on record."),
    )
    plan: list[PlanItem] = []
    seen = set()
    for s in neg:
        tpl = PLAN.get(s["code"])
        if not tpl or tpl[0] in seen or s.get("mitigated"):
            continue
        seen.add(tpl[0])
        title, kind, who, due, prio, outcome, why = tpl
        plan.append(PlanItem(title=title, action_type=kind, owner=who.format(owner=owner), due_in_days=due,
                             priority=prio, expected_outcome=outcome, why=f"{why} {s['detail']}",
                             evidence_ids=s["evidence_ids"], addresses=[s["code"]]))
        if s["code"] == "BLOCKER_SECURITY":
            plan.append(PlanItem(title="Offer a short call with their security team", action_type="technical_meeting",
                                 owner="Solutions engineer", due_in_days=5, priority="P2",
                                 expected_outcome="Open security questions closed live",
                                 why="A call usually clears the last questions faster than email.",
                                 evidence_ids=s["evidence_ids"], addresses=[s["code"]]))
        if len(plan) >= 5:
            break
    plan.sort(key=lambda p: (p.priority, p.due_in_days))
    reasons = ", ".join(s["label"].lower() for s in neg[:3]) or "no strong warning signs"
    silent = f"Last customer contact was {det.days_silent} days ago." if det.days_silent is not None else ""
    summary = (f"{deal.get('name')} with {deal.get('account')} is in {deal.get('stage')} at "
               f"{_money(deal.get('value'), deal.get('currency') or 'USD')}. Main issues: {reasons}. {silent}").strip()
    stage_txt = ""
    if det.days_in_stage is not None:
        stage_txt = (f"{det.days_in_stage} days in {deal.get('stage')} (typical: about {det.stage_benchmark}).")
    return Diagnosis(
        summary=summary, stage_assessment=stage_txt, root_causes=causes, unresolved_objections=objections,
        missing_stakeholders=missing, last_meaningful_interaction=last,
        recommended_next_action=plan[0].title if plan else "Keep the current plan and check in next week.",
        recovery_plan=plan,
    )


def pick_contact(deal: dict[str, Any], kind: str, stakeholders: list[dict[str, Any]],
                 email: str | None = None) -> dict[str, Any] | None:
    contacts = deal.get("contacts") or []
    if email:
        for c in contacts:
            if (c.get("email") or "").lower() == email.lower():
                return c
    by_cat = {}
    for st in stakeholders:
        if st.get("name"):
            by_cat.setdefault(st["category"], st)
    if kind == "decision_maker_outreach" and "economic_buyer" in by_cat:
        return by_cat["economic_buyer"]
    if kind == "procurement_escalation" and "procurement" in by_cat:
        return by_cat["procurement"]
    if kind == "decision_maker_outreach":
        # No budget owner known: ask the business champion (not IT or procurement) for an introduction
        business = [st for st in stakeholders if st.get("name") and st.get("category") in ("champion", "contact")]
        if business:
            return max(business, key=lambda st: st.get("last_seen") or "")
    engaged = [st for st in stakeholders if st.get("name") and st.get("status") in ("engaged", "quiet")]
    if engaged:
        return max(engaged, key=lambda st: st.get("last_seen") or "")
    return contacts[0] if contacts else None


def _clean_subject(s: str | None) -> str:
    import re
    return re.sub(r"^(re|fw|fwd)\s*:\s*", "", (s or "").strip(), flags=re.I) or "your last message"


def draft(kind: str, deal: dict[str, Any], diag: dict[str, Any] | None, det_stakeholders: list[dict[str, Any]],
          contact_email: str | None = None, reply_to: dict[str, Any] | None = None,
          action: dict[str, Any] | None = None) -> EmailDraft:
    """`reply_to`: the customer email this draft answers. `action`: the recovery action it carries out."""
    if reply_to and not contact_email:
        sender = (reply_to.get("from_") or "").lower()
        for ct in deal.get("contacts") or []:
            if ct.get("email") and ct["email"].lower() in sender:
                contact_email = ct["email"]
    c = pick_contact(deal, kind, det_stakeholders, contact_email)
    to_name = c.get("name") if c else None
    hi = _first_name(to_name)
    me = _first_name(deal.get("owner"))
    diag = diag or {}
    causes = diag.get("root_causes") or []
    objections = diag.get("unresolved_objections") or []
    last = (diag.get("last_meaningful_interaction") or {}).get("summary") or ""
    ev = []
    for x in causes[:2]:
        ev += x.get("evidence_ids", [])
    name, acct = deal.get("name"), deal.get("account")
    if kind == "follow_up" and reply_to:
        topic = _clean_subject(reply_to.get("subject"))
        when = reply_to["date"].strftime("%b %d").replace(" 0", " ") if reply_to.get("date") else "recently"
        subject = f"Re: {topic}"
        body = (f"Hi {hi},\n\nThank you for your note on {when} about {topic.lower()}, and sorry for the slow reply.\n\n"
                f"[Answer their question here: what's done, what's left, and when they'll have it.]\n\n"
                f"So this doesn't hold up your timeline, could we take 20 minutes this week to close out anything "
                f"still open?\n\nBest,\n{me}")
        ev = [reply_to["activity_id"]] + ev
    elif kind == "follow_up":
        lt = diag.get("last_meaningful_interaction") or {}
        topic = last.split(": ", 1)[-1] if last else ""
        subject = f"Next steps on {name}"
        body = (f"Hi {hi},\n\nI wanted to pick up where we left off on {name}"
                f"{(' after our last conversation about ' + _clean_subject(topic).lower()) if topic else ''}. "
                f"Is there anything on your side we can help move along this week?\n\n"
                f"If it's easier, I can send over a short summary of what's open and who owns each item.\n\nBest,\n{me}")
        if lt.get("activity_id"):
            ev = [lt["activity_id"]] + ev
    elif kind == "objection_handling":
        topic = objections[0]["objection"] if objections else "the open questions"
        if action and action.get("action_type") == "revise_pricing":
            topic = "pricing"
        ev = objections[0].get("evidence_ids", []) if objections else ev
        subject = f"Re: {topic}"
        body = (f"Hi {hi},\n\nThanks for raising this. On {topic.lower()}: here's where things stand and what we "
                f"propose.\n\n• What we've done so far: [add specifics]\n• What we suggest next: [add proposal]\n\n"
                f"Would a 20-minute call help close this out?\n\nBest,\n{me}")
    elif kind == "meeting_request":
        subject = f"30 minutes to unblock {name}?"
        focus = causes[0]["title"].lower() if causes else "the open items"
        if action and action.get("action_type") == "technical_meeting":
            subject = f"Technical session for {name}?"
            focus = "the technical and security questions with your team"
        body = (f"Hi {hi},\n\nCould we find 30 minutes this week? I'd like to work through {focus} together so "
                f"it doesn't hold up your timeline.\n\nI'm free Tuesday or Thursday afternoon. If neither works, "
                f"send me a time that does.\n\nBest,\n{me}")
    elif kind == "procurement_escalation":
        subject = f"Paperwork for {acct}: what's still needed?"
        body = (f"Hi {hi},\n\nWe're keen to get {name} set up on your side. Could you tell me which procurement "
                f"or vendor forms are still outstanding and who on your team owns them?\n\nWe can turn our part "
                f"around within a day.\n\nBest,\n{me}")
    elif not any(st.get("category") == "economic_buyer" and st.get("name") for st in det_stakeholders):
        # No budget owner known yet: ask the champion for an introduction
        subject = f"Who should we involve on the {acct} side?"
        body = (f"Hi {hi},\n\nThanks for championing {name} internally. For a decision of this size, I'd like to make "
                f"sure the person who owns the budget has what they need. Would you be open to introducing us, or "
                f"letting me know who that is?\n\nI can prepare a one-page business case so it's quick for them to "
                f"review.\n\nBest,\n{me}")
    else:  # decision_maker_outreach
        subject = f"{name}: the business case in one page"
        body = (f"Hi {hi},\n\nI've been working with your team on {name}. Before we go further, I'd value five "
                f"minutes of your view on priorities and timing, since a decision of this size sits with you.\n\n"
                f"I've put the business case on one page and can walk you through it whenever suits.\n\nBest,\n{me}")
    return EmailDraft(subject=subject, body=body, to_name=to_name, to_email=c.get("email") if c else None,
                      evidence_ids=list(dict.fromkeys(ev))[:4])
