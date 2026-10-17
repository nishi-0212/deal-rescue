"""Sample data so every workflow can be tried without any integration."""
from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..db import get_db
from ..deps import workspace
from ..serialize import clean
from ..services.analysis import record_event
from ..services.importer import import_file
from ..services.ingest import UploadError
from ..services.jobs import runner
from ..services.pipelines import delete_scope_data, touch
from ..services.utils import now_utc

router = APIRouter(prefix="/api/demo", tags=["sample data"])

SAMPLE_DIR = Path(__file__).resolve().parent.parent / "sample_data"
# The sample files are written as if "today" were this date. Dates are shifted on load so
# the scenario always looks current.
SAMPLE_ANCHOR = date(2026, 10, 17)
BASE_FILES = ["crm_deals.csv", "activities.csv", "northwind_email_thread.txt",
              "harbor_mutual_discovery_call.txt", "kestrel_meeting_notes.docx"]
UPDATE_FILES = ["update/new_activity.csv", "update/northwind_call_notes_oct15.txt"]


def shift_days() -> int:
    return (now_utc().date() - SAMPLE_ANCHOR).days


async def _load(user: dict[str, Any], files: list[str], label: str) -> dict[str, Any]:
    db = get_db()
    uploads, affected = [], set()
    offset = shift_days()
    for rel in files:
        path = SAMPLE_DIR / rel
        try:
            up, aff = await import_file(db, user["id"], path.name, path.read_bytes(), shift_days=offset)
        except UploadError as exc:
            raise HTTPException(422, f"{rel}: {exc}") from exc
        uploads.append(up)
        affected.update(aff)
    job = None
    if affected:
        job = await runner.enqueue(user["id"], sorted(affected), trigger="upload", force=True, label=label)
    await record_event(db, user["id"], "upload", f"{label}: {len(files)} file(s) imported")
    await touch(db, user["id"], name_if_untitled="Sample pipeline")
    return {"uploads": clean(uploads), "job": clean(job) if job else None, "deals_affected": sorted(affected)}


@router.post("/sample")
async def load_sample(user: dict = Depends(workspace)) -> dict[str, Any]:
    """Load the stalled-deal sample pipeline (CRM export, email threads, call transcript, meeting notes)."""
    return await _load(user, BASE_FILES, "Sample pipeline")


@router.post("/update")
async def load_update(user: dict = Depends(workspace)) -> dict[str, Any]:
    """Load a second batch of new activity to see the analysis change."""
    if not await get_db().deals.find_one({"user_id": user["id"]}):
        raise HTTPException(409, "Load the sample pipeline first")
    return await _load(user, UPDATE_FILES, "New activity batch")


@router.get("/files")
async def sample_files() -> list[dict[str, Any]]:
    return [{"name": f, "size": (SAMPLE_DIR / f).stat().st_size, "batch": "base" if f in BASE_FILES else "update"}
            for f in BASE_FILES + UPDATE_FILES]


@router.delete("/data")
async def reset_workspace(user: dict = Depends(workspace)) -> dict[str, Any]:
    """Delete all deals, activities, analyses, actions and drafts in the current pipeline."""
    await runner.cancel_scope(user["id"])
    return {"removed": await delete_scope_data(get_db(), user["id"])}
