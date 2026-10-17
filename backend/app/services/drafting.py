"""Create AI (or template) email drafts for a deal."""
from __future__ import annotations

import logging
from typing import Any

from ..config import get_settings
from . import fallback
from .ai_schemas import EmailDraft
from .llm import LLMError, complete_json
from .prompts import draft_messages
from .utils import now_utc

log = logging.getLogger("deal_rescue.drafts")


def _reply_target(acts: list[dict[str, Any]], action: dict[str, Any] | None) -> dict[str, Any] | None:
    """The latest customer email this action is about (so the draft is a reply to it)."""
    if not action:
        return None
    ids = set(action.get("evidence_ids") or [])
    inbound = [a for a in acts if a["activity_id"] in ids and a.get("type") == "email" and a.get("direction") == "inbound"]
    return inbound[-1] if inbound else None


async def create_draft(db: Any, user_id: str, deal: dict[str, Any], kind: str,
                       contact_email: str | None = None, action: dict[str, Any] | None = None) -> dict[str, Any]:
    settings = get_settings()
    analysis = await db.analyses.find_one({"user_id": user_id, "deal_id": deal["deal_id"]}, sort=[("version", -1)])
    diag = (analysis or {}).get("diagnosis")
    stakeholders = (analysis or {}).get("stakeholders") or []
    acts = await db.activities.find({"user_id": user_id, "deal_id": deal["deal_id"]}).sort("date", 1).to_list(length=None)
    allowed = {"CRM"} | {a["activity_id"] for a in acts}
    reply_to = _reply_target(acts, action)
    if reply_to and not contact_email:
        for ct in deal.get("contacts") or []:
            if ct.get("email") and ct["email"].lower() in (reply_to.get("from_") or "").lower():
                contact_email = ct["email"]
    contact = fallback.pick_contact(deal, kind, stakeholders, contact_email)
    source, draft = "rules", None
    if settings.llm_enabled:
        try:
            draft = await complete_json(draft_messages(kind, deal, diag, acts, contact, action, reply_to), EmailDraft,
                                        max_tokens=900)
            source = "ai"
        except LLMError as exc:
            log.warning("Draft fell back to template: %s", exc)
    if draft is None:
        draft = fallback.draft(kind, deal, diag, stakeholders, contact_email, reply_to=reply_to, action=action)
    if contact and not draft.to_email:
        draft.to_email = contact.get("email")
        draft.to_name = draft.to_name or contact.get("name")
    draft.evidence_ids = [e for e in draft.evidence_ids if e in allowed]
    now = now_utc()
    doc = {
        "user_id": user_id, "deal_id": deal["deal_id"], "type": kind, "status": "draft", "source": source,
        "to_name": draft.to_name, "to_email": draft.to_email, "subject": draft.subject.strip()[:200],
        "body": draft.body.strip()[:8000], "evidence_ids": draft.evidence_ids,
        "analysis_version": (analysis or {}).get("version"), "created_at": now, "updated_at": now,
        "action_id": str(action["_id"]) if action else None, "action_title": action["title"] if action else None,
        "approved_at": None, "sent_at": None,
    }
    res = await db.drafts.insert_one(doc)
    doc["_id"] = res.inserted_id
    return doc
