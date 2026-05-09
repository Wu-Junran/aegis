"""MCP tool handlers for FHIR load + query."""
from __future__ import annotations

import json
from typing import Any

from mcp.types import TextContent, Tool

from aegis_mcp.fhir.parser import parse_bundle
from aegis_mcp.fhir.queries import query


FHIR_TOOL_DESCRIPTORS: list[Tool] = [
    Tool(
        name="fhir_load_bundle",
        description=(
            "Load a FHIR R4 bundle JSON file from disk and return the "
            "extracted PatientContext (patientId, demographics, problems, "
            "medications, allergies, observations, priorNotes, sourceBundlePath)."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Absolute or workspace-relative path to the bundle JSON.",
                }
            },
            "required": ["path"],
            "additionalProperties": False,
        },
    ),
    Tool(
        name="fhir_query",
        description=(
            "Filter a PatientContext for resources of a given type. "
            "Supports optional time_window filter (24h|7d|30d) for Observations. "
            "Note: resource_type='Patient' returns a single-item list with a "
            "derived {patientId, demographics} shape, not a raw FHIR Patient "
            "resource; all other resource_type values return the raw FHIR "
            "resource dicts (with resourceType, id, etc.)."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "context": {
                    "type": "object",
                    "description": "The PatientContext returned by fhir_load_bundle.",
                },
                "resource_type": {
                    "type": "string",
                    "description": (
                        "One of: Patient, Condition, MedicationRequest, "
                        "AllergyIntolerance, Observation, DocumentReference. "
                        "Unknown values produce an isError=True result with "
                        "'Unknown resource_type' in the message — validation "
                        "lives in the Python side to keep a single source of "
                        "truth; the schema intentionally does not use an enum."
                    ),
                },
                "filter": {
                    "type": "object",
                    "description": "Optional filter. Keys: time_window (24h|7d|30d).",
                },
            },
            "required": ["context", "resource_type"],
            "additionalProperties": False,
        },
    ),
]


async def dispatch(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    if name == "fhir_load_bundle":
        ctx = parse_bundle(arguments["path"])
        return [TextContent(type="text", text=json.dumps(ctx))]
    if name == "fhir_query":
        rows = query(
            arguments["context"],
            arguments["resource_type"],
            arguments.get("filter"),
        )
        return [TextContent(type="text", text=json.dumps(rows))]
    raise ValueError(f"Unknown FHIR tool: {name}")
