"""Tests for the Presidio-backed DeIdentifier."""
from __future__ import annotations

import pytest

from aegis_mcp.deid.presidio_impl import PresidioDeIdentifier


@pytest.fixture(scope="module")
def deid() -> PresidioDeIdentifier:
    return PresidioDeIdentifier()


def test_redacts_person_name(deid: PresidioDeIdentifier) -> None:
    result = deid.redact("Patient John Doe presented with CHF.")
    assert "John Doe" not in result["redacted"]
    assert any(
        e["original"] == "John Doe" and e["type"] == "PERSON"
        for e in result["mapping"]["entries"].values()
    )


def test_round_trip_restores_original(deid: PresidioDeIdentifier) -> None:
    original = "Patient John Doe, MRN 12345678, seen on 2026-04-22."
    r = deid.redact(original)
    restored = deid.restore(r["redacted"], r["mapping"])
    assert restored == original


def test_shared_pool_across_blobs(deid: PresidioDeIdentifier) -> None:
    blobs = [
        "John Doe is the patient.",
        "Speak with John Doe about discharge.",
    ]
    r = deid.redact(blobs)
    assert isinstance(r["redacted"], list)
    # Both blobs should reference the SAME placeholder for "John Doe".
    p0_token = r["redacted"][0].split("is")[0].strip()
    p1_token = r["redacted"][1].split("about")[0].replace("Speak with", "").strip()
    assert p0_token == p1_token
    assert "John Doe" not in r["redacted"][0]
    assert "John Doe" not in r["redacted"][1]


def test_mapping_includes_version(deid: PresidioDeIdentifier) -> None:
    r = deid.redact("Jane Smith")
    assert r["mapping"]["version"].startswith("presidio-")
