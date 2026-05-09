"""MCP tool handlers for template listing + rendering."""
from __future__ import annotations

import json
from typing import Any

from mcp.types import TextContent, Tool

from aegis_mcp.templates.renderer import list_builtin_templates, render


TEMPLATE_TOOL_DESCRIPTORS: list[Tool] = [
    Tool(
        name="list_templates",
        description="List all available clinical-note templates (built-in + user).",
        inputSchema={
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    ),
    Tool(
        name="render_template",
        description=(
            "Render a named template with a PatientContext and per-section "
            "filled content. Returns the rendered markdown as a string."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "template_id": {"type": "string"},
                "patient_context": {"type": "object"},
                "filled_sections": {
                    "type": "object",
                    "additionalProperties": {"type": "string"},
                },
            },
            "required": ["template_id", "patient_context", "filled_sections"],
            "additionalProperties": False,
        },
    ),
]


async def dispatch(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    if name == "list_templates":
        templates = list_builtin_templates()
        return [TextContent(type="text", text=json.dumps(templates))]
    if name == "render_template":
        rendered = render(
            arguments["template_id"],
            arguments["patient_context"],
            arguments["filled_sections"],
        )
        return [TextContent(type="text", text=rendered)]
    raise ValueError(f"Unknown template tool: {name}")
