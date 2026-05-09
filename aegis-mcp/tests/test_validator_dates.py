from datetime import datetime, timezone

from aegis_mcp.validator.checks.dates import run as run_dates


def _enc(start: str, end: str | None = None) -> dict:
    period = {"start": start}
    if end is not None:
        period["end"] = end
    return {"resourceType": "Encounter", "period": period}


def _ctx_obs_only(*dates: str) -> dict:
    return {
        "encounters": [],
        "observations": [
            {"effectiveDateTime": d}
            for d in dates
        ],
    }


def _ctx_enc(*encounters: dict) -> dict:
    return {"encounters": list(encounters), "observations": []}


def test_date_inside_encounter_window_silent():
    # Encounter.period is the primary window; observations are NOT consulted.
    ctx = _ctx_enc(_enc("2026-04-15T08:00:00Z", "2026-04-20T18:00:00Z"))
    note = "Patient seen on 2026-04-18 in clinic."
    assert run_dates(note, ctx) == []


def test_date_outside_encounter_window_warns():
    ctx = _ctx_enc(_enc("2026-04-15T08:00:00Z", "2026-04-20T18:00:00Z"))
    note = "Earlier admission 2025-11-01 was uneventful."
    warnings = run_dates(note, ctx)
    assert len(warnings) == 1
    assert warnings[0]["check"] == "dates"
    assert warnings[0]["severity"] == "warn"
    assert "2025-11-01" in warnings[0]["evidence"]["extracted"]
    # The fence reflects the Encounter.period, not an observation envelope.
    assert warnings[0]["evidence"]["window_source"] == "encounter"


def test_open_ended_encounter_uses_start_only():
    # Encounter with no `end` (still in progress) → window is [start-3d, today+3d].
    ctx = _ctx_enc(_enc("2026-04-15T08:00:00Z"))
    note = "Today's exam at 2026-04-16 was unremarkable."
    assert run_dates(note, ctx) == []


def test_falls_back_to_observation_envelope_when_no_encounter():
    # P2#3 fallback path: parser-only, encounter list empty → use observations.
    ctx = _ctx_obs_only("2026-04-15T10:30:00Z", "2026-04-20T09:00:00Z")
    note = "Patient seen on 2026-04-18 in clinic."
    assert run_dates(note, ctx) == []
    note_far = "Earlier admission 2025-11-01 was uneventful."
    warnings = run_dates(note_far, ctx)
    assert len(warnings) == 1
    assert warnings[0]["evidence"]["window_source"] == "observations"


def test_no_window_silent():
    note = "Patient seen on 2026-04-18."
    assert run_dates(note, ctx={"encounters": [], "observations": []}) == []


def test_us_format_recognized():
    ctx = _ctx_enc(_enc("2026-04-15T08:00:00Z", "2026-04-20T18:00:00Z"))
    note = "Follow-up scheduled 11/01/2025."
    warnings = run_dates(note, ctx)
    assert len(warnings) == 1


def test_duplicate_date_string_dedupes_to_one_warning():
    # Pin Fix 2 — the same out-of-window date appearing twice in a note
    # must produce exactly one warning, not one per occurrence.
    ctx = _ctx_enc(_enc("2026-04-15T08:00:00Z", "2026-04-20T18:00:00Z"))
    note = "Earlier admission 2025-11-01 was uneventful; revisit 2025-11-01 followup."
    warnings = run_dates(note, ctx)
    assert len(warnings) == 1
    assert warnings[0]["evidence"]["extracted"] == "2025-11-01"


def test_non_dict_entries_in_lists_are_skipped():
    # Pin Fix 1 — a malformed ctx with non-dict elements must not crash.
    ctx = {
        "encounters": [None, "garbage", {"period": {"start": "2026-04-15T08:00:00Z", "end": "2026-04-20T18:00:00Z"}}],
        "observations": [None, 42],
    }
    note = "Seen 2026-04-18 in clinic."
    # Should silently take the one valid encounter window and find the date inside it.
    assert run_dates(note, ctx) == []
