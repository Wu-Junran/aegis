"""Validator check 5 — missing required template sections.

Parses the note for HTML-comment-fenced sections and warns when any
template section is absent or whitespace-only. Run only at the export
gate; per-turn delivery would fire spuriously on partial drafts.
"""
from __future__ import annotations

import re
from typing import Any

from aegis_mcp.validator.types import Warning

_FENCE_RE = re.compile(
    r"<!--\s*aegis:section=([a-zA-Z0-9_\-]+)\s*-->(.*?)<!--\s*aegis:section=end\s*-->",
    re.DOTALL,
)


def _filled_sections(note: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for m in _FENCE_RE.finditer(note):
        sid = m.group(1)
        if sid == "end":
            continue
        # Last writer wins if a section appears twice.
        out[sid] = m.group(2)
    return out


def run(
    note: str,
    ctx: dict[str, Any],
    *,
    template: dict[str, Any] | None,
) -> list[Warning]:
    if template is None:
        return []
    filled = _filled_sections(note)
    out: list[Warning] = []
    for s in template.get("sections", []) or []:
        if not isinstance(s, dict):
            continue
        sid = s.get("id")
        if not isinstance(sid, str):
            continue
        body = filled.get(sid, "")
        if body.strip():
            continue
        title = s.get("title") or sid
        out.append(Warning(
            check="sections",
            severity="warn",
            message=f"Required section '{title}' is missing or empty.",
            evidence={"section_id": sid, "section_title": title},
        ))
    return out
