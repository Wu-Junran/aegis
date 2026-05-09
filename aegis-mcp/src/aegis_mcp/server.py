"""Aegis MCP server. M2: four FHIR+template tools; dispatched by name."""
from __future__ import annotations

import asyncio
from typing import Any

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

from aegis_mcp.tools import deid_tools, fhir_tools, template_tools, validator_tools


def build_server() -> Server:
    server = Server("aegis-mcp")

    descriptors: list[Tool] = [
        *fhir_tools.FHIR_TOOL_DESCRIPTORS,
        *template_tools.TEMPLATE_TOOL_DESCRIPTORS,
        *deid_tools.DEID_TOOL_DESCRIPTORS,
        *validator_tools.VALIDATOR_TOOL_DESCRIPTORS,
    ]
    fhir_names = {d.name for d in fhir_tools.FHIR_TOOL_DESCRIPTORS}
    template_names = {d.name for d in template_tools.TEMPLATE_TOOL_DESCRIPTORS}
    deid_names = {d.name for d in deid_tools.DEID_TOOL_DESCRIPTORS}
    validator_names = {d.name for d in validator_tools.VALIDATOR_TOOL_DESCRIPTORS}

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        return descriptors

    @server.call_tool()
    async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
        if name in fhir_names:
            return await fhir_tools.dispatch(name, arguments)
        if name in template_names:
            return await template_tools.dispatch(name, arguments)
        if name in deid_names:
            return await deid_tools.dispatch(name, arguments)
        if name in validator_names:
            return await validator_tools.dispatch(name, arguments)
        raise ValueError(f"Unknown tool: {name}")

    return server


async def _run() -> None:
    server = build_server()
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options(),
        )


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
