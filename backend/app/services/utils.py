"""Small pure helpers shared by the ingestion and analysis code."""
from __future__ import annotations

import hashlib
import math
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

import pandas as pd

UTC = timezone.utc


def now_utc() -> datetime:
    return datetime.now(UTC)


def norm_header(h: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(h).strip().lower()).strip("_")


def is_blank(v: Any) -> bool:
    if v is None:
        return True
    if isinstance(v, float) and math.isnan(v):
        return True
    return str(v).strip() == "" or str(v).strip().lower() in {"nan", "none", "null", "n/a", "na", "-"}


def clean_str(v: Any, max_len: int = 5000) -> str | None:
    if is_blank(v):
        return None
    s = str(v).strip()
    return s[:max_len]


def parse_money(v: Any) -> float | None:
    """'$420,000', '420k', '1.2M', '420000.00' -> float."""
    if is_blank(v):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().lower().replace(",", "").replace(" ", "")
    s = re.sub(r"^(usd|inr|eur|gbp|rs\.?|₹|\$|€|£)", "", s)
    s = re.sub(r"(usd|inr|eur|gbp)$", "", s)
    mult = 1.0
    if s.endswith("k"):
        mult, s = 1_000.0, s[:-1]
    elif s.endswith("m"):
        mult, s = 1_000_000.0, s[:-1]
    elif s.endswith("cr"):
        mult, s = 10_000_000.0, s[:-2]
    elif s.endswith("l"):
        mult, s = 100_000.0, s[:-1]
    try:
        return float(s) * mult
    except ValueError:
        return None


def parse_percent(v: Any) -> int | None:
    if is_blank(v):
        return None
    s = str(v).strip().replace("%", "")
    try:
        f = float(s)
    except ValueError:
        return None
    if 0 < f <= 1 and "." in s:
        f *= 100
    if f < 0 or f > 100:
        return None
    return int(round(f))


def parse_date(v: Any) -> datetime | None:
    """Parse many date formats into an aware UTC datetime. Returns None if it can't."""
    if is_blank(v):
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=UTC)
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day, tzinfo=UTC)
    if isinstance(v, pd.Timestamp):
        if pd.isna(v):
            return None
        dt = v.to_pydatetime()
        return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
    s = str(v).strip()
    iso = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if iso:
        try:
            return datetime(int(iso[1]), int(iso[2]), int(iso[3]), tzinfo=UTC)
        except ValueError:
            return None
    try:
        dayfirst = bool(re.match(r"^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}", s)) and int(re.split(r"[/.-]", s)[0]) > 12
        ts = pd.to_datetime(s, dayfirst=dayfirst, utc=True, errors="coerce")
    except (ValueError, OverflowError, TypeError):
        return None
    if ts is None or pd.isna(ts):
        return None
    return ts.to_pydatetime()


def as_aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def days_between(a: datetime | None, b: datetime | None) -> int | None:
    a, b = as_aware(a), as_aware(b)
    if a is None or b is None:
        return None
    return max(0, (b - a).days)


def iso_day(dt: datetime | None) -> str | None:
    dt = as_aware(dt)
    return dt.date().isoformat() if dt else None


def fingerprint(*parts: Any) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(str(p if p is not None else "").strip().lower().encode("utf-8"))
        h.update(b"\x1f")
    return h.hexdigest()[:32]


def shift(dt: datetime | None, days: int) -> datetime | None:
    return dt + timedelta(days=days) if dt else None


def norm_key(text: str) -> str:
    """Normalise a title for duplicate detection."""
    words = re.findall(r"[a-z0-9]+", text.lower())
    stop = {"the", "a", "an", "to", "for", "and", "of", "with", "on", "in", "back", "their", "our"}
    return " ".join(w for w in words if w not in stop)[:120]
