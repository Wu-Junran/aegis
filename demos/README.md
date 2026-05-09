# Aegis Demos

These assets are synthetic and safe for public release review. They are not clinical examples and must not be used for patient care.

## What Is Here

| Path | Purpose |
|---|---|
| [`gifs/aegis-terminal-overview.gif`](gifs/aegis-terminal-overview.gif) | README terminal walkthrough: replay dogfood, research-mode note drafting, export, and audit tail. |
| [`gifs/aegis-strict-audit.gif`](gifs/aegis-strict-audit.gif) | README terminal walkthrough: strict-mode redaction, audit hash shape, export gate, and `0600` write. |
| [`transcripts/synthea-replay.md`](transcripts/synthea-replay.md) | Short transcript for the no-spend replay dogfood demo. |
| [`sample-notes/soap-note.md`](sample-notes/soap-note.md) | Synthetic SOAP note output for a minimal FHIR bundle. |
| [`sample-notes/case-report.md`](sample-notes/case-report.md) | Synthetic case-report draft output for research-demo positioning. |

## Reproduce Locally

```bash
cd aegis
bun run dogfood:synthea
```

For interactive demos, follow [`../docs/demo-guide.md`](../docs/demo-guide.md).

Regenerate the GIFs after changing the demo copy:

```bash
python3 demos/scripts/generate-terminal-gifs.py
```
