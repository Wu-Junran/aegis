from aegis_mcp.validator.checks.labs import run as run_labs


def _ctx(*observations):
    return {"observations": list(observations)}


def _obs(name: str, value: float, unit: str):
    return {
        "code": {"text": name, "coding": [{"display": name}]},
        "valueQuantity": {"value": value, "unit": unit},
    }


def test_cited_lab_present_in_bundle_silent():
    ctx = _ctx(_obs("Potassium", 4.2, "mmol/L"))
    note = "Potassium was 4.2 mmol/L at admission."
    assert run_labs(note, ctx) == []


def test_fabricated_lab_warns():
    ctx = _ctx(_obs("Potassium", 4.2, "mmol/L"))
    note = "Potassium was 5.4 mmol/L at admission."  # off by ~28%
    warnings = run_labs(note, ctx)
    assert len(warnings) == 1
    assert warnings[0]["check"] == "labs"
    assert warnings[0]["evidence"]["extracted"] == "5.4"


def test_lab_within_tolerance_silent():
    ctx = _ctx(_obs("Potassium", 4.20, "mmol/L"))
    note = "Potassium was 4.21 mmol/L at admission."  # ~0.2% off, under 5%
    assert run_labs(note, ctx) == []


def test_fuzzy_name_match():
    ctx = _ctx(_obs("Total cholesterol", 210, "mg/dL"))
    note = "Cholesterol was 210 mg/dL."  # close-but-not-exact
    assert run_labs(note, ctx) == []


def test_non_dict_entries_in_observations_are_skipped():
    # Pin the non-dict guard — malformed ctx with non-dict elements must not crash.
    ctx = {
        "observations": [
            None,
            "garbage",
            42,
            {"code": {"text": "Potassium", "coding": [{"display": "Potassium"}]},
             "valueQuantity": {"value": 4.2, "unit": "mmol/L"}},
        ],
    }
    note = "Potassium was 4.2 mmol/L at admission."
    # Should silently skip the bad entries and find the one valid observation,
    # which matches the cited lab so no warning fires.
    assert run_labs(note, ctx) == []
