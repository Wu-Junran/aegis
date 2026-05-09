"""Validator orchestrator. Default runs all 5 checks; `checks` filters.

Returns a flat list of warnings sorted by (severity, check) for stable
sign-off-prompt rendering. Severity order: 'warn' before 'info'.
"""
from __future__ import annotations

from typing import Any, Iterable

from aegis_mcp.validator.checks import allergies as c_allergies
from aegis_mcp.validator.checks import dates as c_dates
from aegis_mcp.validator.checks import dose as c_dose
from aegis_mcp.validator.checks import labs as c_labs
from aegis_mcp.validator.checks import sections as c_sections
from aegis_mcp.validator.types import Warning

_ALL = ("dose", "dates", "labs", "allergies", "sections")
_SEV_ORDER = {"warn": 0, "info": 1}


def validate(
    note: str,
    ctx: dict[str, Any],
    *,
    template: dict[str, Any] | None,
    checks: Iterable[str] | None = None,
) -> list[Warning]:
    selected = tuple(checks) if checks is not None else _ALL
    unknown = [c for c in selected if c not in _ALL]
    if unknown:
        raise ValueError(f"Unknown check(s): {unknown}; expected subset of {_ALL}")
    out: list[Warning] = []
    for c in selected:
        if c == "dose":
            out.extend(c_dose.run(note, ctx))
        elif c == "dates":
            out.extend(c_dates.run(note, ctx))
        elif c == "labs":
            out.extend(c_labs.run(note, ctx))
        elif c == "allergies":
            out.extend(c_allergies.run(note, ctx))
        elif c == "sections":
            out.extend(c_sections.run(note, ctx, template=template))
    out.sort(key=lambda w: (_SEV_ORDER.get(w["severity"], 99), w["check"]))
    return out
