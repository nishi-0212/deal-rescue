"""Structured AI output contracts and the grounding check.

The LLM must answer with JSON matching these models. After validation, `ground()` removes
any evidence ID that does not exist in the deal's records and drops findings that are left
with no evidence, so nothing reaches the user without a source.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

ActionType = Literal[
    "contact_customer", "involve_decision_maker", "technical_meeting", "security_questionnaire",
    "revise_pricing", "escalate_internally", "update_forecast", "procurement_help", "other",
]
DraftKind = Literal[
    "follow_up", "objection_handling", "meeting_request", "procurement_escalation", "decision_maker_outreach",
]


def _clip(v: str, n: int) -> str:
    return (v or "").strip()[:n]


class RootCause(BaseModel):
    title: str
    explanation: str
    category: str = "other"
    status: Literal["confirmed", "likely", "possible"] = "likely"
    confidence: float = Field(default=0.6, ge=0, le=1)
    evidence_ids: list[str] = Field(default_factory=list)

    @field_validator("title")
    @classmethod
    def _t(cls, v: str) -> str:
        return _clip(v, 140)

    @field_validator("explanation")
    @classmethod
    def _e(cls, v: str) -> str:
        return _clip(v, 700)


class Objection(BaseModel):
    objection: str
    raised_by: str | None = None
    evidence_ids: list[str] = Field(default_factory=list)


class MissingStakeholder(BaseModel):
    role: str
    why_needed: str
    evidence_ids: list[str] = Field(default_factory=list)


class LastInteraction(BaseModel):
    activity_id: str | None = None
    summary: str = ""


class PlanItem(BaseModel):
    title: str
    action_type: ActionType = "other"
    owner: str = "Deal owner"
    due_in_days: int = Field(default=3, ge=0, le=60)
    expected_outcome: str = ""
    why: str = ""
    priority: Literal["P1", "P2", "P3"] = "P2"
    evidence_ids: list[str] = Field(default_factory=list)
    addresses: list[str] = Field(default_factory=list)

    @field_validator("title")
    @classmethod
    def _t(cls, v: str) -> str:
        return _clip(v, 160)


class Diagnosis(BaseModel):
    summary: str
    stage_assessment: str = ""
    root_causes: list[RootCause] = Field(default_factory=list, max_length=6)
    unresolved_objections: list[Objection] = Field(default_factory=list, max_length=8)
    missing_stakeholders: list[MissingStakeholder] = Field(default_factory=list, max_length=6)
    last_meaningful_interaction: LastInteraction = Field(default_factory=LastInteraction)
    recommended_next_action: str = ""
    recovery_plan: list[PlanItem] = Field(default_factory=list, max_length=8)


class EmailDraft(BaseModel):
    subject: str
    body: str
    to_name: str | None = None
    to_email: str | None = None
    evidence_ids: list[str] = Field(default_factory=list)


def _keep(ids: list[str], allowed: set[str]) -> list[str]:
    lookup = {a.upper(): a for a in allowed}
    out = []
    for i in ids or []:
        key = str(i).strip().upper()
        if key in lookup and lookup[key] not in out:
            out.append(lookup[key])
    return out


def ground(diag: Diagnosis, allowed: set[str], signal_codes: set[str]) -> tuple[Diagnosis, list[str]]:
    """Drop unknown evidence IDs and any finding left without evidence. Returns notes on what was removed."""
    notes: list[str] = []
    causes = []
    for c in diag.root_causes:
        c.evidence_ids = _keep(c.evidence_ids, allowed)
        if c.evidence_ids:
            causes.append(c)
        else:
            notes.append(f"Removed unsupported finding: {c.title}")
    diag.root_causes = causes
    objs = []
    for o in diag.unresolved_objections:
        o.evidence_ids = _keep(o.evidence_ids, allowed)
        if o.evidence_ids:
            objs.append(o)
        else:
            notes.append(f"Removed unsupported objection: {o.objection[:60]}")
    diag.unresolved_objections = objs
    for m in diag.missing_stakeholders:
        m.evidence_ids = _keep(m.evidence_ids, allowed) or ["CRM"]
    for p in diag.recovery_plan:
        p.evidence_ids = _keep(p.evidence_ids, allowed)
        p.addresses = [a for a in p.addresses if a in signal_codes]
    lmi = diag.last_meaningful_interaction
    if lmi.activity_id and not _keep([lmi.activity_id], allowed):
        notes.append(f"Ignored unknown activity id {lmi.activity_id}")
        lmi.activity_id = None
    return diag, notes
