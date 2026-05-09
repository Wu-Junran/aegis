# Changelog

All notable changes to Aegis are documented here. Format adapted from [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) (minimal, forward-only — no M1–M6 backfill).

## [0.9.0] — 2026-05-09 — Pre-release baseline

### Added
- `Template.kind` field (`'clinical_note' | 'report'`) on TS type and Python TypedDict; missing values default to `'clinical_note'` at the registry boundary.
- Built-in `progress-note` template (clinical, SOAP-shape sections) for daily inpatient documentation.
- Built-in `case-report` template (research, paper-shape sections) for publishable single-encounter case reports.
- Workflow D (progress-note) and Workflow E (case-report) integration tests, with deterministic cassettes built via `scripts/build-workflow-cassettes.ts`.
- `attestation_kind` field (`'clinical' | 'research_use'`) on `note_export_intent`, `note_export_completed`, and `note_export_declined` audit entries — distinguishes clinical-attestation from research-use acknowledgment.
- `aegis/scripts/dogfood/run-synthea.ts` — automated Synthea dogfood runner. Drives a planted validator-surface canary plus six workflows end-to-end (A–E in research mode, F in strict mode), asserts a per-workflow post-condition set (sections present, validator wiring fired via sentinel-reference probe, export OK, file mode 0600, PDF structure on PDF workflows, audit JSONL parses, `note_export_completed` present, mode-conditioned audit-shape check), and appends a per-run timestamped session entry to a local dogfood log.
- `dogfood:synthea` and `dogfood:synthea:record` package.json scripts.
- `aegis/scripts/install.sh` — one-command, idempotent install + smoke test.
- `docs/operator-guide.md` — install, `.mcp.json` + venv layout, audit log schema, provider matrix + trust model + `.aegisrc` reference.
- Top-level `CHANGELOG.md` (this file).
- Repository-level publish-readiness docs: top-level README, contributing guide, security policy, code of conduct, demo guide, and synthetic demo assets.
- `.github/` PR template and bug/feature issue templates.
- Root `.env.example` enumerating the env vars Aegis reads.
- npm-installable CLI release: `aegis/dist/npm/aegis-cli-0.9.0.tgz` (3.7 MB) — bundled CLI with vendor stubs and runtime deps wired up so `npm install -g aegis-cli` produces a working `aegis` command. Sourcemap excluded by default; pass `--include-sourcemap` to `package-npm.ts` for a debug build.
- This pre-release baseline tag (`v0.9.0`).

### Changed
- Released under [The Unlicense](LICENSE.md). `aegis-cli/package.json` SPDX `license` is `Unlicense` and `private: true` is removed; `aegis-mcp/pyproject.toml` carries the same SPDX identifier.
- npm package renamed `aegis` → `aegis-cli` (the `aegis` name was already taken on public npm). The shipped command is still `aegis`.
- CLI program name and `--version` output rebranded from "Claude Code" to "Aegis" on the primary `--help` and `--version` paths.
- README quickstart now documents two install paths: from-source (`bash aegis/scripts/install.sh`) and npm (`npm install -g aegis-cli` plus a manual Python venv for `aegis-mcp`).
- Corrected npm packaging helper and build macro metadata so generated packages use the Aegis name/bin/license/feedback posture instead of stale Claude Code defaults; the helper now declares the bundle's runtime externals as `dependencies` / `optionalDependencies` and ships `vendor-stubs/` for non-public-npm packages.
- Reduced the public doc set to user-facing material — internal specs, plans, dogfood logs, and the publishing-prep checklist are no longer tracked.
- Build-baseline counts (`biome-count.txt`, `tsc-count.txt`) moved from `docs/superpowers/plans/` to `aegis/scripts/baselines/` so the lint/typecheck gates work on a fresh clone.
- CI installs the `en_core_web_sm` spaCy model so Presidio NER paths exercise the same model used locally.
- Export-gate clinician attestation prompt softens to a non-clinical-use acknowledgment in `research` and `off` PHI modes. Strict mode is unchanged — clinician attestation language remains in place for any future real-PHI deployment.
- `aegis/README.md` rewritten from the M1 scaffolding stub to a usable overview with prerequisites, quickstart, workflows table, dev section, and a pointer to the operator guide.
- `aegis` package version: `1.0.0-aegis-m6` → `0.9.0`.
- `aegis-mcp` package version: `0.0.0` → `0.9.0`.

### Deferred (not in v0.9.0)
- Synthea + Gate B clinician dogfood runs on a clinician workstation.
- Clinician-reviewed sign-off language.
- A bundled installer that sets up the Python `aegis-mcp` venv from the npm package (e.g. an `aegis install` subcommand or a Python wheel published to PyPI). For now the venv is a manual second step.
- All v2 items per master-spec §10 (voice/dictation input, local-LLM de-id, full validator expansion, EMR write-back, TUI/web UI, headless batch research, researcher persona).
