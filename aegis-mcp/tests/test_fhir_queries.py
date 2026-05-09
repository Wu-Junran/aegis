"""Unit tests for aegis_mcp.fhir.queries.query()."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from aegis_mcp.fhir.parser import parse_bundle
from aegis_mcp.fhir.queries import query

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def ctx():
    return parse_bundle(str(FIXTURES / "synthea_minimal.json"))


def test_query_condition_returns_all_conditions(ctx) -> None:
    results = query(ctx, "Condition")
    assert len(results) == 1
    assert results[0]["resourceType"] == "Condition"


def test_query_medication_request(ctx) -> None:
    results = query(ctx, "MedicationRequest")
    assert len(results) == 1


def test_query_observation_no_filter_returns_all(ctx) -> None:
    results = query(ctx, "Observation")
    assert len(results) == 2


def test_query_observation_time_window_24h_excludes_old(ctx, monkeypatch) -> None:
    """Fixture has one obs from 2026-04-15 and one from 2026-03-20.
    With now pinned to 2026-04-16, 24h window contains just obs-001."""
    import aegis_mcp.fhir.queries as q
    frozen = datetime(2026, 4, 16, 10, 30, tzinfo=timezone.utc)
    monkeypatch.setattr(q, "_now", lambda: frozen)
    results = query(ctx, "Observation", {"time_window": "24h"})
    ids = [r["id"] for r in results]
    assert ids == ["obs-001"]


def test_query_observation_time_window_30d_includes_both(ctx, monkeypatch) -> None:
    import aegis_mcp.fhir.queries as q
    frozen = datetime(2026, 4, 16, 10, 30, tzinfo=timezone.utc)
    monkeypatch.setattr(q, "_now", lambda: frozen)
    results = query(ctx, "Observation", {"time_window": "30d"})
    ids = sorted(r["id"] for r in results)
    assert ids == ["obs-001", "obs-002"]


def test_query_unknown_resource_type_raises(ctx) -> None:
    with pytest.raises(ValueError, match="Unknown resource_type"):
        query(ctx, "DiagnosticReport")  # type: ignore[arg-type]


def test_query_unknown_filter_key_raises(ctx) -> None:
    with pytest.raises(ValueError, match="Unknown filter"):
        query(ctx, "Observation", {"bogus_key": "x"})


def test_query_unknown_time_window_raises(ctx) -> None:
    with pytest.raises(ValueError, match="time_window"):
        query(ctx, "Observation", {"time_window": "99h"})


def test_query_patient_returns_demographics_row(ctx) -> None:
    """Query for Patient returns a single-item list with a dict that contains at
    least patientId+demographics, convenient for agent-side access."""
    results = query(ctx, "Patient")
    assert len(results) == 1
    assert results[0]["patientId"] == "pat-001"
    assert results[0]["demographics"]["gender"] == "male"
