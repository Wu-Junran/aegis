<!--
Thanks for sending a PR. Please confirm the safety items below before
requesting review. Aegis is a clinical-documentation harness — changes
to PHI handling, audit logging, the export gate, providers, or FHIR
ingestion need extra care.
-->

## Summary

<!-- One or two sentences: what changed and why. -->

## Verification

<!-- The commands you ran locally and their outcomes. At minimum:
     cd aegis && bun run check
     AEGIS_REQUIRE_MCP=1 bun run test:ci
     cd ../aegis-mcp && .venv/bin/pytest -q tests/ -->

- [ ] `bun run check` passes
- [ ] `AEGIS_REQUIRE_MCP=1 bun run test:ci` passes
- [ ] `aegis-mcp` `pytest -q tests/` passes
- [ ] (if user-facing) `bun run dogfood:synthea` exercised

## Safety / audit implications

<!-- Touched any of: PHI middleware, audit log shape, export-gate
     attestation, provider dispatch, FHIR ingestion, de-id mapping?
     If yes, describe the impact and any new tests. If no, write "none". -->

## Docs touched

<!-- Updated docs/operator-guide.md / docs/demo-guide.md / package
     READMEs when user-facing workflows changed? -->

## Confirmations

- [ ] No real PHI, patient identifiers, audit logs, `.aegisrc`, or API keys in this PR.
- [ ] Tests use synthetic fixtures only.
- [ ] PHI-mode behavior is unchanged or has explicit tests + operator-guide updates.
