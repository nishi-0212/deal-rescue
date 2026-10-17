from __future__ import annotations

from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException

from ..db import get_db
from ..deps import workspace
from ..serialize import clean

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("")
async def list_jobs(user: dict = Depends(workspace), active: bool = False) -> list[dict[str, Any]]:
    q: dict[str, Any] = {"user_id": user["id"]}
    if active:
        q["status"] = {"$in": ["queued", "running"]}
    return clean(await get_db().jobs.find(q).sort("created_at", -1).limit(20).to_list(length=None))


@router.get("/{job_id}")
async def get_job(job_id: str, user: dict = Depends(workspace)) -> dict[str, Any]:
    if not ObjectId.is_valid(job_id):
        raise HTTPException(404, "Job not found")
    job = await get_db().jobs.find_one({"_id": ObjectId(job_id), "user_id": user["id"]})
    if not job:
        raise HTTPException(404, "Job not found")
    return clean(job)


@router.post("/{job_id}/cancel")
async def cancel_job(job_id: str, user: dict = Depends(workspace)) -> dict[str, Any]:
    """Force-stop a queued or running analysis. Deals finished before the stop keep their new results."""
    from ..services.jobs import runner

    if not ObjectId.is_valid(job_id):
        raise HTTPException(404, "Job not found")
    job = await get_db().jobs.find_one({"_id": ObjectId(job_id), "user_id": user["id"]})
    if not job:
        raise HTTPException(404, "Job not found")
    if not await runner.cancel(job_id):
        raise HTTPException(409, "This analysis has already finished")
    return clean(await get_db().jobs.find_one({"_id": job["_id"]}))
