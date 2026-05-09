# Contributing

Aegis is a pre-release research codebase. Contributions should preserve the medical safety boundary and the runtime/PHI-mode invariants documented in the operator guide.

## Ground Rules

- Do not commit real PHI, patient identifiers, secrets, API keys, local `.aegisrc` files, audit logs, or generated note exports.
- Use only synthetic or already de-identified fixtures in tests, demos, issues, and pull requests.
- Keep strict-mode safety behavior conservative. Changes to PHI handling, audit logging, export attestation, provider dispatch, or FHIR ingestion need focused tests and operator-doc updates.
- Preserve the split between `aegis/` TypeScript runtime behavior and `aegis-mcp/` Python MCP tooling.

## Setup

From the repository root:

```bash
bash aegis/scripts/install.sh
```

Manual setup:

```bash
cd aegis-mcp
python3.11 -m venv .venv
.venv/bin/pip install -e ".[dev]"

cd ../aegis
bun install
bun run build
```

## Test Commands

Run focused checks before opening a pull request:

```bash
cd aegis
bun run check
AEGIS_REQUIRE_MCP=1 bun run test:ci

cd ../aegis-mcp
.venv/bin/pytest -q tests/
```

Run the no-spend end-to-end demo:

```bash
cd aegis
bun run dogfood:synthea
```

## Pull Requests

Pull requests should include:

- A short description of the behavior or documentation changed.
- The verification commands run and their outcomes.
- Any safety, audit-schema, PHI-mode, or provider behavior implications.
- Updates to [`docs/operator-guide.md`](docs/operator-guide.md), [`docs/demo-guide.md`](docs/demo-guide.md), or package READMEs when user-facing workflows change.

Do not attach real clinical records, real audit logs, screenshots containing identifiers, or provider credentials.
