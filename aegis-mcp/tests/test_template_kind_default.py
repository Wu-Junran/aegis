"""C.2: Python template loader defaults missing kind to clinical_note."""
from __future__ import annotations
from pathlib import Path
import textwrap
import pytest
from aegis_mcp.templates import renderer


def test_loader_defaults_missing_kind_to_clinical_note(tmp_path, monkeypatch):
    template_md = textwrap.dedent("""\
        ---
        id: stub
        name: Stub
        sections:
          - id: s1
            title: S1
            required_fields: []
            prompt_guidance: ""
        ---
        body
        """)
    (tmp_path / "stub.md").write_text(template_md)
    monkeypatch.setattr(renderer, "_BUILTIN_DIR", tmp_path)
    items = renderer.list_builtin_templates()
    assert len(items) == 1
    assert items[0]["kind"] == "clinical_note"


def test_loader_preserves_explicit_report_kind(tmp_path, monkeypatch):
    template_md = textwrap.dedent("""\
        ---
        id: stub
        name: Stub
        kind: report
        sections:
          - id: s1
            title: S1
            required_fields: []
            prompt_guidance: ""
        ---
        body
        """)
    (tmp_path / "stub.md").write_text(template_md)
    monkeypatch.setattr(renderer, "_BUILTIN_DIR", tmp_path)
    items = renderer.list_builtin_templates()
    assert items[0]["kind"] == "report"


def test_loader_rejects_invalid_kind(tmp_path, monkeypatch):
    template_md = textwrap.dedent("""\
        ---
        id: stub
        name: Stub
        kind: bogus
        sections:
          - id: s1
            title: S1
            required_fields: []
            prompt_guidance: ""
        ---
        body
        """)
    (tmp_path / "stub.md").write_text(template_md)
    monkeypatch.setattr(renderer, "_BUILTIN_DIR", tmp_path)
    with pytest.raises(ValueError, match="invalid kind"):
        renderer.list_builtin_templates()
