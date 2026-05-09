# Aegis Demo Guide

This guide gives release reviewers a repeatable way to see Aegis without real PHI. Use the no-spend replay demo for routine review. Use live demos only with synthetic or de-identified data unless the strict-mode controls in the operator guide are already in place.

## Demo 1: No-Spend Replay Dogfood

Purpose: prove the end-to-end safety and export path without a live LLM call.

```bash
cd aegis
bun run dogfood:synthea
```

Expected coverage:

- Validator canary fires on planted high-dose medications.
- Workflow A drafts and exports a SOAP note.
- Workflow B drafts and exports a discharge-summary PDF.
- Workflow C verifies research-mode audit shape.
- Workflow D drafts and exports a progress note.
- Workflow E drafts and exports a case report.
- Workflow F exercises strict-mode audit redaction shape.
- Exported files are mode `0600`.
- Audit JSONL parses and contains `note_export_completed`.

The runner also writes a per-run session block to a local log under `docs/dogfood/` if you want to review the run history; that log is local-only and not committed.

## Demo 2: Interactive SOAP Note

Purpose: show the CLI flow a researcher or clinician reviewer will see.

```bash
cd aegis
./dist/aegis --phi-mode research
```

REPL script:

```text
aegis> /patient load tests/fixtures/synthea_minimal.json
aegis> /template set soap
aegis> Draft a SOAP note for this patient. Keep each section concise.
aegis> /note export ./notes/demo-soap.md
aegis> /audit show --tail 5
```

Expected review points:

- Startup banner shows `research`.
- The assistant emits sectioned SOAP content.
- Export prompt uses research-use acknowledgment language.
- The exported file is created with mode `0600`.
- `/audit show` displays recent `llm_request`, `llm_response`, and `note_export_completed` rows.

## Demo 3: Discharge PDF

Purpose: show PDF export and template switching.

```text
aegis> /patient load tests/fixtures/synthea_admission_bundle.json
aegis> /template set discharge-summary
aegis> Build a discharge summary for this admission.
aegis> /note export ./notes/demo-discharge.pdf --format pdf
```

Expected review points:

- The generated PDF opens in a local viewer.
- PDF bytes start with `%PDF-` and end with an EOF trailer.
- The note includes HPI, hospital course, discharge medications, and follow-up sections.

## Demo 4: Case Report Draft

Purpose: show the research-writing workflow.

```text
aegis> /patient load tests/fixtures/synthea_minimal.json
aegis> /template set case-report
aegis> Draft a publishable case report from this encounter.
aegis> /note export ./notes/demo-case-report.md
```

Expected review points:

- The template uses report sections: introduction, presentation, investigations, management, outcome, discussion.
- The export prompt uses research-use acknowledgment language.
- The draft is clearly labeled as a draft and still needs human review.

See [`demos/sample-notes/case-report.md`](../demos/sample-notes/case-report.md) for a short synthetic sample.

## Demo 5: Strict-Mode Safety Shape

Purpose: show the audit-log shape that matters for real-PHI deployments. Use only synthetic data in a public demo.

```bash
cd aegis
bun run dogfood:synthea -- --only workflow-f-strict-soap
```

Expected review points:

- At least one `llm_request` row exists.
- Strict-mode `llm_request` rows have `redactedPayloadHash`.
- Strict-mode `llm_request` rows do not have `fullRequest`.
- The audit sweep finds no plaintext PHI literals from the source bundle.

## Demo Assets

The checked-in demo assets are static, synthetic, and safe to show:

- [`demos/README.md`](../demos/README.md)
- [`demos/transcripts/synthea-replay.md`](../demos/transcripts/synthea-replay.md)
- [`demos/sample-notes/soap-note.md`](../demos/sample-notes/soap-note.md)
- [`demos/sample-notes/case-report.md`](../demos/sample-notes/case-report.md)
