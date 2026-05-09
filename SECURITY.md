# Security Policy

Aegis handles clinical-documentation workflows and must be treated as sensitive even in research mode.

## Supported Versions

| Version | Status |
|---|---|
| `main` | Development branch for security fixes. |
| `0.9.x` | Pre-release research baseline. |

No production support window is promised until a public release is explicitly cut.

## Reporting

Do not report vulnerabilities with real PHI, secrets, or patient records in a public issue.

Use the repository host's private vulnerability reporting flow when available. If that is not available, contact the repository owner through an existing private project channel and include a synthetic reproduction.

Useful reports include:

- Strict-mode audit rows containing plaintext PHI.
- Export paths that bypass attestation or file-mode checks.
- FHIR prompt-injection paths that alter safety instructions.
- Provider or credential paths that expose API keys.
- De-identification, re-identification, or MCP tool-call failures that leak identifiers.

## Handling Sensitive Reproductions

- Reproduce with `aegis/tests/fixtures/` data or another synthetic bundle.
- Redact stack traces before sharing if they include local paths, credentials, audit content, or generated note text.
- Do not upload `~/.aegis/audit/*.jsonl` files unless they were created from synthetic data and reviewed first.
- If a suspected issue involves real PHI, stop the run, preserve local evidence according to your institutional policy, and move the discussion to an approved private incident channel.
