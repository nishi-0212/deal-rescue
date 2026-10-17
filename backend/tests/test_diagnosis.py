from app.services import fallback
from app.services.ai_schemas import Diagnosis, ground
from app.services.detection import detect
from app.services.diff import compare

from .helpers import AS_OF, deal_and_acts, load_sample


def test_grounding_removes_invented_evidence():
    raw = Diagnosis.model_validate({
        "summary": "x",
        "root_causes": [
            {"title": "Real", "explanation": "e", "evidence_ids": ["eml-0001", "FAKE-9"]},
            {"title": "Invented", "explanation": "e", "evidence_ids": ["NOPE-1"]},
        ],
        "unresolved_objections": [{"objection": "o", "evidence_ids": ["X-1"]}],
        "last_meaningful_interaction": {"activity_id": "GHOST-1", "summary": "s"},
        "recovery_plan": [{"title": "Do it", "evidence_ids": ["EML-0001"], "addresses": ["BOGUS", "BLOCKER_SECURITY"]}],
    })
    diag, notes = ground(raw, {"EML-0001", "CRM"}, {"BLOCKER_SECURITY"})
    assert [c.title for c in diag.root_causes] == ["Real"]
    assert diag.root_causes[0].evidence_ids == ["EML-0001"]   # case-normalised, fake id dropped
    assert diag.unresolved_objections == []
    assert diag.last_meaningful_interaction.activity_id is None
    assert diag.recovery_plan[0].addresses == ["BLOCKER_SECURITY"]
    assert any("Invented" in n for n in notes)


def test_rule_based_diagnosis_is_complete_and_grounded():
    deals, acts = load_sample()
    deal, da = deal_and_acts(deals, acts, "DL-1042")
    det = detect(deal, da, [], AS_OF)
    diag = fallback.diagnose(deal, det, da)
    assert diag.summary and diag.recommended_next_action
    assert diag.root_causes and diag.recovery_plan and diag.missing_stakeholders
    titles = [p.title for p in diag.recovery_plan]
    assert "Complete and send back the security questionnaire" in titles
    for c in diag.root_causes:
        assert set(c.evidence_ids) <= det.allowed_evidence
    # survives the same grounding check as AI output
    grounded, notes = ground(diag, det.allowed_evidence, {s["code"] for s in det.signals})
    assert len(grounded.root_causes) == len(diag.root_causes) and notes == []
    assert diag.recovery_plan[0].priority == "P1"


def test_template_drafts_for_every_type():
    deals, acts = load_sample()
    deal, da = deal_and_acts(deals, acts, "DL-1043")
    det = detect(deal, da, [], AS_OF)
    diag = fallback.diagnose(deal, det, da).model_dump()
    for kind in ("follow_up", "objection_handling", "meeting_request", "procurement_escalation",
                 "decision_maker_outreach"):
        d = fallback.draft(kind, deal, diag, det.stakeholders)
        assert d.subject and d.body
        assert d.to_email == "lena.ortiz@harbormutual.example"
        assert d.body.rstrip().endswith("Arjun")


def test_diff_explains_changes():
    prev = {"risk_level": "Medium", "risk_score": 55, "stalled": True,
            "signals": [{"code": "BLOCKER_PRICING", "label": "Pricing concern", "weight": 13, "evidence_ids": ["E1"],
                         "detail": "d"}]}
    new = {"risk_level": "Low", "risk_score": 12, "stalled": False, "signals": []}
    changes, summary = compare(prev, new, ["EML-0050"], ["Send revised pricing"])
    kinds = [c["kind"] for c in changes]
    assert kinds[0] == "risk_level"
    assert {"signal_resolved", "stalled", "risk_score", "new_activity", "action_done"} <= set(kinds)
    assert summary.startswith("Risk moved from Medium to Low")
    assert compare(None, new, [], [])[1] == "First analysis of this deal."
