"""MCP tool handlers for de-identification."""
from __future__ import annotations

import json
from typing import Any

from mcp.types import TextContent, Tool

from aegis_mcp.deid.base import DeIdentifier
from aegis_mcp.deid.presidio_impl import PresidioDeIdentifier


_singleton: DeIdentifier | None = None


def _get_engine() -> DeIdentifier:
    global _singleton
    if _singleton is None:
        _singleton = PresidioDeIdentifier()
    return _singleton


DEID_TOOL_DESCRIPTORS: list[Tool] = [
    Tool(
        name="deidentify",
        description=(
            "Run rule-based de-identification (Presidio v2.2.x) over a text "
            "blob or array of blobs. Returns {redacted, mapping}. The mapping "
            "uses a shared placeholder pool — the same original token gets "
            "the same placeholder across every blob in one call, so the TS "
            "middleware can call reidentify on the full assembled response."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "text": {
                    "oneOf": [
                        {"type": "string"},
                        {"type": "array", "items": {"type": "string"}},
                    ]
                },
            },
            "required": ["text"],
            "additionalProperties": False,
        },
    ),
    Tool(
        name="reidentify",
        description=(
            "Restore a redacted string using the mapping returned by deidentify. "
            "Longest-placeholder-first replacement avoids prefix collisions."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "text": {"type": "string"},
                "mapping": {"type": "object"},
            },
            "required": ["text", "mapping"],
            "additionalProperties": False,
        },
    ),
]


async def dispatch(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    engine = _get_engine()
    if name == "deidentify":
        result = engine.redact(arguments["text"])
        return [TextContent(type="text", text=json.dumps(result))]
    if name == "reidentify":
        restored = engine.restore(arguments["text"], arguments["mapping"])
        return [TextContent(type="text", text=restored)]
    raise ValueError(f"Unknown deid tool: {name}")
