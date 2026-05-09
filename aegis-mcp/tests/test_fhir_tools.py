"""Round-trip tests for FHIR MCP tools via real stdio."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

FIXTURES = Path(__file__).parent / "fixtures"


def _params() -> StdioServerParameters:
    return StdioServerParameters(
        command=sys.executable,
        args=["-m", "aegis_mcp.server"],
        env=None,
    )


def _unpack_text(result) -> str:
    # result.content is list[TextContent | ...]; we only return TextContent.
    assert result.content, f"empty content: {result!r}"
    return result.content[0].text


@pytest.mark.asyncio
async def test_fhir_load_bundle_via_stdio() -> None:
    async with stdio_client(_params()) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(
                "fhir_load_bundle",
                {"path": str(FIXTURES / "synthea_minimal.json")},
            )
            payload = json.loads(_unpack_text(result))
            assert payload["patientId"] == "pat-001"
            assert len(payload["observations"]) == 2


@pytest.mark.asyncio
async def test_fhir_query_via_stdio() -> None:
    async with stdio_client(_params()) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            loaded = await session.call_tool(
                "fhir_load_bundle",
                {"path": str(FIXTURES / "synthea_minimal.json")},
            )
            ctx = json.loads(_unpack_text(loaded))
            queried = await session.call_tool(
                "fhir_query",
                {"context": ctx, "resource_type": "Condition"},
            )
            rows = json.loads(_unpack_text(queried))
            assert len(rows) == 1
            assert rows[0]["code"]["text"] == "CHF"


@pytest.mark.asyncio
async def test_fhir_query_unknown_resource_type_surfaces_error() -> None:
    async with stdio_client(_params()) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            loaded = await session.call_tool(
                "fhir_load_bundle",
                {"path": str(FIXTURES / "synthea_minimal.json")},
            )
            ctx = json.loads(_unpack_text(loaded))
            result = await session.call_tool(
                "fhir_query",
                {"context": ctx, "resource_type": "NotAResource"},
            )
            # Low-level mcp Server translates exceptions into isError=True with
            # the message in a TextContent.
            assert result.isError is True
            assert "Unknown resource_type" in _unpack_text(result)
