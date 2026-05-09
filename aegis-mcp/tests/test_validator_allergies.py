from aegis_mcp.validator.checks.allergies import run as run_allergies


def _ctx_with_penicillin_allergy():
    return {
        "allergies": [
            {
                "code": {
                    "text": "Penicillin",
                    "coding": [{"system": "http://snomed.info/sct", "code": "91936005", "display": "Allergy to penicillin"}],
                }
            }
        ]
    }


def test_amoxicillin_in_plan_with_penicillin_allergy_warns():
    note = (
        "<!-- aegis:section=plan -->\n"
        "Start Amoxicillin 500mg PO TID for 7 days.\n"
        "<!-- aegis:section=end -->\n"
    )
    warnings = run_allergies(note, _ctx_with_penicillin_allergy())
    assert len(warnings) == 1
    assert warnings[0]["check"] == "allergies"
    assert warnings[0]["severity"] == "warn"


def test_unrelated_drug_silent():
    note = (
        "<!-- aegis:section=plan -->\n"
        "Continue Lisinopril 10mg daily.\n"
        "<!-- aegis:section=end -->\n"
    )
    assert run_allergies(note, _ctx_with_penicillin_allergy()) == []


def test_no_plan_section_falls_back_to_full_note():
    note = "Plan: start Amoxicillin 500mg TID."
    warnings = run_allergies(note, _ctx_with_penicillin_allergy())
    assert len(warnings) == 1
