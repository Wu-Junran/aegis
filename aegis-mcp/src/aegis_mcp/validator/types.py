from __future__ import annotations

from typing import Any, Literal, NotRequired, TypedDict

Severity = Literal["info", "warn"]


class Warning(TypedDict):
    check: str
    severity: Severity
    message: str
    evidence: NotRequired[dict[str, Any]]
