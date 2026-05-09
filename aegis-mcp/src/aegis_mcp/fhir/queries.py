"""Query helpers over a parsed PatientContext.

No re-parsing; operates on the already-extracted lists in PatientContext.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from .parser import PatientContext

_VALID_FILTER_KEYS = {"time_window"}
_TIME_WINDOWS = {
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
}


def query(
    ctx: PatientContext,
    resource_type: str,
    filter: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    filter = filter or {}
    _validate_filter_keys(filter)

    if resource_type == "Patient":
        return [{
            "patientId": ctx["patientId"],
            "demographics": ctx["demographics"],
        }]
    if resource_type == "Condition":
        return list(ctx["problems"])
    if resource_type == "MedicationRequest":
        return list(ctx["medications"])
    if resource_type == "AllergyIntolerance":
        return list(ctx["allergies"])
    if resource_type == "DocumentReference":
        return list(ctx["priorNotes"])
    if resource_type == "Observation":
        obs = list(ctx["observations"])
        window = filter.get("time_window")
        if window is not None:
            obs = _apply_time_window(obs, window)
        return obs

    raise ValueError(f"Unknown resource_type: {resource_type}")


def _validate_filter_keys(filter: dict[str, Any]) -> None:
    unknown = set(filter.keys()) - _VALID_FILTER_KEYS
    if unknown:
        raise ValueError(f"Unknown filter key(s): {sorted(unknown)}")


def _now() -> datetime:
    """Single injection point for the current time. Tests monkeypatch this."""
    return datetime.now(timezone.utc)


def _apply_time_window(obs: list[dict[str, Any]], window: str) -> list[dict[str, Any]]:
    if window not in _TIME_WINDOWS:
        raise ValueError(
            f"Unknown time_window: {window!r}; expected one of {sorted(_TIME_WINDOWS)}"
        )
    cutoff = _now() - _TIME_WINDOWS[window]

    def _within(o: dict[str, Any]) -> bool:
        dt = o.get("effectiveDateTime")
        if not dt:
            return False
        return _parse_fhir_datetime(dt) >= cutoff

    return [o for o in obs if _within(o)]


def _parse_fhir_datetime(s: str) -> datetime:
    # FHIR permits 'YYYY', 'YYYY-MM', 'YYYY-MM-DD', and full datetime with tz.
    # fromisoformat in 3.11+ handles the 'Z' suffix via replacement.
    return datetime.fromisoformat(s.replace("Z", "+00:00"))
