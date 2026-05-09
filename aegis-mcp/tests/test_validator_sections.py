from aegis_mcp.validator.checks.sections import run as run_sections


SOAP_TEMPLATE = {
    "id": "soap",
    "name": "SOAP Note",
    "sections": [
        {"id": "subjective", "title": "Subjective", "requiredFields": [], "promptGuidance": ""},
        {"id": "objective",  "title": "Objective",  "requiredFields": [], "promptGuidance": ""},
        {"id": "assessment", "title": "Assessment", "requiredFields": [], "promptGuidance": ""},
        {"id": "plan",       "title": "Plan",       "requiredFields": [], "promptGuidance": ""},
    ],
    "source": "builtin",
}


def _full_note():
    return (
        "<!-- aegis:section=subjective -->\nA\n<!-- aegis:section=end -->\n"
        "<!-- aegis:section=objective -->\nB\n<!-- aegis:section=end -->\n"
        "<!-- aegis:section=assessment -->\nC\n<!-- aegis:section=end -->\n"
        "<!-- aegis:section=plan -->\nD\n<!-- aegis:section=end -->\n"
    )


def test_all_sections_present_silent():
    assert run_sections(_full_note(), {}, template=SOAP_TEMPLATE) == []


def test_missing_section_warns():
    note = _full_note().replace(
        "<!-- aegis:section=plan -->\nD\n<!-- aegis:section=end -->\n", ""
    )
    warnings = run_sections(note, {}, template=SOAP_TEMPLATE)
    assert len(warnings) == 1
    assert warnings[0]["check"] == "sections"
    assert warnings[0]["evidence"]["section_id"] == "plan"


def test_whitespace_only_section_warns():
    note = _full_note().replace(
        "<!-- aegis:section=plan -->\nD\n<!-- aegis:section=end -->\n",
        "<!-- aegis:section=plan -->\n   \n<!-- aegis:section=end -->\n",
    )
    warnings = run_sections(note, {}, template=SOAP_TEMPLATE)
    assert len(warnings) == 1
    assert warnings[0]["evidence"]["section_id"] == "plan"


def test_no_template_returns_empty():
    assert run_sections("anything", {}, template=None) == []
