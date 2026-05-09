from aegis_mcp.validator.orchestrator import validate


SOAP_TEMPLATE = {
    "id": "soap",
    "name": "SOAP",
    "sections": [
        {"id": "plan", "title": "Plan", "requiredFields": [], "promptGuidance": ""},
    ],
    "source": "builtin",
}


def test_default_runs_all_five():
    # Construct a note that triggers each check.
    note = (
        "<!-- aegis:section=plan -->\nStart Lisinopril 1000mg daily; "
        "Potassium was 5.4 mmol/L; admitted 2025-01-01; Amoxicillin 500mg.\n"
        "<!-- aegis:section=end -->\n"
    )
    ctx = {
        "observations": [
            {"effectiveDateTime": "2026-04-15T00:00:00Z",
             "code": {"text": "Potassium", "coding": [{"display": "Potassium"}]},
             "valueQuantity": {"value": 4.2, "unit": "mmol/L"}},
        ],
        "allergies": [{"code": {"text": "Penicillin", "coding": []}}],
    }
    warnings = validate(note, ctx, template=SOAP_TEMPLATE)
    checks = {w["check"] for w in warnings}
    assert checks == {"dose", "dates", "labs", "allergies"}  # sections OK (plan present)


def test_subset_filter():
    note = "Lisinopril 1000mg daily."
    warnings = validate(note, {}, template=None, checks=("dose",))
    assert len(warnings) == 1
    assert warnings[0]["check"] == "dose"


def test_unknown_check_raises():
    import pytest
    with pytest.raises(ValueError):
        validate("anything", {}, template=None, checks=("not_a_check",))


def test_returns_sorted_by_severity_then_check():
    note = "Lisinopril 1000mg daily."  # one dose warn
    warnings = validate(note, {}, template=None, checks=("dose", "sections"))
    # All warn; sections has nothing to fire because template=None.
    assert all(w["severity"] == "warn" for w in warnings)
    assert [w["check"] for w in warnings] == ["dose"]
