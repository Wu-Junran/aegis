"""Validator check 1 — drug dose sanity.

Regex over `<drug-name> <num><unit>` patterns. Looks up each extracted
drug name in `dose_reference.json`; warns when extracted dose ≥ 10×
the reference's `typical_max_mg`. Unknown drugs are silent (whitelist).
Loads the reference on each call to run(); pass `reference_path` to override the default for tests.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from aegis_mcp.validator.types import Warning

_DEFAULT_REFERENCE = (
    Path(__file__).parent.parent.parent / "data" / "dose_reference.json"
)

# `(drug)\s+(num)(unit)` — Title-Case drug names; unit case-insensitive handled
# explicitly via [Uu]nits?.  Two capture branches:
#   group(1): drug matched after a lowercase letter + space (e.g. "Start Lisinopril")
#   group(2): drug matched at start-of-string, after a newline/bullet, period, or colon
# group(3): numeric dose; group(4): unit string.
# The whitelist lookup (ref.get) is the real noise filter for unknown/verb tokens.
_DOSE_RE = re.compile(
    # Case A: drug name preceded by a lowercase letter and whitespace
    r"(?:(?<=[a-z])\s+([A-Z][A-Za-z\-]{2,}(?:\s+[A-Z][A-Za-z\-]+)?)"
    r"|"
    # Case B: drug at start-of-string / after newline (optional bullet) / after period
    # or colon.  Single-word only here to avoid capturing leading verbs like "Start".
    r"(?:(?:^|(?<=\n))\s*-?\s*|(?<=\.)\s+|(?<=:)\s*)([A-Z][A-Za-z\-]{2,}))"
    r"\s+(\d+(?:\.\d+)?)\s*(mg|mcg|g|[Uu]nits?)\b",
)

_UNIT_TO_MG = {
    "mg": 1.0,
    "mcg": 0.001,
    "g": 1000.0,
    "unit": 1.0,   # for insulin / penicillin entries whose typical_max_mg is in units
    "units": 1.0,
}


def _load_reference(path: Path) -> dict[str, dict[str, Any]]:
    raw = json.loads(path.read_text())
    out: dict[str, dict[str, Any]] = {}
    for d in raw["drugs"]:
        canonical = d["name"]
        out[canonical.lower()] = d
        for alias in d.get("aliases", []):
            out[alias.lower()] = d
    return out


def run(
    note: str,
    ctx: dict[str, Any],
    *,
    reference_path: Path | None = None,
) -> list[Warning]:
    ref = _load_reference(reference_path or _DEFAULT_REFERENCE)
    out: list[Warning] = []
    seen: set[tuple[str, float]] = set()
    for match in _DOSE_RE.finditer(note):
        drug_token = (match.group(1) or match.group(2)).strip()
        amount = float(match.group(3))
        unit = match.group(4).lower()
        amount_mg = amount * _UNIT_TO_MG[unit]

        entry = ref.get(drug_token.lower())
        if entry is None:
            continue
        canonical = entry["name"]
        typical = float(entry["typical_max_mg"])
        if typical <= 0:
            continue
        ratio = amount_mg / typical
        if ratio < 10.0:
            continue
        key = (canonical, amount_mg)
        if key in seen:
            continue
        seen.add(key)
        out.append(Warning(
            check="dose",
            severity="warn",
            message=(
                f"{canonical} dose {amount}{unit} is ~{ratio:.0f}× the typical "
                f"max ({typical} mg-equivalent)."
            ),
            evidence={
                "drug": canonical,
                "extracted": f"{amount}{unit}",
                "extracted_mg": amount_mg,
                "typical_max_mg": typical,
                "ratio": ratio,
            },
        ))
    return out
