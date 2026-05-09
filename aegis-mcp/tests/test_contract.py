"""Contract test: every M2 tool is advertised and callable.

This is the Layer-2 contract test from spec §8: real stdio, real MCP
process, no boundary mocking. Runs in CI.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

FIXTURES = Path(__file__).parent / "fixtures"

EXPECTED_TOOLS = {
    "fhir_load_bundle",
    "fhir_query",
    "list_templates",
    "render_template",
    "deidentify",
    "reidentify",
    "validate_clinical_note",
}


def _params() -> StdioServerParameters:
    return StdioServerParameters(
        command=sys.executable,
        args=["-m", "aegis_mcp.server"],
        env=None,
    )


def _unpack_text(result) -> str:
    assert result.content, f"empty content: {result!r}"
    return result.content[0].text


@pytest.mark.asyncio
async def test_contract_tool_list_matches_expected() -> None:
    async with stdio_client(_params()) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.list_tools()
            advertised = {t.name for t in result.tools}
            assert advertised == EXPECTED_TOOLS


@pytest.mark.asyncio
async def test_contract_every_tool_round_trips() -> None:
    async with stdio_client(_params()) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            loaded = await session.call_tool(
                "fhir_load_bundle",
                {"path": str(FIXTURES / "synthea_minimal.json")},
            )
            ctx = json.loads(_unpack_text(loaded))
            assert ctx["patientId"] == "pat-001"

            queried = await session.call_tool(
                "fhir_query",
                {"context": ctx, "resource_type": "MedicationRequest"},
            )
            meds = json.loads(_unpack_text(queried))
            assert len(meds) == 1

            listed = await session.call_tool("list_templates", {})
            templates = json.loads(_unpack_text(listed))
            assert len(templates) == 4

            rendered = await session.call_tool(
                "render_template",
                {
                    "template_id": "soap",
                    "patient_context": ctx,
                    "filled_sections": {
                        "subjective": "s", "objective": "o",
                        "assessment": "a", "plan": "p",
                    },
                },
            )
            assert "SOAP Note" in _unpack_text(rendered)
