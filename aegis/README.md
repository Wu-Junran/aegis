# Aegis

Claude Code–native clinical documentation agent. Aegis takes structured patient data (FHIR bundles), drafts templated clinical notes (SOAP, discharge summary, progress note, case report) under an enforced PHI-safety middleware layer, and lets a clinician (or researcher) iterate on the draft inside an interactive REPL.

This is a research project. It is **not** an FDA-regulated medical device, **not** HIPAA-certified, and **not** for real-time point-of-care use. Every generated note requires reviewer sign-off via the export flow.

For repository-level docs, see the [top-level README](../README.md) and the [demo guide](../docs/demo-guide.md).

## Prerequisites

- Bun ≥ 1.1 on PATH
- Python ≥ 3.11 on PATH
- An LLM API key — at minimum `ANTHROPIC_API_KEY`

## Quickstart

From the repo root:

```bash
bash aegis/scripts/install.sh
cd aegis && bun run build && ./dist/aegis --phi-mode research
```

Inside the REPL:

```
aegis> /patient load tests/fixtures/synthea_minimal.json
aegis> /template set soap
aegis> Draft a SOAP note for this patient.
aegis> /note export ./notes/visit.md
```

For PDF export and other workflows, see the operator guide.

## Workflows

Aegis ships six tested workflows:

| Workflow | Template | phiMode | Output | Use case |
|---|---|---|---|---|
| A | `soap` | research | markdown | Encounter-initial SOAP note |
| B | `discharge-summary` | research | PDF | Discharge summary, multi-encounter |
| C | `soap` | research | markdown | Research mode, single synthetic case |
| D | `progress-note` | research | markdown | Daily inpatient followup |
| E | `case-report` | research | markdown | Publishable case report (research) |
| F | `soap` | **strict** | markdown | Strict-mode dogfood — exercises the audit-log PHI-leak gate (`run-synthea.ts` Check 6, strict branch) |

A–E each have a corresponding integration test under `aegis/tests/integration/workflow-{a..e}*.test.ts`. F is dogfood-only — exercised solely by `scripts/dogfood/run-synthea.ts` against `tests/cassettes/workflow-f-strict-soap.jsonl`; the strict branch of Check 6 is what proves "no PHI literals leak into the audit log".

## Architecture

The TypeScript half is structured around a Claude Code–derived REPL/runtime with an Aegis-specific medical layer under [`src/medical/`](src/medical/) — PHI middleware (in/out + audit + clinical validator), the de-identification interface, the note-export gate (plus PDF), the template registry, provider adapters, the append-only audit logger, the runtime/PHI-mode wiring, and Ink REPL components. The Python half (`aegis-mcp/`) is a stdio MCP server hosting FHIR parsing, Presidio-backed de-id, Jinja templates, and the 5-check clinical validator. See [`../docs/operator-guide.md`](../docs/operator-guide.md) for the runtime cross-section (audit-log schema, provider matrix, PHI modes, `.aegisrc`).

## Development

```bash
# Typecheck baseline + Biome lint baseline.
bun run check

# Full test suite (unit + integration with cassettes).
AEGIS_REQUIRE_MCP=1 bun run test:ci

# Re-record workflow cassettes against a live LLM (requires ANTHROPIC_API_KEY).
ANTHROPIC_API_KEY=… bun run dogfood:synthea:record

# Replay-only Synthea dogfood (no API spend).
bun run dogfood:synthea
```

The Synthea dogfood runner (`scripts/dogfood/run-synthea.ts`) drives a planted validator-surface canary (Aspirin 50000 mg → ≥1 dose warning) plus six workflows end-to-end (A–E in research mode, F in strict mode) and asserts a post-condition set per workflow: sections present (fence-parsed `filled_sections` matches the template); validator middleware fired (sentinel-reference probe — see `run-synthea.ts`); export OK; file mode 0600; PDF structure (header `%PDF-` + `%%EOF` trailer + ≥1 `/Type /Page` object) on PDF workflows; audit JSONL parses; `note_export_completed` present; and a phiMode-conditioned audit-shape check — **research** workflows pin the `fullRequest` + no-`redactedPayloadHash` contract; **strict** (workflow F) requires ≥1 `llm_request` row, sweeps the audit log for plaintext PHI literals from the bundle, and asserts every `llm_request` lacks `fullRequest`. (Off mode isn't exercised here — `WorkflowSpec.phiMode` is `'strict' | 'research'`, and off mode bypasses the medical LLM audit middleware entirely; see `docs/operator-guide.md`.) The strict workflow is what proves "no PHI literals leak into the audit log"; the research workflows verify the research-mode contract only.

## Layout

```
aegis/
├── src/
│   ├── medical/                   # Aegis-specific TS additions
│   │   ├── middleware/            # PHI in/out + audit + clinical validator
│   │   ├── deid/                  # DeIdentifier interface + MCP-backed impl
│   │   ├── export/                # NoteExportGate + PDF + template renderer
│   │   ├── templates/             # Template type + registry
│   │   ├── providers/             # Adapter + 5 presets + credentials
│   │   ├── audit/                 # Append-only fsync'd JSONL
│   │   ├── runtime/               # phiMode + medicalRuntime + bridges
│   │   ├── repl/                  # Ink components (panel, banner, dialogs)
│   │   ├── state/                 # AppState slices
│   │   ├── adapters/              # InputAdapter + FHIR adapter
│   │   ├── config/                # .aegisrc loader
│   │   ├── prompts/               # Clinical system-prompt overlay
│   │   ├── permissions/           # Medical permission rules
│   │   └── agent/                 # Section parser
│   └── (rest is the upstream Claude Code source, modified narrowly per the design spec)
├── scripts/
│   ├── install.sh                 # One-command install + smoke test
│   ├── dogfood/run-synthea.ts     # Automated Synthea dogfood runner
│   ├── build-workflow-cassettes.ts# Build deterministic cassettes for tests
│   └── …
├── tests/
│   ├── unit/                      # Fast, isolated; >80% coverage on medical/
│   ├── integration/               # Workflows A/B/C/D/E with cassettes
│   ├── cassettes/                 # Recorded LLM responses
│   ├── fixtures/                  # Synthea bundles + curated regression cases
│   └── lib/                       # spawnMcp + cassetteAdapter + workflowHarness
└── README.md                      # this file
```

## Status

This branch tags `v0.9.0` — pre-release. v1.0.0 is gated on Gate B clinician dogfood and clinician-reviewed strict-mode sign-off language. The source is released under [The Unlicense](../LICENSE.md).
