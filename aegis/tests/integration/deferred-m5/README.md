# Deferred to M5 (multi-provider support)

Tests here are **not picked up by `bun test`** — their filenames end in
`.test.ts.deferred` so they are invisible to the runner.

## Why deferred

Provider work was split across two milestones:

- **M3** — *TS integration: commands + state (Anthropic-only)*. We wire the
  MCP server + the `/patient` / `/template` / `/note` commands to the
  existing Anthropic SDK transport with **no** provider adapter layer,
  credential store, or `/provider` command.
- **M5** — *Multi-provider: state + commands + adapters*. This milestone
  introduces `ProviderAdapter`, `sessionProvider`, `.aegisrc`, a keychain
  credential lifecycle, the `/provider` command, and a two-level `/model`
  picker. Only then are "other models" actually configurable in a
  first-class way; M5.16 is the place where per-provider capability-matrix
  tests live.

A live-call test that hard-codes `claude-haiku-4-5` and reads
`ANTHROPIC_API_KEY` directly from the environment belongs to the M5 test
surface once provider configuration is a concept. In the meantime it
would either (a) make CI depend on a secret, or (b) sit as a skip that
hides real failure modes behind an env-var check. Neither earns its keep.

## Re-enable path (when M5 lands)

1. Move `anthropic-draft-live.test.ts.deferred` back to
   `tests/integration/` and drop the `.deferred` suffix.
2. Replace the hard-coded `new Anthropic({ apiKey: ... })` with the M5
   `ProviderAdapter` lookup (expected: `getSessionProvider()` →
   `dispatchViaProviderAdapter(...)` per spec §5).
3. Parameterize the test over each provider in `M5.16`'s capability matrix
   so the "draft a note via configured model" path runs once per adapter.

Until then, the M3 Definition of Done relies on:

- Layer 1 (hermetic) — `bun test tests/unit tests/integration`.
- Layer 2 (manual smoke) — `/patient load <fixture>` → `/template set soap`
  → type a drafting prompt → observe the REPL streams a SOAP note.

The M5 plan will absorb Layer 2 into an automated cassette/live matrix.
