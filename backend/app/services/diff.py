"""Explain what changed between two analyses of the same deal."""
from __future__ import annotations

from typing import Any


def compare(prev: dict[str, Any] | None, new: dict[str, Any], new_activity_ids: list[str],
            newly_done_actions: list[str]) -> tuple[list[dict[str, Any]], str]:
    if not prev:
        return [], "First analysis of this deal."
    changes: list[dict[str, Any]] = []
    if prev.get("risk_level") != new.get("risk_level"):
        changes.append({"kind": "risk_level", "before": prev.get("risk_level"), "after": new.get("risk_level"),
                        "text": f"Risk moved from {prev.get('risk_level')} to {new.get('risk_level')}."})
    d = (new.get("risk_score") or 0) - (prev.get("risk_score") or 0)
    if abs(d) >= 5:
        changes.append({"kind": "risk_score", "before": prev.get("risk_score"), "after": new.get("risk_score"),
                        "text": f"Risk score {'rose' if d > 0 else 'fell'} by {abs(d)} points "
                                f"({prev.get('risk_score')} → {new.get('risk_score')})."})
    if bool(prev.get("stalled")) != bool(new.get("stalled")):
        changes.append({"kind": "stalled", "before": prev.get("stalled"), "after": new.get("stalled"),
                        "text": "Deal is now flagged as stalled." if new.get("stalled") else "Deal is no longer stalled."})
    old = {s["code"]: s for s in prev.get("signals") or [] if s["weight"] > 0}
    cur = {s["code"]: s for s in new.get("signals") or [] if s["weight"] > 0}
    for code in sorted(cur.keys() - old.keys(), key=lambda c: -cur[c]["weight"]):
        s = cur[code]
        changes.append({"kind": "signal_added", "code": code, "evidence_ids": s["evidence_ids"],
                        "text": f"New: {s['label']}. {s['detail']}"})
    for code in sorted(old.keys() - cur.keys(), key=lambda c: -old[c]["weight"]):
        s = old[code]
        changes.append({"kind": "signal_resolved", "code": code, "evidence_ids": s["evidence_ids"],
                        "text": f"Resolved: {s['label']}."})
    for code in cur.keys() & old.keys():
        if cur[code].get("mitigated") and not old[code].get("mitigated"):
            changes.append({"kind": "signal_mitigated", "code": code,
                            "text": f"Being fixed: {cur[code]['label']} (recovery action completed)."})
    if new_activity_ids:
        changes.append({"kind": "new_activity", "evidence_ids": new_activity_ids[:6],
                        "text": f"{len(new_activity_ids)} new activity record(s) since the last analysis."})
    for title in newly_done_actions:
        changes.append({"kind": "action_done", "text": f"Completed: {title}."})
    if not changes:
        return [], "No meaningful change since the last analysis."
    order = ["risk_level", "signal_added", "signal_resolved", "signal_mitigated", "stalled", "risk_score",
             "action_done", "new_activity"]
    changes.sort(key=lambda c: order.index(c["kind"]) if c["kind"] in order else 99)  # stable: keeps weight order
    headline = changes[0]["text"]
    reason = next((c["text"] for c in changes if c["kind"] in ("signal_added", "signal_resolved", "signal_mitigated")),
                  None)
    summary = headline if not reason or reason == headline else f"{headline} {reason}"
    return changes, summary
