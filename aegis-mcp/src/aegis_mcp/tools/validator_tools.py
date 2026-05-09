"""MCP tool handlers for clinical-note validation."""
from __future__ import annotations

import json
from typing import Any

from mcp.types import TextContent, Tool

from aegis_mcp.validator.orchestrator import validate


VALIDATOR_TOOL_DESCRIPTORS: list[Tool] = [
    Tool(
        name="validate_clinical_note",
        description=(
            "Run the v1 clinical-note validator over a drafted note. Returns a "
            "list of non-blocking warnings. Optional `checks` filters to a "
            "subset of ['dose','dates','labs','allergies','sections']; default "
            "runs all 5. `template` is required for the 'sections' check; pass "
            "null when running per-turn (only checks 1-4)."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "note": {"type": "string"},
                "patient_context": {"type": "object"},
                "template": {"type": ["object", "null"]},
                "checks": {
                    "type": "array",
                    "items": {"type": "string"},
                },
            },
            "required": ["note", "patient_context"],
            "additionalProperties": False,
        },
    ),
]


async def dispatch(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    if name == "validate_clinical_note":
        warnings = validate(
            arguments["note"],
            arguments["patient_context"],
            template=arguments.get("template"),
            checks=arguments.get("checks"),
        )
        return [TextContent(type="text", text=json.dumps(warnings))]
    raise ValueError(f"Unknown validator tool: {name}")
