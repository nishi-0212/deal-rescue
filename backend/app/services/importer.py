"""Persist parsed upload records and work out which deals need re-analysis."""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from ..db import next_sequence
from . import ingest
from .utils import fingerprint, now_utc

log = logging.getLogger("deal_rescue.import")

DEAL_FIELDS = ["name", "account", "value", "currency", "stage", "owner", "expected_close", "last_activity_date",
               "probability", "forecast_category", "status", "stage_entered", "days_in_stage_reported", "contacts",
               "crm_created"]
DATE_FIELDS = {"deals": ["expected_close", "last_activity_date", "stage_entered", "crm_created"],
               "activities": ["date", "due_date"]}


def _shift(records: list[dict[str, Any]], kind: str, days: int) -> None:
    if not days:
        return
    for r in records:
        for f in DATE_FIELDS[kind]:
            if r.get(f):
                r[f] = r[f] + timedelta(days=days)


async def import_file(db: Any, user_id: str, filename: str, content: bytes, kind_hint: str | None = None,
                      shift_days: int = 0) -> tuple[dict[str, Any], list[str]]:
    ext = ingest.extension(filename)
    if ext not in ingest.ALLOWED_EXT:
        raise ingest.UploadError(f"{ext or 'Files without an extension'} can't be uploaded. Use CSV, XLSX, TXT, MD, "
                                 f"DOCX, PDF or EML.")
    upload = {"user_id": user_id, "filename": filename, "size": len(content), "kind": None, "status": "processing",
              "rows_total": 0, "rows_imported": 0, "rows_skipped": 0, "duplicates": 0, "errors": [],
              "deals_created": 0, "deals_updated": 0, "deals_affected": [], "job_id": None, "created_at": now_utc()}
    affected: set[str] = set()
    existing = await db.deals.find({"user_id": user_id}).to_list(length=None)

    results: list[ingest.ParseResult] = []
    if ext in ingest.TABLE_EXT:
        for sheet, df in ingest.read_tables(content, filename):
            kind = kind_hint if kind_hint in ("deals", "activities") else ingest.detect_kind(list(df.columns))
            if kind == "deals":
                results.append(ingest.parse_deal_rows(df, sheet))
            elif kind == "activities":
                pending = [r for res in results if res.kind == "deals" for r in res.records]
                results.append(ingest.parse_activity_rows(df, existing + pending, filename, sheet))
            else:
                results.append(ingest.ParseResult(kind="unknown", rows_total=len(df), errors=[{
                    "row": None, "field": None,
                    "message": f"Couldn't tell whether sheet '{sheet}' holds deals or activities. Deals need "
                               f"value and stage columns; activities need date and body/notes columns."}]))
    else:
        if not existing:
            raise ingest.UploadError("Upload your CRM deals file first, so documents can be matched to deals.")
        results.append(ingest.parse_document(content, filename, existing))

    kinds = {r.kind for r in results}
    upload["kind"] = "mixed" if len(kinds) > 1 else next(iter(kinds))
    now = now_utc()
    for res in results:
        upload["rows_total"] += res.rows_total
        upload["errors"].extend(res.errors)
        if res.kind == "deals":
            _shift(res.records, "deals", shift_days)
            for rec in res.records:
                old = await db.deals.find_one({"user_id": user_id, "deal_id": rec["deal_id"]})
                if old is None:
                    await db.deals.insert_one({"user_id": user_id, **rec, "created_at": now, "updated_at": now,
                                               "latest": None})
                    upload["deals_created"] += 1
                    affected.add(rec["deal_id"])
                else:
                    changed = {k: rec[k] for k in DEAL_FIELDS if old.get(k) != rec.get(k)}
                    if changed:
                        await db.deals.update_one({"_id": old["_id"]}, {"$set": {**changed, "updated_at": now}})
                        upload["deals_updated"] += 1
                        affected.add(rec["deal_id"])
                upload["rows_imported"] += 1
            existing = await db.deals.find({"user_id": user_id}).to_list(length=None)
        elif res.kind in ("activities", "documents"):
            _shift(res.records, "activities", shift_days)
            for rec in res.records:
                fp = fingerprint(rec["deal_id"], rec["type"], rec["date"].date().isoformat(), rec.get("subject"),
                                 (rec.get("body") or "")[:300])
                if await db.activities.find_one({"user_id": user_id, "fingerprint": fp}):
                    upload["duplicates"] += 1
                    continue
                aid = (rec.get("activity_id") or "").strip().upper()
                if not aid or await db.activities.find_one({"user_id": user_id, "activity_id": aid}):
                    prefix = ingest.TYPE_PREFIX.get(rec["type"], "ACT")
                    aid = f"{prefix}-{await next_sequence(db, f'{user_id}:{prefix}'):04d}"
                await db.activities.insert_one({**rec, "user_id": user_id, "activity_id": aid, "fingerprint": fp,
                                                "created_at": now})
                upload["rows_imported"] += 1
                affected.add(rec["deal_id"])
    real_errors = [e for e in upload["errors"] if e.get("level") != "warning"]
    upload["rows_skipped"] = len({(e.get("sheet"), e.get("row")) for e in real_errors if e.get("row")})
    upload["errors"] = upload["errors"][:200]
    upload["deals_affected"] = sorted(affected)
    upload["status"] = ("failed" if upload["rows_imported"] == 0 and real_errors
                        else "partial" if real_errors else "done")
    res_ins = await db.uploads.insert_one(upload)
    upload["_id"] = res_ins.inserted_id
    log.info("Upload %s by %s: %s rows imported, %s skipped", filename, user_id, upload["rows_imported"],
             upload["rows_skipped"])
    return upload, sorted(affected)
