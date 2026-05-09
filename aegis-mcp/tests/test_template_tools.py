"""Round-trip tests for template MCP tools via real stdio."""
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
    assert result.content, f"empty content: {result!r}"
    return result.content[0].text


@pytest.mark.asyncio
async def test_list_templates_via_stdio() -> None:
    async with stdio_client(_params()) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool("list_templates", {})
            templates = json.loads(_unpack_text(result))
            ids = sorted(t["id"] for t in templates)
            assert ids == ["case-report", "discharge-summary", "progress-note", "soap"]
            # sections are camelCase
            soap = next(t for t in templates if t["id"] == "soap")
            assert "requiredFields" in soap["sections"][0]


@pytest.mark.asyncio
async def test_render_template_via_stdio() -> None:
    async with stdio_client(_params()) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            ctx_result = await session.call_tool(
                "fhir_load_bundle",
                {"path": str(FIXTURES / "synthea_minimal.json")},
            )
            ctx = json.loads(_unpack_text(ctx_result))
            rendered = await session.call_tool(
                "render_template",
                {
                    "template_id": "soap",
                    "patient_context": ctx,
                    "filled_sections": {
                        "subjective": "s.",
                        "objective": "o.",
                        "assessment": "a.",
                        "plan": "p.",
                    },
                },
            )
            out = _unpack_text(rendered)
            assert "SOAP Note" in out
            assert "John Doe" in out
            assert "p." in out
