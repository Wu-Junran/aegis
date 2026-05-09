# Demo Transcript: Synthea Replay

Command:

```bash
cd aegis
bun run dogfood:synthea
```

Representative output shape:

```text
_canary-validator-surface
  validator-canary-fired: dose warnings >= 1

workflow-a-soap
  sections-present
  validator-wiring-fired
  export-ok
  file-mode-0600
  audit-jsonl-parses
  note_export_completed-present
  research:llm_request-shape-consistent

workflow-b-discharge
  sections-present
  pdf-structure
  file-mode-0600
  audit-jsonl-parses

workflow-f-strict-soap
  strict:llm_request-redacted
  strict:no-fullRequest
  strict:no-plaintext-phi-literals
```

Review the appended session block in [`../../docs/dogfood/m6-blockers.md`](../../docs/dogfood/m6-blockers.md) for the exact run evidence.
