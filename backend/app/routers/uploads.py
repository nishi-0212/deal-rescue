from __future__ import annotations

import logging
import re
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from ..config import get_settings
from ..db import get_db
from ..deps import workspace
from ..serialize import clean
from ..services.importer import import_file
from ..services.ingest import ALLOWED_EXT, UploadError, extension
from ..services.jobs import runner
from ..services.pipelines import touch

router = APIRouter(prefix="/api/uploads", tags=["uploads"])
log = logging.getLogger("deal_rescue.uploads")


def safe_name(name: str | None) -> str:
    base = (name or "upload").replace("\\", "/").split("/")[-1]
    base = re.sub(r"[^A-Za-z0-9._ -]+", "_", base).strip(" .") or "upload"
    return base[:120]


async def read_limited(file: UploadFile, limit: int) -> bytes:
    chunks, size = [], 0
    while True:
        chunk = await file.read(1024 * 256)
        if not chunk:
            break
        size += len(chunk)
        if size > limit:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                                f"File is larger than {limit // (1024 * 1024)} MB")
        chunks.append(chunk)
    return b"".join(chunks)


async def process_upload(user: dict[str, Any], filename: str, content: bytes, kind: str | None = None,
                         shift_days: int = 0) -> dict[str, Any]:
    db = get_db()
    try:
        upload, affected = await import_file(db, user["id"], filename, content, kind, shift_days)
    except UploadError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    stem = re.sub(r"[_\-.]+", " ", filename.rsplit(".", 1)[0]).strip()
    await touch(db, user["id"], name_if_untitled=(stem[:1].upper() + stem[1:]) if stem else None)
    job = None
    if affected:
        job = await runner.enqueue(user["id"], affected, trigger="upload", force=True, label=f"Upload: {filename}")
        await db.uploads.update_one({"_id": upload["_id"]}, {"$set": {"job_id": str(job["_id"])}})
        upload["job_id"] = str(job["_id"])
    return {"upload": clean(upload), "job": clean(job) if job else None}


@router.post("", status_code=201)
async def upload(file: UploadFile = File(...), kind: str | None = Form(default=None),
                 user: dict = Depends(workspace)) -> dict[str, Any]:
    name = safe_name(file.filename)
    if extension(name) not in ALLOWED_EXT:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                            "Unsupported file type. Use CSV, XLSX, TXT, MD, DOCX, PDF or EML.")
    if kind not in (None, "", "auto", "deals", "activities"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "kind must be deals, activities or auto")
    content = await read_limited(file, get_settings().max_upload_mb * 1024 * 1024)
    if not content:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The file is empty")
    return await process_upload(user, name, content, None if kind in (None, "", "auto") else kind)


@router.get("")
async def list_uploads(user: dict = Depends(workspace)) -> list[dict[str, Any]]:
    docs = await get_db().uploads.find({"user_id": user["id"]}).sort("created_at", -1).limit(50).to_list(length=None)
    return clean(docs)


@router.get("/{upload_id}")
async def get_upload(upload_id: str, user: dict = Depends(workspace)) -> dict[str, Any]:
    if not ObjectId.is_valid(upload_id):
        raise HTTPException(404, "Upload not found")
    doc = await get_db().uploads.find_one({"_id": ObjectId(upload_id), "user_id": user["id"]})
    if not doc:
        raise HTTPException(404, "Upload not found")
    return clean(doc)
