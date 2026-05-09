"""Contract tests for the deidentify / reidentify MCP tools."""
from __future__ import annotations

import json

import pytest

from aegis_mcp.tools import deid_tools


def test_descriptors_published() -> None:
    names = {d.name for d in deid_tools.DEID_TOOL_DESCRIPTORS}
    assert names == {"deidentify", "reidentify"}


@pytest.mark.asyncio
async def test_deidentify_round_trip() -> None:
    original = "Patient John Doe."
    [redacted_content] = await deid_tools.dispatch("deidentify", {"text": original})
    payload = json.loads(redacted_content.text)
    assert "John Doe" not in payload["redacted"]
    [restored_content] = await deid_tools.dispatch(
        "reidentify",
        {"text": payload["redacted"], "mapping": payload["mapping"]},
    )
    assert restored_content.text == original


@pytest.mark.asyncio
async def test_deidentify_accepts_array() -> None:
    [content] = await deid_tools.dispatch(
        "deidentify",
        {"text": ["John Doe is the patient.", "Discharge John Doe."]},
    )
    payload = json.loads(content.text)
    assert isinstance(payload["redacted"], list)
    assert "John Doe" not in payload["redacted"][0]
    assert "John Doe" not in payload["redacted"][1]


def test_descriptors_lock_down_schemas() -> None:
    by_name = {d.name: d for d in deid_tools.DEID_TOOL_DESCRIPTORS}
    deid = by_name["deidentify"]
    assert deid.inputSchema["additionalProperties"] is False
    assert "oneOf" in deid.inputSchema["properties"]["text"]
    reid = by_name["reidentify"]
    assert reid.inputSchema["additionalProperties"] is False
    assert reid.inputSchema["required"] == ["text", "mapping"]


def test_get_engine_returns_same_instance() -> None:
    assert deid_tools._get_engine() is deid_tools._get_engine()
