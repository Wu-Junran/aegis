"""Round-trip tests for validator MCP tools."""
from __future__ import annotations

import json

import pytest

from aegis_mcp.tools.validator_tools import dispatch


SOAP_TEMPLATE = {
    "id": "soap",
    "name": "SOAP",
    "sections": [
        {"id": "plan", "title": "Plan", "requiredFields": [], "promptGuidance": ""},
    ],
    "source": "builtin",
}


@pytest.mark.asyncio
async def test_validate_clinical_note_round_trip():
    args = {
        "note": "Start Lisinopril 1000mg daily.",
        "patient_context": {},
        "template": SOAP_TEMPLATE,
        "checks": ["dose"],
    }
    out = await dispatch("validate_clinical_note", args)
    assert len(out) == 1
    payload = json.loads(out[0].text)
    assert isinstance(payload, list)
    assert any(w["check"] == "dose" for w in payload)


@pytest.mark.asyncio
async def test_default_checks_runs_all_five():
    args = {
        "note": "anything",
        "patient_context": {},
        "template": None,
    }
    out = await dispatch("validate_clinical_note", args)
    payload = json.loads(out[0].text)
    assert isinstance(payload, list)


@pytest.mark.asyncio
async def test_unknown_check_raises():
    args = {
        "note": "x", "patient_context": {}, "template": None, "checks": ["foo"],
    }
    with pytest.raises(ValueError):
        await dispatch("validate_clinical_note", args)
