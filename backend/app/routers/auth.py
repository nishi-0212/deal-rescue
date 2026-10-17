from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pymongo.errors import DuplicateKeyError

from ..db import get_db
from ..deps import current_user
from ..schemas import AuthOut, LoginIn, RegisterIn, UserOut
from ..security import create_token, hash_password, login_throttle, verify_password
from ..services.utils import now_utc

router = APIRouter(prefix="/api/auth", tags=["auth"])
log = logging.getLogger("deal_rescue.auth")


def _user_out(u: dict[str, Any]) -> UserOut:
    return UserOut(id=str(u["_id"]), name=u["name"], email=u["email"])


@router.post("/register", response_model=AuthOut, status_code=201)
async def register(body: RegisterIn) -> AuthOut:
    db = get_db()
    if await db.users.find_one({"email": body.email}):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    doc = {"name": body.name, "email": body.email, "password_hash": hash_password(body.password),
           "created_at": now_utc()}
    try:
        res = await db.users.insert_one(doc)
    except DuplicateKeyError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists") from exc
    doc["_id"] = res.inserted_id
    log.info("New account %s", body.email)
    return AuthOut(token=create_token(str(res.inserted_id)), user=_user_out(doc))


@router.post("/login", response_model=AuthOut)
async def login(body: LoginIn) -> AuthOut:
    if login_throttle.blocked(body.email):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts. Try again in 15 minutes.")
    user = await get_db().users.find_one({"email": body.email})
    if not user or not verify_password(body.password, user["password_hash"]):
        login_throttle.fail(body.email)
        log.info("Failed login for %s", body.email)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email or password is incorrect")
    login_throttle.reset(body.email)
    return AuthOut(token=create_token(str(user["_id"])), user=_user_out(user))


@router.get("/me", response_model=UserOut)
async def me(user: dict = Depends(current_user)) -> UserOut:
    return _user_out(user)
