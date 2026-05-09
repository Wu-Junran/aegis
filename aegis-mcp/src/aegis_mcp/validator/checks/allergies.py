"""Validator check 4 — allergy cross-check.

Walks the Plan / final section of the note for medication mentions and
cross-checks against `ctx['allergies']`. Section detection prefers the
HTML-comment fences emitted by the TS section parser; falls back to
the last `## Plan` markdown heading; falls back to the full note.
"""
from __future__ import annotations

import json
import re
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from aegis_mcp.validator.types import Warning

_DEFAULT_REFERENCE = (
    Path(__file__).parent.parent.parent / "data" / "dose_reference.json"
)

_FENCE_RE = re.compile(
    r"<!--\s*aegis:section=plan\s*-->(.*?)<!--\s*aegis:section=end\s*-->",
    re.DOTALL | re.IGNORECASE,
)
_PLAN_HEADING_RE = re.compile(r"##\s+Plan\b(.*)", re.DOTALL | re.IGNORECASE)

# Cross-class allergy reactivity table — extend as fixtures demand.
# Key: allergy substance lower-cased; values: drug names whose use should warn.
_REACTIVITY: dict[str, set[str]] = {
    "penicillin": {"amoxicillin", "ampicillin", "penicillin g", "piperacillin"},
    "sulfa": {"sulfamethoxazole", "trimethoprim/sulfa", "tmp-smx"},
    "nsaid": {"ibuprofen", "naproxen", "ketorolac", "aspirin"},
    "aspirin": {"aspirin", "asa"},
}


def _load_drug_names(path: Path) -> list[str]:
    raw = json.loads(path.read_text())
    out: list[str] = []
    for d in raw["drugs"]:
        out.append(d["name"])
        out.extend(d.get("aliases", []))
    return out


def _plan_text(note: str) -> str:
    m = _FENCE_RE.search(note)
    if m:
        return m.group(1)
    m2 = _PLAN_HEADING_RE.search(note)
    if m2:
        return m2.group(1)
    return note  # fallback


def _allergy_terms(ctx: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for a in ctx.get("allergies", []) or []:
        if not isinstance(a, dict):
            continue
        code = a.get("code") or {}
        if isinstance(code.get("text"), str):
            out.append(code["text"])
        for c in code.get("coding") or []:
            if isinstance(c.get("display"), str):
                out.append(c["display"])
    return out


def _normalize(s: str) -> str:
    return s.lower().replace("allergy to ", "").strip()


def run(
    note: str,
    ctx: dict[str, Any],
    *,
    reference_path: Path | None = None,
) -> list[Warning]:
    allergies = [_normalize(t) for t in _allergy_terms(ctx)]
    if not allergies:
        return []
    plan = _plan_text(note).lower()
    drug_names = _load_drug_names(reference_path or _DEFAULT_REFERENCE)
    drugs_in_plan: list[str] = []
    for name in drug_names:
        if re.search(rf"\b{re.escape(name.lower())}\b", plan):
            drugs_in_plan.append(name)

    out: list[Warning] = []
    seen: set[tuple[str, str]] = set()
    for allergy in allergies:
        related = _REACTIVITY.get(allergy, {allergy})
        for d in drugs_in_plan:
            if d.lower() not in related and SequenceMatcher(None, d.lower(), allergy).ratio() < 0.85:
                continue
            key = (allergy, d)
            if key in seen:
                continue
            seen.add(key)
            out.append(Warning(
                check="allergies",
                severity="warn",
                message=(
                    f"Plan includes {d}, but patient has documented allergy: "
                    f"{allergy}."
                ),
                evidence={"drug": d, "allergy": allergy},
            ))
    return out
