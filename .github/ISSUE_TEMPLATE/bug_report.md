---
name: Bug report
about: Report a reproducible defect in Aegis using synthetic data only.
title: "[bug] "
labels: bug
---

<!--
Aegis handles clinical-documentation workflows. Do not paste real PHI,
patient names, MRNs, audit logs, exported notes, API keys, or
`.aegisrc` files. If the bug only reproduces against real data, follow
the private vulnerability flow described in SECURITY.md instead.
-->

## What happened

<!-- Plain-language description of the defect. -->

## How to reproduce

1.
2.
3.

Synthetic input used (e.g. `aegis/tests/fixtures/synthea_minimal.json`):

```
```

## Expected vs actual

- **Expected:**
- **Actual:**

## Environment

- Aegis version / commit:
- OS:
- Bun version (`bun --version`):
- Python version (`python3.11 --version`):
- PHI mode (`strict` / `research` / `off`):
- Provider:

## Logs / output

<!-- Redact any path, credential, or generated note text before pasting.
     If it includes real PHI, do not paste it here. -->

```
```

## Confirmations

- [ ] Reproduction uses synthetic / de-identified data only.
- [ ] No API keys or audit-log content included.
