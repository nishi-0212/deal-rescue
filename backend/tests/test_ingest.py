import io

import pandas as pd

from app.services import ingest
from app.services.utils import parse_date, parse_money, parse_percent

from .helpers import SAMPLE, load_sample


def test_money_percent_and_date_parsing():
    assert parse_money("$420,000") == 420000
    assert parse_money("1.2M") == 1_200_000
    assert parse_money("85k") == 85_000
    assert parse_money("abc") is None
    assert parse_percent("90%") == 90
    assert parse_percent("0.4") == 40
    assert parse_percent("140") is None
    assert parse_date("2026-09-16").day == 16
    assert parse_date("16/09/2026").month == 9
    assert parse_date("not a date") is None


def test_column_synonyms_and_kind_detection():
    cols = ["Opportunity ID", "Opportunity Name", "Company", "Amount", "Sales Stage", "Close Date", "Deal Owner"]
    mapping = ingest.map_columns(cols, ingest.DEAL_COLUMNS)
    assert mapping["deal_id"] == "Opportunity ID"
    assert mapping["value"] == "Amount"
    assert mapping["expected_close"] == "Close Date"
    assert ingest.detect_kind(cols) == "deals"
    assert ingest.detect_kind(["Date", "Type", "Notes", "Subject", "Account"]) == "activities"
    assert ingest.detect_kind(["foo", "bar"]) is None


def test_deal_validation_reports_row_errors():
    df = pd.DataFrame({
        "deal_id": ["A-1", "A-2", "A-3", "A-1"],
        "deal_name": ["One", "Two", "Three", "One again"],
        "amount": ["10000", "lots", "5000", "12000"],
        "stage": ["Proposal", "Proposal", "", "Negotiation"],
        "close_date": ["2026-11-01", "2026-11-01", "2026-11-01", "soon"],
    })
    res = ingest.parse_deal_rows(df)
    fields = {(e["row"], e["field"]) for e in res.errors}
    assert (3, "value") in fields          # "lots" is not an amount
    assert (4, "stage") in fields          # missing stage
    assert (5, "expected_close") in fields  # "soon" is not a date
    assert [r["deal_id"] for r in res.records] == ["A-1"]


def test_missing_required_columns():
    res = ingest.parse_deal_rows(pd.DataFrame({"name": ["x"], "foo": ["y"]}))
    assert not res.records
    assert "Missing required column" in res.errors[0]["message"]


def test_contacts_parsing():
    c = ingest.parse_contacts("Ana Ruiz (VP Operations) <ana@x.com>; Marcus Hale - IT Director - marcus@x.com")
    assert c[0] == {"name": "Ana Ruiz", "role": "VP Operations", "email": "ana@x.com"}
    assert c[1]["name"] == "Marcus Hale" and c[1]["role"] == "IT Director" and c[1]["email"] == "marcus@x.com"


def test_sample_dataset_loads_cleanly():
    deals, acts = load_sample()
    assert len(deals) == 12
    assert len(acts) >= 50
    assert all(a["deal_id"] for a in acts)
    nw = [a for a in acts if a["deal_id"] == "DL-1042"]
    assert any(a["type"] == "email" and a["direction"] == "inbound" for a in nw)


def test_document_blocks_headers_and_matching():
    deals, _ = load_sample()
    res = ingest.parse_document((SAMPLE / "northwind_email_thread.txt").read_bytes(), "northwind_email_thread.txt",
                                deals)
    assert res.errors == []
    assert [r["type"] for r in res.records] == ["email", "call", "email"]
    assert res.records[0]["direction"] == "inbound"
    assert res.records[1]["outcome"] == "completed"


def test_document_without_headers_matches_by_account_name():
    deals, _ = load_sample()
    text = b"Date: 2026-10-01\n\nQuick note: Brightline Energy asked for a revised timeline."
    res = ingest.parse_document(text, "note.txt", deals)
    assert res.records[0]["deal_id"] == "DL-1050"


def test_document_errors_are_explained():
    deals, _ = load_sample()
    res = ingest.parse_document(b"Some text about nothing in particular", "random.txt", deals)
    assert not res.records
    assert "No date found" in res.errors[0]["message"]


def test_activity_rows_unmatched_deal():
    deals, _ = load_sample()
    df = pd.DataFrame({"date": ["2026-10-01"], "body": ["hello"], "account": ["Unknown Corp"]})
    res = ingest.parse_activity_rows(df, deals, "x.csv")
    assert res.errors and "match" in res.errors[0]["message"]


def test_excel_upload_with_two_sheets():
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        pd.DataFrame({"Deal ID": ["X-1"], "Amount": ["1000"], "Stage": ["Proposal"], "Owner": ["Sam"]}).to_excel(
            xw, sheet_name="Deals", index=False)
        pd.DataFrame({"Date": ["2026-10-01"], "Deal ID": ["X-1"], "Type": ["email"], "Notes": ["Hi"]}).to_excel(
            xw, sheet_name="Activities", index=False)
    sheets = ingest.read_tables(buf.getvalue(), "pipeline.xlsx")
    assert [ingest.detect_kind(list(df.columns)) for _, df in sheets] == ["deals", "activities"]


def test_rejects_unknown_extension():
    try:
        ingest.extract_text(b"x", "evil.exe")
    except ingest.UploadError:
        return
    raise AssertionError("expected UploadError")
