from app.services.detection import detect, has_term
from app.services.diff import compare

from .helpers import AS_OF, deal_and_acts, load_sample


def _run(include_update=False):
    deals, acts = load_sample(include_update)
    return {d["deal_id"]: detect(d, [a for a in acts if a["deal_id"] == d["deal_id"]], [], AS_OF) for d in deals}


def test_whole_word_matching():
    assert has_term("We need SSO through Okta", "sso")
    assert not has_term("We also need reports", "sso")
    assert has_term("The IT team", "it")
    assert not has_term("audit trail", "it")


def test_northwind_is_high_risk_with_evidence():
    det = _run()["DL-1042"]
    codes = {s["code"] for s in det.signals}
    assert det.risk_level == "High" and det.stalled
    assert {"UNANSWERED_CUSTOMER_EMAIL", "BLOCKER_SECURITY", "MISSING_ECONOMIC_BUYER", "FORECAST_MISMATCH",
            "MEETING_DECLINED"} <= codes
    for s in det.signals:
        assert s["evidence_ids"], s["code"]
        assert all(e in det.allowed_evidence for e in s["evidence_ids"])


def test_pricing_praise_is_not_a_blocker():
    # "the pricing works for us" must not be read as a pricing objection
    assert "BLOCKER_PRICING" not in {s["code"] for s in _run()["DL-1042"].signals}


def test_healthy_and_closed_deals():
    res = _run()
    assert res["DL-1048"].risk_level == "Low" and not res["DL-1048"].stalled
    assert res["DL-1053"].risk_level == "Low"
    assert res["DL-1051"].risk_level == "Closed" and res["DL-1051"].signals == []


def test_silence_follow_ups_and_close_date():
    det = _run()["DL-1049"]
    codes = {s["code"] for s in det.signals}
    assert {"NO_RECENT_ENGAGEMENT", "NO_REPLY_TO_FOLLOWUPS", "CLOSE_DATE_PASSED", "FORECAST_MISMATCH"} <= codes
    assert det.days_silent >= 30


def test_missed_follow_up_and_long_stage():
    det = _run()["DL-1052"]
    codes = {s["code"] for s in det.signals}
    assert {"MISSED_FOLLOW_UP", "LONG_STAGE", "UNANSWERED_CUSTOMER_EMAIL"} <= codes


def test_new_activity_changes_the_assessment():
    before, after = _run(), _run(include_update=True)
    # Kestrel: revised pricing sent and approved -> risk drops, pricing blocker resolved
    assert before["DL-1044"].stalled and not after["DL-1044"].stalled
    assert "BLOCKER_PRICING" in {s["code"] for s in before["DL-1044"].signals}
    assert "BLOCKER_PRICING" not in {s["code"] for s in after["DL-1044"].signals}
    changes, summary = compare(before["DL-1044"].as_dict(), after["DL-1044"].as_dict(), [], [])
    assert any(c["kind"] == "signal_resolved" for c in changes)
    assert "Low" in summary
    # Northwind: new call notes reveal a spending freeze
    assert "BLOCKER_DEADLINE" in {s["code"] for s in after["DL-1042"].signals}


def test_completed_action_softens_signal():
    deals, acts = load_sample()
    deal, da = deal_and_acts(deals, acts, "DL-1042")
    base = detect(deal, da, [], AS_OF)
    done = [{"status": "done", "addresses": ["BLOCKER_SECURITY"], "title": "Send questionnaire"}]
    after = detect(deal, da, done, AS_OF)
    sec = next(s for s in after.signals if s["code"] == "BLOCKER_SECURITY")
    assert sec["mitigated"]
    assert after.risk_score < base.risk_score


def test_stakeholders_missing_and_quiet():
    det = _run()["DL-1042"]
    missing = [s for s in det.stakeholders if s["status"] == "missing"]
    assert any(s["category"] == "economic_buyer" for s in missing)
    marcus = next(s for s in det.stakeholders if s["name"] == "Marcus Hale")
    assert marcus["category"] == "technical_evaluator"


def test_engagement_buckets():
    det = _run()["DL-1042"]
    assert len(det.engagement) == 10
    assert sum(b["customer"] for b in det.engagement) >= 2
