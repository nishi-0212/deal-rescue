"""Request/response models for the HTTP API."""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

ActionStatus = Literal["open", "in_progress", "done", "dismissed"]
DraftType = Literal[
    "follow_up", "objection_handling", "meeting_request", "procurement_escalation", "decision_maker_outreach"
]


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(max_length=254)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not EMAIL_RE.match(v):
            raise ValueError("Enter a valid email address")
        return v

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name is required")
        return v


class LoginIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return v.strip().lower()


class UserOut(BaseModel):
    id: str
    name: str
    email: str


class AuthOut(BaseModel):
    token: str
    user: UserOut


class ActionUpdate(BaseModel):
    status: ActionStatus | None = None
    owner: str | None = Field(default=None, max_length=80)
    due_date: str | None = Field(default=None, max_length=10)
    note: str | None = Field(default=None, max_length=500)

    @field_validator("due_date")
    @classmethod
    def _date(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            raise ValueError("Use YYYY-MM-DD")
        return v


class DraftCreate(BaseModel):
    type: DraftType
    contact_email: str | None = Field(default=None, max_length=254)
    action_id: str | None = Field(default=None, max_length=24)


class DraftUpdate(BaseModel):
    subject: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=8000)
    to_name: str | None = Field(default=None, max_length=120)
    to_email: str | None = Field(default=None, max_length=254)


class DraftSend(BaseModel):
    confirm: bool = False


class ReanalyzeIn(BaseModel):
    deal_ids: list[str] | None = Field(default=None, max_length=500)
    force: bool = True
    pending_only: bool = False  # only deals with changes the latest analysis hasn't seen
