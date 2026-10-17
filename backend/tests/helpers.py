"""Shared helpers for the unit tests: load the sample dataset without a database."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from app.services import ingest

SAMPLE = Path(__file__).resolve().parent.parent / "app" / "sample_data"
AS_OF = datetime(2026, 10, 17, 12, tzinfo=timezone.utc)


def load_sample(include_update: bool = False):
    deals = ingest.parse_deal_rows(ingest.read_tables((SAMPLE / "crm_deals.csv").read_bytes(), "crm_deals.csv")[0][1]).records
    acts: list[dict] = []
    seq: dict[str, int] = {}

    def add(res):
        for r in res.records:
            p = ingest.TYPE_PREFIX[r["type"]]
            seq[p] = seq.get(p, 0) + 1
            r["activity_id"] = f"{p}-{seq[p]:04d}"
            acts.append(r)

    add(ingest.parse_activity_rows(ingest.read_tables((SAMPLE / "activities.csv").read_bytes(), "activities.csv")[0][1],
                                   deals, "activities.csv"))
    for f in ("northwind_email_thread.txt", "harbor_mutual_discovery_call.txt", "kestrel_meeting_notes.docx"):
        add(ingest.parse_document((SAMPLE / f).read_bytes(), f, deals))
    if include_update:
        add(ingest.parse_activity_rows(
            ingest.read_tables((SAMPLE / "update/new_activity.csv").read_bytes(), "new_activity.csv")[0][1],
            deals, "new_activity.csv"))
        add(ingest.parse_document((SAMPLE / "update/northwind_call_notes_oct15.txt").read_bytes(),
                                  "northwind_call_notes_oct15.txt", deals))
    return deals, acts


def deal_and_acts(deals, acts, deal_id):
    deal = next(d for d in deals if d["deal_id"] == deal_id)
    return deal, [a for a in acts if a["deal_id"] == deal_id]
