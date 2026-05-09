from pathlib import Path

from aegis_mcp.validator.checks.dose import run as run_dose

FIXTURE = Path(__file__).parent / "fixtures" / "dose_reference_subset.json"


def test_known_drug_under_typical_is_silent():
    note = "Continue Lisinopril 10mg daily."
    warnings = run_dose(note, ctx={}, reference_path=FIXTURE)
    assert warnings == []


def test_known_drug_at_10x_warns():
    note = "Start Lisinopril 1000mg daily."  # 12.5× typical_max_mg=80
    warnings = run_dose(note, ctx={}, reference_path=FIXTURE)
    assert len(warnings) == 1
    w = warnings[0]
    assert w["check"] == "dose"
    assert w["severity"] == "warn"
    assert "1000" in w["message"]
    assert w["evidence"]["drug"] == "Lisinopril"


def test_unknown_drug_silent():
    note = "Begin AcmeNewDrug 999mg twice daily."
    warnings = run_dose(note, ctx={}, reference_path=FIXTURE)
    assert warnings == []


def test_alias_resolves():
    note = "Add Prinivil 1000mg daily."  # alias for Lisinopril
    warnings = run_dose(note, ctx={}, reference_path=FIXTURE)
    assert len(warnings) == 1
    assert warnings[0]["evidence"]["drug"] == "Lisinopril"


def test_mcg_to_mg_normalization():
    # Levothyroxine typical_max_mg=0.3 (= 300 mcg). 5000 mcg = 5 mg = ~17×.
    note = "Start Levothyroxine 5000mcg daily."
    warnings = run_dose(note, ctx={}, reference_path=FIXTURE)
    assert len(warnings) == 1
    assert warnings[0]["check"] == "dose"


def test_drug_at_start_of_note_warns():
    note = "Lisinopril 1000mg daily."
    warnings = run_dose(note, ctx={}, reference_path=FIXTURE)
    assert len(warnings) == 1
    assert warnings[0]["evidence"]["drug"] == "Lisinopril"


def test_drug_after_period_warns():
    note = "Patient stable. Lisinopril 1000mg daily."
    warnings = run_dose(note, ctx={}, reference_path=FIXTURE)
    assert len(warnings) == 1
    assert warnings[0]["evidence"]["drug"] == "Lisinopril"


def test_drug_after_newline_warns():
    note = "Medications:\nLisinopril 1000mg daily."
    warnings = run_dose(note, ctx={}, reference_path=FIXTURE)
    assert len(warnings) == 1
    assert warnings[0]["evidence"]["drug"] == "Lisinopril"


def test_drug_after_bullet_warns():
    note = "- Lisinopril 1000mg daily.\n- Levothyroxine 5000mcg daily."
    warnings = run_dose(note, ctx={}, reference_path=FIXTURE)
    assert len(warnings) == 2
    drugs = sorted(w["evidence"]["drug"] for w in warnings)
    assert drugs == ["Levothyroxine", "Lisinopril"]
