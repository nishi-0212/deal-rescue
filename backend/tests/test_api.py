"""End-to-end API workflows against an in-memory database (rule-based analysis, no LLM)."""
from __future__ import annotations

from .conftest import register


async def test_health(client):
    r = await client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


async def test_auth_flow_and_protection(client):
    r = await client.get("/api/deals")
    assert r.status_code == 401
    h = await register(client, "a@example.com")
    assert (await client.get("/api/auth/me", headers=h)).json()["email"] == "a@example.com"
    dup = await client.post("/api/auth/register", json={"name": "A", "email": "A@example.com",
                                                         "password": "another-pass-1"})
    assert dup.status_code == 409
    bad = await client.post("/api/auth/login", json={"email": "a@example.com", "password": "wrong-password"})
    assert bad.status_code == 401
    ok = await client.post("/api/auth/login", json={"email": "a@example.com", "password": "correct-horse-1"})
    assert ok.status_code == 200 and ok.json()["token"]
    weak = await client.post("/api/auth/register", json={"name": "B", "email": "b@example.com", "password": "short"})
    assert weak.status_code == 422
    assert (await client.get("/api/deals", headers={"Authorization": "Bearer nonsense"})).status_code == 401


async def test_sample_load_dashboard_and_deal_detail(client, auth):
    r = await client.post("/api/demo/sample", headers=auth)
    assert r.status_code == 200, r.text
    assert r.json()["job"]["status"] in ("queued", "running", "done")

    dash = (await client.get("/api/dashboard", headers=auth)).json()
    assert dash["has_data"] and dash["kpis"]["open_deals"] == 11
    assert dash["kpis"]["stalled_count"] >= 5 and dash["kpis"]["high_risk"] >= 3
    assert dash["stages"] and dash["reasons"] and dash["feed"]

    deals = (await client.get("/api/deals", params={"risk": "High"}, headers=auth)).json()
    assert deals["total"] >= 3 and all(d["latest"]["risk_level"] == "High" for d in deals["items"])
    assert deals["facets"]["owners"] and deals["facets"]["stages"]
    filtered = (await client.get("/api/deals", params={"owner": "Dev Kapoor", "min_value": 100000},
                                 headers=auth)).json()
    assert all(d["owner"] == "Dev Kapoor" and d["value"] >= 100000 for d in filtered["items"])

    detail = (await client.get("/api/deals/DL-1042", headers=auth)).json()
    a = detail["analysis"]
    assert a["risk_level"] == "High" and a["stalled"] and a["source"] == "rules"
    ids = {t["activity_id"] for t in detail["timeline"]} | {"CRM"}
    assert a["diagnosis"]["root_causes"]
    for cause in a["diagnosis"]["root_causes"]:
        assert cause["evidence_ids"] and set(cause["evidence_ids"]) <= ids
    assert detail["actions"] and all(x["status"] == "open" for x in detail["actions"])
    assert detail["history"][0]["version"] == 1

    assert (await client.get("/api/deals/NOPE", headers=auth)).status_code == 404


async def test_action_update_flags_deal_until_user_rechecks(client, auth):
    await client.post("/api/demo/sample", headers=auth)
    detail = (await client.get("/api/deals/DL-1042", headers=auth)).json()
    sec = next(x for x in detail["actions"] if "BLOCKER_SECURITY" in x["addresses"])
    r = await client.patch(f"/api/actions/{sec['id']}", json={"status": "done", "note": "Sent today"}, headers=auth)
    assert r.status_code == 200 and r.json()["action"]["status"] == "done" and r.json()["job"] is None
    waiting = (await client.get("/api/deals/DL-1042", headers=auth)).json()
    assert waiting["analysis"]["version"] == 1  # nothing re-runs on its own
    assert waiting["deal"]["needs_recheck"] is True and waiting["deal"]["pending_changes"] == 1
    r = await client.post("/api/deals/reanalyze", json={"pending_only": True}, headers=auth)
    assert r.status_code == 202 and r.json()["job"]["deal_ids"] == ["DL-1042"]
    after = (await client.get("/api/deals/DL-1042", headers=auth)).json()
    assert after["deal"]["needs_recheck"] is False
    assert (await client.post("/api/deals/reanalyze", json={"pending_only": True}, headers=auth)).status_code == 404
    assert after["analysis"]["version"] == 2
    kinds = {c["kind"] for c in after["analysis"]["changes"]}
    assert "signal_mitigated" in kinds or "action_done" in kinds
    assert after["analysis"]["risk_score"] < detail["analysis"]["risk_score"]
    assert after["deal"]["latest"]["recovery"]["done"] == 1
    bad = await client.patch(f"/api/actions/{sec['id']}", json={"status": "finished"}, headers=auth)
    assert bad.status_code == 422


async def test_new_activity_changes_analysis(client, auth):
    await client.post("/api/demo/sample", headers=auth)
    before = (await client.get("/api/deals/DL-1044", headers=auth)).json()["analysis"]
    r = await client.post("/api/demo/update", headers=auth)
    assert r.status_code == 200 and "DL-1044" in r.json()["deals_affected"]
    after = (await client.get("/api/deals/DL-1044", headers=auth)).json()
    a = after["analysis"]
    assert a["version"] == before["version"] + 1
    assert a["risk_score"] < before["risk_score"]
    assert a["change_summary"] and a["changes"]
    assert any(c["kind"] == "new_activity" for c in a["changes"])
    assert len(after["history"]) == 2


async def test_upload_validation_and_dedup(client, auth):
    await client.post("/api/demo/sample", headers=auth)
    r = await client.post("/api/uploads", files={"file": ("evil.exe", b"MZ", "application/octet-stream")},
                          headers=auth)
    assert r.status_code == 415
    csv = (b"deal_id,deal_name,amount,stage,close_date\n"
           b"N-1,New deal,50000,Proposal,2026-12-01\n"
           b"N-2,Broken,not-money,Proposal,2026-12-01\n")
    r = await client.post("/api/uploads", files={"file": ("crm.csv", csv, "text/csv")}, headers=auth)
    assert r.status_code == 201, r.text
    up = r.json()["upload"]
    assert up["status"] == "partial" and up["deals_created"] == 1 and up["rows_skipped"] == 1
    assert up["errors"][0]["row"] == 3 and up["errors"][0]["field"] == "value"
    act = b"deal_id,type,date,direction,body\nN-1,email,2026-10-10,inbound,Can you send pricing?\n"
    first = (await client.post("/api/uploads", files={"file": ("a.csv", act, "text/csv")}, headers=auth)).json()
    again = (await client.post("/api/uploads", files={"file": ("a.csv", act, "text/csv")}, headers=auth)).json()
    assert first["upload"]["rows_imported"] == 1
    assert again["upload"]["duplicates"] == 1 and again["upload"]["rows_imported"] == 0
    uploads = (await client.get("/api/uploads", headers=auth)).json()
    assert len(uploads) >= 3


async def test_drafts_require_approval(client, auth):
    await client.post("/api/demo/sample", headers=auth)
    r = await client.post("/api/deals/DL-1042/drafts", json={"type": "follow_up"}, headers=auth)
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["status"] == "draft" and d["to_email"] and d["subject"]
    send = await client.post(f"/api/drafts/{d['id']}/send", json={"confirm": True}, headers=auth)
    assert send.status_code == 409  # not approved
    ap = await client.post(f"/api/drafts/{d['id']}/approve", headers=auth)
    assert ap.json()["status"] == "approved"
    no_confirm = await client.post(f"/api/drafts/{d['id']}/send", json={}, headers=auth)
    assert no_confirm.status_code == 422
    smtp = await client.post(f"/api/drafts/{d['id']}/send", json={"confirm": True}, headers=auth)
    assert smtp.status_code == 501  # SMTP not configured in tests
    edited = await client.patch(f"/api/drafts/{d['id']}", json={"body": "Edited body"}, headers=auth)
    assert edited.json()["status"] == "draft"  # edits need re-approval
    await client.post(f"/api/drafts/{d['id']}/approve", headers=auth)
    sent = await client.post(f"/api/drafts/{d['id']}/mark-sent", headers=auth)
    assert sent.json()["status"] == "sent"
    assert (await client.patch(f"/api/drafts/{d['id']}", json={"body": "x"}, headers=auth)).status_code == 409
    bad = await client.post("/api/deals/DL-1042/drafts", json={"type": "spam"}, headers=auth)
    assert bad.status_code == 422


async def test_users_cannot_see_each_others_data(client, auth):
    await client.post("/api/demo/sample", headers=auth)
    other = await register(client, "other@example.com", "Other")
    assert (await client.get("/api/deals/DL-1042", headers=other)).status_code == 404
    assert (await client.get("/api/deals", headers=other)).json()["total"] == 0
    detail = (await client.get("/api/deals/DL-1042", headers=auth)).json()
    action_id = detail["actions"][0]["id"]
    assert (await client.patch(f"/api/actions/{action_id}", json={"status": "done"},
                               headers=other)).status_code == 404


async def test_manual_reanalysis_and_reset(client, auth):
    await client.post("/api/demo/sample", headers=auth)
    r = await client.post("/api/deals/reanalyze", json={"deal_ids": ["DL-1043"]}, headers=auth)
    assert r.status_code == 202
    job = r.json()["job"]
    assert (await client.get(f"/api/jobs/{job['id']}", headers=auth)).json()["status"] == "done"
    hist = (await client.get("/api/deals/DL-1043", headers=auth)).json()["history"]
    assert hist[0]["version"] == 2 and hist[0]["trigger"] == "manual"
    reset = await client.delete("/api/demo/data", headers=auth)
    assert reset.status_code == 200
    assert (await client.get("/api/deals", headers=auth)).json()["total"] == 0


async def test_ai_output_is_validated_and_grounded(client, auth, monkeypatch):
    """With an LLM configured, invented evidence is stripped and the result is stored as AI output."""
    from app.config import get_settings
    from app.services import analysis
    from app.services.ai_schemas import Diagnosis

    await client.post("/api/demo/sample", headers=auth)
    timeline = (await client.get("/api/deals/DL-1043", headers=auth)).json()["timeline"]
    real_id = timeline[0]["activity_id"]

    async def fake_llm(messages, model_cls, max_tokens=2500):
        assert "DL-1043" in messages[1]["content"]
        return Diagnosis.model_validate({
            "summary": "Harbor Mutual went quiet after the proposal.",
            "root_causes": [
                {"title": "No reply since proposal", "explanation": "Three follow-ups unanswered.",
                 "status": "confirmed", "confidence": 0.9, "evidence_ids": [real_id, "EML-9999"]},
                {"title": "Invented reason", "explanation": "Not in the data.", "evidence_ids": ["MADE-UP"]},
            ],
            "recovery_plan": [{"title": "Call Lena directly", "action_type": "contact_customer", "owner": "Arjun",
                               "due_in_days": 1, "priority": "P1", "evidence_ids": [real_id]}],
        })

    monkeypatch.setattr(get_settings(), "groq_api_key", "test-key")
    monkeypatch.setattr(analysis, "complete_json", fake_llm)
    r = await client.post("/api/deals/reanalyze", json={"deal_ids": ["DL-1043"]}, headers=auth)
    assert r.status_code == 202
    a = (await client.get("/api/deals/DL-1043", headers=auth)).json()["analysis"]
    assert a["source"] == "ai"
    assert [c["title"] for c in a["diagnosis"]["root_causes"]] == ["No reply since proposal"]
    assert a["diagnosis"]["root_causes"][0]["evidence_ids"] == [real_id]
    assert any("Invented reason" in n for n in a["grounding_notes"])
    assert a["diagnosis"]["recovery_plan"][0]["addresses"]  # filled from the action type


async def test_llm_failure_falls_back_to_rules(client, auth, monkeypatch):
    from app.config import get_settings
    from app.services import analysis
    from app.services.llm import LLMError

    async def broken(*a, **k):
        raise LLMError("rate limited")

    await client.post("/api/demo/sample", headers=auth)
    monkeypatch.setattr(get_settings(), "groq_api_key", "test-key")
    monkeypatch.setattr(analysis, "complete_json", broken)
    await client.post("/api/deals/reanalyze", json={"deal_ids": ["DL-1042"]}, headers=auth)
    a = (await client.get("/api/deals/DL-1042", headers=auth)).json()["analysis"]
    assert a["source"] == "rules" and a["diagnosis"]["root_causes"]
    assert any("AI unavailable" in n for n in a["grounding_notes"])


async def test_pipelines_are_separate_and_deletable(client, auth):
    await client.post("/api/demo/sample", headers=auth)
    base = {"Authorization": auth["Authorization"]}
    listed = (await client.get("/api/pipelines", headers=base)).json()
    assert listed[0]["name"] == "Sample pipeline" and listed[0]["stats"]["deals"] == 12
    new = (await client.post("/api/pipelines", json={}, headers=base)).json()
    other = {**base, "X-Pipeline-Id": new["id"]}
    assert (await client.get("/api/deals", headers=other)).json()["total"] == 0
    assert (await client.get("/api/deals/DL-1042", headers=other)).status_code == 404
    assert (await client.get("/api/deals", headers=base)).status_code == 400  # no pipeline chosen
    renamed = await client.patch(f"/api/pipelines/{new['id']}", json={"name": "Q4 review"}, headers=base)
    assert renamed.json()["name"] == "Q4 review"
    assert (await client.delete(f"/api/pipelines/{new['id']}", headers=base)).status_code == 204
    assert len((await client.get("/api/pipelines", headers=base)).json()) == 1
    assert (await client.delete("/api/pipelines", headers=base)).status_code == 204
    fresh = (await client.get("/api/pipelines", headers=base)).json()
    assert len(fresh) == 1 and fresh[0]["stats"]["deals"] == 0


async def test_job_progress_and_stop(client, auth):
    await client.post("/api/demo/sample", headers=auth)
    r = await client.post("/api/deals/reanalyze", json={"deal_ids": ["DL-1042"]}, headers=auth)
    job = r.json()["job"]
    assert job["deals"][0]["stage"] == "done" and job["deals"][0]["risk_level"] == "High"
    # finished jobs can't be stopped
    assert (await client.post(f"/api/jobs/{job['id']}/cancel", headers=auth)).status_code == 409


async def test_draft_from_action_replies_and_closes_action(client, auth):
    await client.post("/api/demo/sample", headers=auth)
    detail = (await client.get("/api/deals/DL-1042", headers=auth)).json()
    action = next(a for a in detail["actions"] if "UNANSWERED_CUSTOMER_EMAIL" in a["addresses"])
    r = await client.post("/api/deals/DL-1042/drafts", json={"type": "follow_up", "action_id": action["id"]}, headers=auth)
    d = r.json()
    assert d["subject"].startswith("Re: ") and d["to_email"] == "marcus.hale@northwind.example"
    assert d["action_id"] == action["id"]
    await client.post(f"/api/drafts/{d['id']}/approve", headers=auth)
    await client.post(f"/api/drafts/{d['id']}/mark-sent", headers=auth)
    after = (await client.get("/api/deals/DL-1042", headers=auth)).json()
    assert next(a for a in after["actions"] if a["id"] == action["id"])["status"] == "done"
    assert after["analysis"]["version"] == 1 and after["deal"]["needs_recheck"] is True


async def test_new_pipeline_reuses_an_empty_one(client, auth):
    base = {"Authorization": auth["Authorization"]}
    first = (await client.get("/api/pipelines", headers=base)).json()[0]
    again = (await client.post("/api/pipelines", json={}, headers=base)).json()
    twice = (await client.post("/api/pipelines", json={}, headers=base)).json()
    assert first["id"] == again["id"] == twice["id"]  # no pile of blank pipelines
    assert len((await client.get("/api/pipelines", headers=base)).json()) == 1
    await client.post("/api/demo/sample", headers=auth)
    fresh = (await client.post("/api/pipelines", json={}, headers=base)).json()
    assert fresh["id"] != first["id"] and fresh["stats"]["deals"] == 0


async def test_finishing_every_step_does_not_grow_the_plan(client, auth):
    await client.post("/api/demo/sample", headers=auth)
    acts = (await client.get("/api/actions", headers=auth)).json()
    total = len([a for a in acts if a["status"] != "dismissed"])
    for a in acts:
        await client.patch(f"/api/actions/{a['id']}", json={"status": "done"}, headers=auth)
    await client.post("/api/deals/reanalyze", json={"pending_only": True}, headers=auth)
    await client.post("/api/deals/reanalyze", json={}, headers=auth)  # and a full re-analysis
    after = [a for a in (await client.get("/api/actions", headers=auth)).json() if a["status"] != "dismissed"]
    assert len(after) == total and all(a["status"] == "done" for a in after)
    nw = (await client.get("/api/deals/DL-1042", headers=auth)).json()["deal"]["latest"]
    assert nw["waiting_on_customer"] is True and "Wait for" in nw["next_action"]
