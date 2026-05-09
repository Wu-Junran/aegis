"""Template listing and rendering for aegis-mcp.

Templates are Markdown files with YAML frontmatter under
aegis_mcp/templates/builtin/. Public surface:
  list_builtin_templates() -> list[Template]
  render(template_id, patient_context, filled_sections) -> str
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Literal, NotRequired, TypedDict

import jinja2
import yaml


class TemplateSection(TypedDict):
    id: str
    title: str
    requiredFields: list[str]
    promptGuidance: str


class Template(TypedDict):
    id: str
    name: str
    sections: list[TemplateSection]
    source: Literal["builtin", "user"]
    # Document class. Optional in the YAML frontmatter; loader defaults
    # missing values to "clinical_note" so older templates keep working.
    kind: NotRequired[Literal["clinical_note", "report"]]


_BUILTIN_DIR = Path(__file__).parent / "builtin"


def list_builtin_templates() -> list[Template]:
    templates: list[Template] = []
    for path in sorted(_BUILTIN_DIR.glob("*.md")):
        meta, _ = _split_frontmatter(path.read_text())
        templates.append(_metadata_to_template(meta, source="builtin"))
    return templates


def render(
    template_id: str,
    patient_context: dict[str, Any],
    filled_sections: dict[str, str],
) -> str:
    path = _resolve_template_path(template_id)
    _, body = _split_frontmatter(path.read_text())
    env = jinja2.Environment(
        undefined=jinja2.StrictUndefined,
        autoescape=False,
        keep_trailing_newline=True,
    )
    template = env.from_string(body)
    return template.render(
        patient=patient_context,
        filled_sections=filled_sections,
    )


# -- internals --------------------------------------------------------------


def _resolve_template_path(template_id: str) -> Path:
    path = _BUILTIN_DIR / f"{template_id}.md"
    if not path.exists():
        raise KeyError(f"Unknown template id: {template_id!r}")
    return path


def _split_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    if not text.startswith("---\n"):
        raise ValueError("template file missing YAML frontmatter")
    frontmatter, sep, body = text[4:].partition("\n---\n")
    if not sep:
        raise ValueError("template file frontmatter not terminated with '---'")
    meta = yaml.safe_load(frontmatter) or {}
    return meta, body


def _metadata_to_template(
    meta: dict[str, Any],
    *,
    source: Literal["builtin", "user"],
) -> Template:
    sections: list[TemplateSection] = []
    for s in meta.get("sections", []):
        sections.append(TemplateSection(
            id=s["id"],
            title=s["title"],
            requiredFields=list(s.get("required_fields", [])),
            promptGuidance=str(s.get("prompt_guidance", "")).strip(),
        ))
    raw_kind = meta.get("kind", "clinical_note")
    if raw_kind not in ("clinical_note", "report"):
        raise ValueError(
            f"template {meta.get('id')!r} has invalid kind {raw_kind!r}; "
            "must be 'clinical_note' or 'report'"
        )
    return Template(
        id=meta["id"],
        name=meta["name"],
        sections=sections,
        source=source,
        kind=raw_kind,
    )
