"""Unit tests for aegis_mcp.fhir.parser."""
from __future__ import annotations

from pathlib import Path

import pytest

from aegis_mcp.fhir.parser import parse_bundle

FIXTURES = Path(__file__).parent / "fixtures"
MINIMAL = FIXTURES / "synthea_minimal.json"
NO_MEDS = FIXTURES / "synthea_no_meds.json"


def test_parse_bundle_returns_patient_context_shape() -> None:
    ctx = parse_bundle(str(MINIMAL))
    assert set(ctx.keys()) >= {
        "patientId", "demographics", "problems",
        "medications", "allergies", "observations",
        "encounters", "priorNotes", "sourceBundlePath",
    }


def test_parse_bundle_extracts_patient_id() -> None:
    ctx = parse_bundle(str(MINIMAL))
    assert ctx["patientId"] == "pat-001"


def test_parse_bundle_extracts_demographics() -> None:
    ctx = parse_bundle(str(MINIMAL))
    assert ctx["demographics"]["gender"] == "male"
    assert ctx["demographics"]["birthDate"] == "1958-03-12"
    assert ctx["demographics"]["name"][0]["family"] == "Doe"


def test_parse_bundle_extracts_one_condition() -> None:
    ctx = parse_bundle(str(MINIMAL))
    assert len(ctx["problems"]) == 1
    assert ctx["problems"][0]["code"]["text"] == "CHF"


def test_parse_bundle_extracts_one_medication() -> None:
    ctx = parse_bundle(str(MINIMAL))
    assert len(ctx["medications"]) == 1
    assert ctx["medications"][0]["status"] == "active"


def test_parse_bundle_extracts_one_allergy() -> None:
    ctx = parse_bundle(str(MINIMAL))
    assert len(ctx["allergies"]) == 1
    assert ctx["allergies"][0]["code"]["text"] == "Penicillin"


def test_parse_bundle_extracts_two_observations() -> None:
    ctx = parse_bundle(str(MINIMAL))
    assert len(ctx["observations"]) == 2


def test_parse_bundle_returns_empty_lists_for_absent_types() -> None:
    ctx = parse_bundle(str(NO_MEDS))
    assert ctx["patientId"] == "pat-002"
    assert ctx["medications"] == []
    assert ctx["problems"] == []
    assert ctx["allergies"] == []
    assert len(ctx["observations"]) == 1


def test_parse_bundle_records_source_path_as_absolute() -> None:
    ctx = parse_bundle(str(MINIMAL))
    assert Path(ctx["sourceBundlePath"]).is_absolute()
    assert ctx["sourceBundlePath"].endswith("synthea_minimal.json")


def test_parse_bundle_raises_when_no_patient() -> None:
    """A bundle with zero Patient resources is unusable; raise explicitly."""
    import json, tempfile
    empty = {"resourceType": "Bundle", "type": "collection", "entry": []}
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(empty, f)
        path = f.name
    with pytest.raises(ValueError, match="No Patient"):
        parse_bundle(path)


def test_parse_bundle_collects_encounter_resources() -> None:
    # Use the existing Synthea fixture; assert it now exposes encounters[*].period.
    ctx = parse_bundle(str(MINIMAL))
    assert isinstance(ctx["encounters"], list)
    assert len(ctx["encounters"]) >= 1
    e = ctx["encounters"][0]
    assert "period" in e
    # Synthea always emits start; end may be missing for in-progress
    # encounters but is present for the closed visits we use as fixtures.
    assert "start" in e["period"]


def test_parse_bundle_raises_on_invalid_fhir() -> None:
    """Invalid schema must surface early, not silently produce junk."""
    import json, tempfile
    bad = {"resourceType": "NotABundle"}
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(bad, f)
        path = f.name
    with pytest.raises(Exception):
        parse_bundle(path)
