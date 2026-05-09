"""Validator check 2 — date consistency.

Extracts dates from the note (ISO-8601, MM/DD/YYYY, Mon DD YYYY) and
warns on any date outside the encounter window.

Window selection (P2#3 fix — matches spec §6.6 "encounter window"):
  1. If `ctx['encounters']` is non-empty, the window is the union of every
     `Encounter.period` (start to end). Open-ended encounters (start only)
     extend `end` to "now". The min/max envelope is then padded by ±3d.
     `evidence['window_source'] = 'encounter'`.
  2. Otherwise fall back to the observation envelope:
     `[min(observations[*].effectiveDateTime) - 3d,
       max(observations[*].effectiveDateTime) + 3d]`.
     `evidence['window_source'] = 'observations'`.
  3. Otherwise (no encounters, no observations) → silent.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

from aegis_mcp.validator.types import Warning

# Note: `\b` is a boundary between non-word and word chars, so dates embedded
# in hyphen-separated version strings (e.g., `release-2026-04-18-alpha`) will
# extract as `2026-04-18`. The `datetime` constructor accepts these because
# they are valid dates; in clinical notes this pattern is essentially absent
# so we do not paper over it here.
_ISO_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})(?:T[\d:]+(?:Z|[+\-]\d{2}:?\d{2})?)?\b")
_US_RE = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b")
_MONTH_RE = re.compile(
    r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b",
    re.IGNORECASE,
)
_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

_FENCE_TOLERANCE = timedelta(days=3)


def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _extract_dates(note: str) -> list[tuple[str, datetime]]:
    out: list[tuple[str, datetime]] = []
    # Time/timezone components captured by _ISO_RE are intentionally discarded:
    # the date check is calendar-date scoped, so we normalize to midnight UTC.
    for m in _ISO_RE.finditer(note):
        try:
            out.append((m.group(0), datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=timezone.utc)))
        except ValueError:
            continue
    for m in _US_RE.finditer(note):
        try:
            out.append((m.group(0), datetime(int(m.group(3)), int(m.group(1)), int(m.group(2)), tzinfo=timezone.utc)))
        except ValueError:
            continue
    for m in _MONTH_RE.finditer(note):
        mon = _MONTHS.get(m.group(1)[:3].lower())
        if mon is None:
            continue
        try:
            out.append((m.group(0), datetime(int(m.group(3)), mon, int(m.group(2)), tzinfo=timezone.utc)))
        except ValueError:
            continue
    return out


def _encounter_window(ctx: dict[str, Any]) -> tuple[datetime, datetime] | None:
    """Window from `Encounter.period` resources. None if no usable encounter."""
    starts: list[datetime] = []
    ends: list[datetime] = []
    now = datetime.now(timezone.utc)
    for e in ctx.get("encounters", []) or []:
        if not isinstance(e, dict):
            continue
        period = e.get("period") or {}
        s = period.get("start")
        en = period.get("end")
        if not isinstance(s, str):
            continue
        try:
            start = _parse_iso(s)
        except ValueError:
            continue
        starts.append(start)
        if isinstance(en, str):
            try:
                ends.append(_parse_iso(en))
            except ValueError:
                ends.append(now)  # malformed end → conservative open window
        else:
            ends.append(now)  # in-progress encounter
    if not starts:
        return None
    return min(starts) - _FENCE_TOLERANCE, max(ends) + _FENCE_TOLERANCE


def _observation_window(ctx: dict[str, Any]) -> tuple[datetime, datetime] | None:
    """Fallback window from observations when no Encounter is available."""
    times: list[datetime] = []
    for o in ctx.get("observations", []) or []:
        if not isinstance(o, dict):
            continue
        s = o.get("effectiveDateTime")
        if not isinstance(s, str):
            continue
        try:
            times.append(_parse_iso(s))
        except ValueError:
            continue
    if not times:
        return None
    return min(times) - _FENCE_TOLERANCE, max(times) + _FENCE_TOLERANCE


def _select_window(ctx: dict[str, Any]) -> tuple[tuple[datetime, datetime], str] | None:
    enc = _encounter_window(ctx)
    if enc is not None:
        return enc, "encounter"
    obs = _observation_window(ctx)
    if obs is not None:
        return obs, "observations"
    return None


def run(note: str, ctx: dict[str, Any]) -> list[Warning]:
    selected = _select_window(ctx)
    if selected is None:
        return []
    (lo, hi), source = selected
    out: list[Warning] = []
    seen: set[str] = set()
    for raw, dt in _extract_dates(note):
        if raw in seen:
            continue
        seen.add(raw)
        if lo <= dt <= hi:
            continue
        out.append(Warning(
            check="dates",
            severity="warn",
            message=(
                f"Date {raw} is outside the encounter window "
                f"[{lo.date()}, {hi.date()}]."
            ),
            evidence={
                "extracted": raw,
                "window_start": lo.date().isoformat(),
                "window_end": hi.date().isoformat(),
                "window_source": source,
            },
        ))
    return out
