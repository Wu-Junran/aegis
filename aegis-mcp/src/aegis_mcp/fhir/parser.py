"""FHIR R4B bundle parser. Produces a PatientContext mirroring the TS type.

Public surface:
  parse_bundle(path) -> PatientContext
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, NotRequired, TypedDict

from fhir.resources.R4B.bundle import Bundle


class PatientContext(TypedDict):
    patientId: str
    demographics: dict[str, Any]
    problems: list[dict[str, Any]]
    medications: list[dict[str, Any]]
    allergies: list[dict[str, Any]]
    observations: list[dict[str, Any]]
    encounters: list[dict[str, Any]]   # NEW (Task 6.3, P2#3 fix)
    priorNotes: list[dict[str, Any]]
    sourceBundlePath: NotRequired[str]


def parse_bundle(path: str) -> PatientContext:
    data = json.loads(Path(path).read_text())
    # Schema-validate against FHIR R4B; raises on malformed input.
    Bundle.model_validate(data)

    patient: dict[str, Any] | None = None
    problems: list[dict[str, Any]] = []
    medications: list[dict[str, Any]] = []
    allergies: list[dict[str, Any]] = []
    observations: list[dict[str, Any]] = []
    encounters: list[dict[str, Any]] = []
    prior_notes: list[dict[str, Any]] = []

    for entry in data.get("entry", []):
        res = entry.get("resource", {})
        rtype = res.get("resourceType")
        if rtype == "Patient" and patient is None:
            patient = res
        elif rtype == "Condition":
            problems.append(res)
        elif rtype == "MedicationRequest":
            medications.append(res)
        elif rtype == "AllergyIntolerance":
            allergies.append(res)
        elif rtype == "Observation":
            observations.append(res)
        elif rtype == "Encounter":
            encounters.append(res)
        elif rtype == "DocumentReference":
            prior_notes.append(res)

    if patient is None:
        raise ValueError(f"No Patient resource found in bundle: {path}")

    demographics: dict[str, Any] = {
        "name": patient.get("name"),
        "gender": patient.get("gender"),
        "birthDate": patient.get("birthDate"),
    }

    return PatientContext(
        patientId=patient["id"],
        demographics=demographics,
        problems=problems,
        medications=medications,
        allergies=allergies,
        observations=observations,
        encounters=encounters,
        priorNotes=prior_notes,
        sourceBundlePath=str(Path(path).resolve()),
    )
