# aegis-mcp

Python MCP server for Aegis. Speaks stdio, advertises 7 tools used by the TypeScript Aegis client for clinical-document drafting, de-identification, and validation.

## Tools

| Tool | Purpose | Defined in |
|---|---|---|
| `fhir_load_bundle` | Parse a FHIR JSON bundle from disk into a normalized `PatientContext`. | `tools/fhir_tools.py` |
| `fhir_query` | Run a structured query (resource type + filter) against the loaded bundle. | `tools/fhir_tools.py` |
| `list_templates` | Enumerate builtin + user templates. | `tools/template_tools.py` |
| `render_template` | Render a template with `filled_sections` to markdown / final body. | `tools/template_tools.py` |
| `deidentify` | Presidio-backed PHI redaction → placeholders + reversible mapping. | `tools/deid_tools.py` |
| `reidentify` | Inverse of `deidentify` — restore plaintext using the mapping. | `tools/deid_tools.py` |
| `validate_clinical_note` | 5-check clinical validator (dose, dates, labs, allergies, sections). | `tools/validator_tools.py` |

## Builtin templates

Shipped under `src/aegis_mcp/templates/builtin/`:

- `soap.md` — SOAP note (clinical_note)
- `discharge-summary.md` — multi-encounter discharge summary (clinical_note)
- `progress-note.md` — daily inpatient followup (clinical_note)
- `case-report.md` — publishable single-encounter case report (report)

The `kind` field is read by [`templates/renderer.py`](src/aegis_mcp/templates/renderer.py); see [Template doc](../aegis/src/medical/templates/Template.ts) for how the TS client consumes it.

## Development

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest -q tests/
```

`requires-python = ">=3.11"` (see `pyproject.toml`); newer Python 3.x is fine — `aegis/scripts/install.sh` enforces the same floor numerically.

## See also

- [Repository README](../README.md) — overview + safety status
- [Operator guide](../docs/operator-guide.md) — install + audit-log schema + provider matrix
- [Demo guide](../docs/demo-guide.md) — no-spend replay and interactive demo scripts
