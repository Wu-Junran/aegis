"""Task 1.6 smoke tests for the empty aegis-mcp server."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from aegis_mcp.server import build_server


def test_server_builds_with_name() -> None:
    server = build_server()
    assert server.name == "aegis-mcp"


@pytest.mark.asyncio
async def test_server_lists_expected_tools_via_stdio() -> None:
    """M2+M4: server advertises FHIR, template, and de-id tools."""
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "aegis_mcp.server"],
        env=None,
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.list_tools()
            names = sorted(t.name for t in result.tools)
            assert names == [
                "deidentify",
                "fhir_load_bundle",
                "fhir_query",
                "list_templates",
                "reidentify",
                "render_template",
                "validate_clinical_note",
            ]
