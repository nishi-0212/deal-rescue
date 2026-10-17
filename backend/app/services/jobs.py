"""Background analysis queue.

A lightweight in-process asyncio worker: no Redis or Celery needed, so it runs on a single
Render instance. Each job stores live, per-deal progress (queued → reading → detecting →
diagnosing → planning → done) in MongoDB so the UI can draw the run as a flow chart, and a
running job can be stopped. Unfinished jobs are re-queued when the server restarts.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from bson import ObjectId

from ..config import get_settings
from ..db import get_db
from .analysis import analyze_deal, record_event, take_snapshot
from .pipelines import touch
from .utils import now_utc

log = logging.getLogger("deal_rescue.jobs")
FINISHED = ("done", "failed", "cancelled")


class JobRunner:
    def __init__(self) -> None:
        self.queue: asyncio.Queue[str] | None = None
        self.worker: asyncio.Task | None = None
        self.running: dict[str, asyncio.Task] = {}
        self.monitor: asyncio.Task | None = None

    async def start(self) -> None:
        self.queue = asyncio.Queue()
        self.worker = asyncio.create_task(self._loop(), name="analysis-worker")
        db = get_db()
        stale = await db.jobs.find({"status": {"$in": ["queued", "running"]}}).to_list(length=None)
        for j in stale:
            await db.jobs.update_one({"_id": j["_id"]}, {"$set": {"status": "queued"}})
            await self.queue.put(str(j["_id"]))
        log.info("Analysis worker started (%d job(s) resumed)", len(stale))
        if get_settings().monitor_enabled:
            self.monitor = asyncio.create_task(self._watch(), name="daily-check")

    async def _watch(self) -> None:
        from .monitor import monitor_once
        while True:
            try:
                await monitor_once(get_db())
            except asyncio.CancelledError:
                raise
            except Exception:  # never let the watcher die
                log.exception("Daily check failed")
            await asyncio.sleep(max(5, get_settings().monitor_interval_minutes) * 60)

    async def stop(self) -> None:
        if self.monitor:
            self.monitor.cancel()
            self.monitor = None
        for t in list(self.running.values()):
            t.cancel()
        if self.worker:
            self.worker.cancel()
            try:
                await self.worker
            except asyncio.CancelledError:
                pass
        self.worker = None

    async def enqueue(self, scope: str, deal_ids: list[str], trigger: str, force: bool = False,
                      label: str | None = None) -> dict[str, Any]:
        db = get_db()
        found = await db.deals.find({"user_id": scope, "deal_id": {"$in": deal_ids}}).to_list(length=None)
        names = {d["deal_id"]: d.get("account") or d["deal_id"] for d in found}
        job = {"user_id": scope, "type": "analyze", "status": "queued", "trigger": trigger, "force": force,
               "deal_ids": deal_ids, "total": len(deal_ids), "done": 0, "failed": 0, "label": label,
               "deals": [{"deal_id": d, "account": names.get(d, d), "stage": "queued", "risk_level": None}
                         for d in deal_ids],
               "error": None, "created_at": now_utc(), "started_at": None, "finished_at": None}
        res = await db.jobs.insert_one(job)
        job_id = str(res.inserted_id)
        if get_settings().analysis_inline or self.queue is None:
            await self.run(job_id)
            job = await db.jobs.find_one({"_id": res.inserted_id}) or job
        else:
            await self.queue.put(job_id)
        job["_id"] = res.inserted_id
        return job

    async def cancel(self, job_id: str) -> bool:
        """Stop a queued or running job. Deals already analyzed keep their new results."""
        db = get_db()
        job = await db.jobs.find_one({"_id": ObjectId(job_id)})
        if not job or job["status"] in FINISHED:
            return False
        await db.jobs.update_one({"_id": job["_id"]}, {"$set": {"status": "cancelled", "finished_at": now_utc()}})
        task = self.running.get(job_id)
        if task:
            task.cancel()
        else:
            await self._mark_stopped(job["_id"])
        await record_event(db, job["user_id"], "job", f"Analysis stopped after {job.get('done', 0)} of "
                                                     f"{job['total']} deal(s)")
        return True

    async def _mark_stopped(self, oid: Any) -> None:
        job = await get_db().jobs.find_one({"_id": oid})
        if not job:
            return
        upd = {f"deals.{i}.stage": "stopped" for i, d in enumerate(job.get("deals") or [])
               if d.get("stage") not in ("done", "failed")}
        if upd:
            await get_db().jobs.update_one({"_id": oid}, {"$set": upd})

    async def cancel_scope(self, scope: str) -> None:
        db = get_db()
        for j in await db.jobs.find({"user_id": scope, "status": {"$in": ["queued", "running"]}}).to_list(length=None):
            await self.cancel(str(j["_id"]))

    async def _loop(self) -> None:
        assert self.queue is not None
        while True:
            job_id = await self.queue.get()
            try:
                await self.run(job_id)
            except Exception:  # keep the worker alive
                log.exception("Job %s crashed", job_id)
            finally:
                self.queue.task_done()

    async def run(self, job_id: str) -> None:
        db = get_db()
        job = await db.jobs.find_one({"_id": ObjectId(job_id)})
        if not job or job["status"] in FINISHED:
            return
        await db.jobs.update_one({"_id": job["_id"]}, {"$set": {"status": "running", "started_at": now_utc()}})
        task = asyncio.ensure_future(self._work(job))
        self.running[job_id] = task
        try:
            counters = await task
        except asyncio.CancelledError:
            log.info("Job %s stopped", job_id)
            await db.jobs.update_one({"_id": job["_id"], "status": {"$ne": "cancelled"}},
                                     {"$set": {"status": "cancelled", "finished_at": now_utc()}})
            await self._mark_stopped(job["_id"])
            return
        finally:
            self.running.pop(job_id, None)
        fresh = await db.jobs.find_one({"_id": job["_id"]})
        if fresh and fresh["status"] == "cancelled":
            return
        status = "failed" if counters["failed"] and counters["failed"] == job["total"] else "done"
        await db.jobs.update_one({"_id": job["_id"]}, {"$set": {"status": status, "finished_at": now_utc()}})
        if job["total"]:
            await take_snapshot(db, job["user_id"])
            await touch(db, job["user_id"])
            if job["total"] > 1:
                await record_event(db, job["user_id"], "job",
                                   f"Analysis finished for {job['total']} deal(s)"
                                   + (f", {counters['failed']} failed" if counters["failed"] else ""))

    async def _work(self, job: dict[str, Any]) -> dict[str, int]:
        db = get_db()
        sem = asyncio.Semaphore(max(1, get_settings().analysis_concurrency))
        counters = {"done": 0, "failed": 0}
        index = {d: i for i, d in enumerate(job["deal_ids"])}

        async def set_stage(deal_id: str, stage: str, extra: dict[str, Any] | None = None) -> None:
            i = index[deal_id]
            upd = {f"deals.{i}.stage": stage, **{f"deals.{i}.{k}": v for k, v in (extra or {}).items()}}
            await db.jobs.update_one({"_id": job["_id"]}, {"$set": upd})

        async def one(deal_id: str) -> None:
            async with sem:
                try:
                    res = await analyze_deal(db, job["user_id"], deal_id, trigger=job["trigger"],
                                             force=job.get("force", False),
                                             on_stage=lambda s: set_stage(deal_id, s))
                    await set_stage(deal_id, "done", {"risk_level": (res or {}).get("risk_level")})
                except asyncio.CancelledError:
                    raise
                except Exception:
                    counters["failed"] += 1
                    log.exception("Analysis failed for deal %s", deal_id)
                    await set_stage(deal_id, "failed")
                finally:
                    counters["done"] += 1
                    await db.jobs.update_one({"_id": job["_id"]},
                                             {"$set": {"done": counters["done"], "failed": counters["failed"]}})

        await asyncio.gather(*(one(d) for d in job["deal_ids"]))
        return counters


runner = JobRunner()
