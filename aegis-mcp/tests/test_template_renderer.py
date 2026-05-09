"""Unit tests for aegis_mcp.templates.renderer."""
from __future__ import annotations

from pathlib import Path

import pytest

from aegis_mcp.fhir.parser import parse_bundle
from aegis_mcp.templates.renderer import list_builtin_templates, render

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def ctx():
    return parse_bundle(str(FIXTURES / "synthea_minimal.json"))


def test_list_builtin_templates_returns_all_four() -> None:
    templates = list_builtin_templates()
    ids = sorted(t["id"] for t in templates)
    assert ids == ["case-report", "discharge-summary", "progress-note", "soap"]
    for t in templates:
        assert t["source"] == "builtin"
        assert isinstance(t["sections"], list) and len(t["sections"]) > 0


def test_soap_metadata_shape_camelcase() -> None:
    templates = list_builtin_templates()
    soap = next(t for t in templates if t["id"] == "soap")
    first = soap["sections"][0]
    assert first["id"] == "subjective"
    assert first["title"] == "Subjective"
    # requiredFields / promptGuidance are camelCase for TS parity
    assert isinstance(first["requiredFields"], list)
    assert isinstance(first["promptGuidance"], str)
    # frontmatter `required_fields` keys must not leak through
    assert "required_fields" not in first


def test_render_soap_fills_every_section(ctx) -> None:
    out = render(
        "soap",
        ctx,
        {
            "subjective": "SOB for 3 days.",
            "objective": "HR 78, BP 128/80.",
            "assessment": "Acute CHF exacerbation.",
            "plan": "Start torsemide 20mg daily.",
        },
    )
    assert "SOB for 3 days." in out
    assert "HR 78" in out
    assert "torsemide" in out
    # Header should interpolate demographics.
    assert "John" in out
    assert "Doe" in out
    assert "1958-03-12" in out


def test_render_unknown_template_raises(ctx) -> None:
    with pytest.raises(KeyError):
        render("not-a-template", ctx, {})


def test_render_missing_filled_section_raises_strict(ctx) -> None:
    """StrictUndefined: if filled_sections omits a section key, rendering must raise."""
    import jinja2
    with pytest.raises(jinja2.UndefinedError):
        render("soap", ctx, {"subjective": "x"})  # missing objective/assessment/plan
