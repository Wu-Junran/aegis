"""Validator check 3 — no fabricated labs.

Identifies lab-shaped citations in the note (`<name> (was|of|is|=) <num> <unit>`),
fuzzy-matches the name to a bundle Observation, and warns when no bundle entry
matches within ±5% of the cited numeric value.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

from aegis_mcp.validator.types import Warning

# Liberal lab citation pattern: name (capitalized words / single word) followed by
# was|of|is|=|: then a number with optional decimal, optional unit.
_LAB_RE = re.compile(
    r"\b([A-Z][A-Za-z][A-Za-z\s\-/]{1,40})\s+(?:was|of|is|=|:)\s+(\d+(?:\.\d+)?)\s*([A-Za-z%/μ]+)?",
)
_NAME_FUZZY_THRESHOLD = 0.85
_VALUE_TOLERANCE = 0.05  # ±5%


def _bundle_observations(ctx: dict[str, Any]) -> list[tuple[str, float, str | None]]:
    out: list[tuple[str, float, str | None]] = []
    for o in ctx.get("observations", []) or []:
        if not isinstance(o, dict):
            continue
        names: list[str] = []
        code = o.get("code") or {}
        if isinstance(code.get("text"), str):
            names.append(code["text"])
        for c in code.get("coding") or []:
            if isinstance(c.get("display"), str):
                names.append(c["display"])
        vq = o.get("valueQuantity") or {}
        v = vq.get("value")
        if not names or not isinstance(v, (int, float)):
            continue
        unit = vq.get("unit") if isinstance(vq.get("unit"), str) else None
        # The first name wins for matching; aliases recorded as additional rows
        # so the fuzzy match can succeed against either.
        for n in names:
            out.append((n, float(v), unit))
    return out


def run(note: str, ctx: dict[str, Any]) -> list[Warning]:
    obs = _bundle_observations(ctx)
    if not obs:
        return []
    out: list[Warning] = []
    seen: set[tuple[str, str]] = set()
    for m in _LAB_RE.finditer(note):
        name = m.group(1).strip().rstrip(",.;:")
        try:
            value = float(m.group(2))
        except ValueError:
            continue
        # Match candidate observations by fuzzy name.
        best: tuple[float, float, str] | None = None  # (ratio, bundle_value, bundle_name)
        for bn, bv, _bu in obs:
            r = SequenceMatcher(None, name.lower(), bn.lower()).ratio()
            # Substring containment also counts as a match.
            if (
                name.lower() in bn.lower()
                or bn.lower() in name.lower()
            ):
                r = max(r, 0.95)
            if best is None or r > best[0]:
                best = (r, bv, bn)
        if best is None or best[0] < _NAME_FUZZY_THRESHOLD:
            continue
        _, bundle_value, bundle_name = best
        # Tolerance check.
        if bundle_value == 0:
            within = value == 0
        else:
            within = abs(value - bundle_value) / abs(bundle_value) <= _VALUE_TOLERANCE
        if within:
            continue
        key = (bundle_name, m.group(2))
        if key in seen:
            continue
        seen.add(key)
        out.append(Warning(
            check="labs",
            severity="warn",
            message=(
                f"Cited {name} value {m.group(2)} not present in bundle "
                f"(closest match: {bundle_name} = {bundle_value})."
            ),
            evidence={
                "extracted": m.group(2),
                "extracted_name": name,
                "closest_match": bundle_name,
                "bundle_value": bundle_value,
            },
        ))
    return out
