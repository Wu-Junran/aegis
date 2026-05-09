#!/usr/bin/env bun
/**
 * Automated Synthea dogfood runner — closes the M6-deferred Synthea dogfood
 * by driving Workflows A/B/C/D/E end-to-end through the existing test
 * harness, asserting the six post-conditions from
 * `docs/dogfood/synthea-runbook.md`, and recording a session entry in
 * `docs/dogfood/m6-blockers.md`.
 *
 * Replay (default):  bun run scripts/dogfood/run-synthea.ts
 * Record (live LLM): AEGIS_RECORD=1 ANTHROPIC_API_KEY=… bun run scripts/dogfood/run-synthea.ts --record
 *
 * The record path replaces the M6-era programmatic cassettes with real
 * Anthropic responses for that day's session; replay then re-uses them.
 *
 * Cost (record mode, all 5 workflows): ~$0.05 against DeepSeek's
 * Anthropic-compatible endpoint with deepseek-v4-flash auto-mapping.
 */

import {
  appendFileSync,
  existsSync,
  fstatSync,
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import {
  installCassetteAdapter,
  uninstallCassetteAdapter,
} from '../../tests/lib/cassetteAdapter.js'
import { defaultHarnessCallTool, makeHarness } from '../../tests/lib/workflowHarness.js'
import { closeSharedMcpClient } from '../../tests/lib/spawnMcp.js'

/**
 * When DEEPSEEK_API_KEY is set, build an Anthropic SDK client pointed at
 * DeepSeek's Anthropic-compatible endpoint. This lets cassette recording
 * use a DeepSeek-issued key without changing any request shape (the
 * canonical request hash is unchanged because the model field is still
 * `claude-haiku-4-5-20251001`; DeepSeek auto-maps unknown model names
 * server-side). When the env var is unset, return undefined and let the
 * harness construct the default Anthropic client (or use the
 * 'replay-mode-placeholder' key during replay).
 */
function recordAnthropicClient(): Anthropic | undefined {
  const dsKey = process.env.DEEPSEEK_API_KEY
  if (dsKey) {
    return new Anthropic({
      apiKey: dsKey,
      baseURL: 'https://api.deepseek.com/anthropic',
    })
  }
  return undefined
}

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..', '..')
const FIXTURES = join(REPO_ROOT, 'aegis', 'tests', 'fixtures')
const BLOCKERS_FILE = join(REPO_ROOT, 'docs', 'dogfood', 'm6-blockers.md')

type WorkflowSpec = {
  id: string
  bundleFixture: string
  templateId: string
  phiMode: 'strict' | 'research'
  format: 'md' | 'pdf'
  expectedSections: string[]
  userPrompt: string
}

const WORKFLOW_SPECS: ReadonlyArray<WorkflowSpec> = [
  {
    id: 'workflow-a-soap',
    bundleFixture: 'synthea_minimal.json',
    templateId: 'soap',
    phiMode: 'research',
    format: 'md',
    expectedSections: ['subjective', 'objective', 'assessment', 'plan'],
    userPrompt:
      'Draft a SOAP note for this patient. Wrap each section in the aegis section fences as the system prompt instructs.',
  },
  {
    id: 'workflow-b-discharge',
    bundleFixture: 'synthea_admission_bundle.json',
    templateId: 'discharge-summary',
    phiMode: 'research',
    format: 'pdf',
    expectedSections: ['hpi', 'hospital_course', 'discharge_medications', 'follow_up'],
    userPrompt:
      'Build the discharge summary; pull HPI from the admission note, list current vs. admission meds, and wrap each section in the aegis section fences.',
  },
  {
    id: 'workflow-c-research-soap',
    bundleFixture: 'synthea_minimal.json',
    templateId: 'soap',
    phiMode: 'research',
    format: 'md',
    expectedSections: ['subjective', 'objective', 'assessment', 'plan'],
    userPrompt: 'Draft a SOAP note. Use the aegis section fences for each section.',
  },
  {
    id: 'workflow-d-progress',
    bundleFixture: 'synthea_minimal.json',
    templateId: 'progress-note',
    phiMode: 'research',
    format: 'md',
    expectedSections: ['subjective', 'objective', 'assessment', 'plan'],
    userPrompt:
      "Draft today's progress note for this patient. Wrap each section in the aegis section fences as the system prompt instructs. Treat any `<DATE_N>`, `<PERSON_N>`, or `<MRN_N>` tokens as opaque values — do not ask for them to be filled in.",
  },
  {
    id: 'workflow-e-case-report',
    bundleFixture: 'synthea_admission_bundle.json',
    templateId: 'case-report',
    phiMode: 'research',
    format: 'md',
    expectedSections: [
      'introduction',
      'presentation',
      'investigations',
      'management',
      'outcome',
      'discussion',
    ],
    userPrompt:
      'Draft a publishable case report from this encounter. Wrap each section in the aegis section fences as the system prompt instructs.',
  },
  // workflow-f is the only strict-mode spec — it exists specifically to
  // exercise Check 6's strict branch (PHI literal sweep over the audit
  // log + `llm_request` MUST NOT have `fullRequest`). Without it the
  // strict branch was unreachable and the README's "no PHI literals
  // leaked into the audit log" claim was unfalsifiable from dogfood
  // alone. The cassette is synthetic (built by `build-workflow-
  // cassettes.ts`) because the value-add here is the audit invariants,
  // not LLM-quality content; the synthetic SOAP_RESPONSE_TEXT contains
  // zero literals from `synthea_minimal.json`, so the post-redaction
  // post-restore audit log is genuinely clean and the sweep can prove
  // it.
  {
    id: 'workflow-f-strict-soap',
    bundleFixture: 'synthea_minimal.json',
    templateId: 'soap',
    phiMode: 'strict',
    format: 'md',
    expectedSections: ['subjective', 'objective', 'assessment', 'plan'],
    userPrompt:
      'Strict-mode SOAP draft. Wrap each section in the aegis section fences as the system prompt instructs.',
  },
]

type CheckResult = { name: string; ok: boolean; detail: string }

type WorkflowResult = {
  id: string
  ok: boolean
  checks: CheckResult[]
}

function extractBundleLiterals(bundlePath: string): string[] {
  const raw = JSON.parse(readFileSync(bundlePath, 'utf-8')) as unknown
  const literals = new Set<string>()
  function walk(node: unknown): void {
    if (!node) return
    if (typeof node === 'string') return
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (typeof node !== 'object') return
    const obj = node as Record<string, unknown>
    if (Array.isArray(obj.name)) {
      for (const n of obj.name as Array<Record<string, unknown>>) {
        for (const g of (n.given as string[]) ?? []) if (g.length >= 3) literals.add(g)
        if (typeof n.family === 'string' && n.family.length >= 3) literals.add(n.family)
      }
    }
    if (typeof obj.birthDate === 'string') literals.add(obj.birthDate)
    if (Array.isArray(obj.identifier)) {
      for (const ident of obj.identifier as Array<Record<string, unknown>>) {
        if (typeof ident.value === 'string' && ident.value.length >= 3) {
          literals.add(ident.value)
        }
      }
    }
    for (const v of Object.values(obj)) walk(v)
  }
  walk(raw)
  return [...literals]
}

async function runWorkflow(spec: WorkflowSpec, record: boolean): Promise<WorkflowResult> {
  const checks: CheckResult[] = []
  const bundlePath = join(FIXTURES, spec.bundleFixture)
  // Install the cassette adapter in BOTH modes — its `mode` field auto-
  // resolves from `AEGIS_RECORD` (record-mode delegates to the real
  // adapter and writes the response to the cassette; replay-mode looks
  // up by request hash). Skipping the install in record mode would route
  // through whatever adapter `getAdapter` resolves for `'anthropic'`,
  // which currently means the AnthropicAdapter — but that path never
  // writes the cassette, so re-record sessions would be a no-op.
  installCassetteAdapter({ workflow: spec.id })
  const harness = await makeHarness({
    bundlePath,
    templateId: spec.templateId,
    phiMode: spec.phiMode,
    anthropicClient: record ? recordAnthropicClient() : undefined,
  })
  try {
    // Seed `validatorWarnings` with a sentinel reference BEFORE the turn.
    // `getDefaultAppState()` initializes the slice to `[]`, so just
    // checking `Array.isArray(...)` after draftTurn would pass even when
    // the inbound validator middleware never ran. The clinical validator
    // calls `pushValidatorWarnings(safe)` → `store.setState(s => ({...s,
    // validatorWarnings: safe}))`, which REPLACES the slice reference.
    // We therefore compare reference identity: if the post-turn slice is
    // still our sentinel, the middleware was never called for this turn.
    const validatorSentinel: unknown[] = Object.freeze([
      { __dogfood_sentinel: true },
    ]) as unknown[]
    harness.store.setState((s) => ({ ...s, validatorWarnings: validatorSentinel as never }))

    const note = await harness.draftTurn(spec.userPrompt)

    // Check 1: every expected section appears in filled_sections.
    const got = Object.keys(note.filled_sections).sort()
    const want = [...spec.expectedSections].sort()
    checks.push({
      name: 'sections-present',
      ok: JSON.stringify(got) === JSON.stringify(want),
      detail: `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`,
    })

    // Check 2: validator wiring fired this turn. The sentinel seeded
    // above gets replaced (different reference) by clinicalValidator's
    // `pushValidatorWarnings(safe)` if and only if the inbound
    // middleware actually ran. If the post-turn slice is still our
    // sentinel reference, the validator middleware was never invoked
    // for this draftTurn — the wiring is broken. Pre-fix this check
    // was `Array.isArray(ws)`, which `getDefaultAppState()` makes
    // vacuously true (initial value is `[]`).
    const ws = harness.store.getState().validatorWarnings as unknown
    const middlewareRan = ws !== validatorSentinel && Array.isArray(ws)
    checks.push({
      name: 'validator-wiring-fired',
      ok: middlewareRan,
      detail: middlewareRan
        ? `array length ${(ws as Array<unknown>).length} (sentinel was replaced)`
        : `slice still === sentinel — clinicalValidator never ran for this turn`,
    })

    // Drive export.
    const dir = mkdtempSync(join(tmpdir(), `aegis-dogfood-${spec.id}-`))
    const target = join(dir, `${spec.id}.${spec.format}`)
    const result = await harness.runExport({ target, format: spec.format, mode: 'redacted' })
    checks.push({
      name: 'export-ok',
      ok: result.ok,
      detail: result.message,
    })

    // Check 3 (PDF only): real PDF — header `%PDF-` + EOF trailer
    // `%%EOF` near the end + at least one `/Type /Page` (singular,
    // negative lookahead so it doesn't match `/Pages`) page object.
    // The original `head === '%PDF'` only proved the first four bytes
    // — a truncated file with a stub header would have passed. The
    // header check now demands the version-byte (`%PDF-1.x`), the
    // trailer check confirms the file isn't truncated, and the page
    // count proves at least one page was emitted.
    if (spec.format === 'pdf' && result.ok) {
      const buf = readFileSync(target)
      const head = buf.slice(0, 5).toString('utf-8')
      const tail = buf.slice(Math.max(0, buf.length - 1024)).toString('binary')
      const pageObjs = buf.toString('binary').match(/\/Type\s*\/Page(?!s)/g) ?? []
      const ok =
        head === '%PDF-' && tail.includes('%%EOF') && pageObjs.length >= 1
      checks.push({
        name: 'pdf-structure',
        ok,
        detail:
          `header=${JSON.stringify(head)} ` +
          `eof_in_tail=${tail.includes('%%EOF')} ` +
          `pages=${pageObjs.length}`,
      })
    }

    // Check 4: file mode is 0600.
    if (result.ok) {
      const fd = openSync(target, 'r')
      try {
        const st = fstatSync(fd)
        const perms = st.mode & 0o777
        checks.push({
          name: 'file-mode-0600',
          ok: perms === 0o600,
          detail: `mode=0o${perms.toString(8)}`,
        })
      } finally {
        closeSync(fd)
      }
    }

    // Check 5: audit log JSONL parses; note_export_completed entry present.
    const auditPath = harness.store.getState().auditLogPath
    let completedEntry: Record<string, unknown> | null = null
    if (auditPath && existsSync(auditPath)) {
      const lines = readFileSync(auditPath, 'utf-8').trim().split('\n')
      let allParsed = true
      const parsed: Array<Record<string, unknown>> = []
      for (const line of lines) {
        try {
          parsed.push(JSON.parse(line))
        } catch {
          allParsed = false
        }
      }
      checks.push({
        name: 'audit-jsonl-parses',
        ok: allParsed,
        detail: `lines=${lines.length}`,
      })
      completedEntry =
        parsed.find((e) => (e.type as string) === 'note_export_completed') ?? null
      checks.push({
        name: 'note_export_completed-present',
        ok: completedEntry !== null,
        detail: completedEntry ? 'found' : 'missing',
      })
    } else {
      checks.push({
        name: 'audit-log-exists',
        ok: false,
        detail: `auditPath=${auditPath}`,
      })
    }

    // Check 6: audit-log shape is consistent with phiMode (master spec §6.2).
    // - strict: at least one llm_request entry must exist (else the check
    //   is vacuous if outbound audit logging silently drops out), NO
    //   plaintext PHI literals from the bundle anywhere in the audit log,
    //   AND llm_request entries MUST NOT have a `fullRequest` field.
    // - research: research-mode docstring promises fullRequest is the
    //   plaintext request (auditMiddleware.ts) — pin that contract by
    //   asserting at least one llm_request entry HAS fullRequest and lacks
    //   redactedPayloadHash. Synthea is synthetic so plaintext is OK here.
    // (Off mode is unreachable from this runner — WorkflowSpec.phiMode is
    // 'strict' | 'research'; off mode would also bypass the medical
    // middleware chain entirely — middlewareWiring.ts:61 — so there are
    // no llm_request rows to inspect in that mode.)
    if (auditPath && existsSync(auditPath)) {
      const auditText = readFileSync(auditPath, 'utf-8')
      const parsed = auditText
        .trim()
        .split('\n')
        .flatMap((l) => {
          try {
            return [JSON.parse(l) as Record<string, unknown>]
          } catch {
            return []
          }
        })
      const llmReqEntries = parsed.filter((e) => (e.type as string) === 'llm_request')

      if (spec.phiMode === 'strict') {
        const literals = extractBundleLiterals(bundlePath)
        const leaks = literals.filter((lit) => auditText.includes(lit))
        checks.push({
          name: 'strict:no-phi-in-audit-log',
          ok: leaks.length === 0,
          detail:
            leaks.length === 0
              ? `scanned ${literals.length} literals, no leaks`
              : `LEAKED: ${leaks.slice(0, 3).join(', ')}${leaks.length > 3 ? '…' : ''}`,
        })
        const stripperLeaks = llmReqEntries.filter((e) => 'fullRequest' in e)
        // Require ≥1 llm_request entry — else the strict-mode audit
        // pipeline could silently drop outbound logging entirely (a real
        // regression) and `0/0 entries had fullRequest` would still
        // pass. Mirrors the research-mode shape check below.
        const stripperOk = llmReqEntries.length > 0 && stripperLeaks.length === 0
        checks.push({
          name: 'strict:llm_request-has-no-fullRequest',
          ok: stripperOk,
          detail:
            llmReqEntries.length === 0
              ? `0 llm_request entries written — strict outbound audit logging not firing`
              : `${stripperLeaks.length}/${llmReqEntries.length} entries had fullRequest (must be 0 in strict)`,
        })
      } else {
        // research mode (off mode is unreachable here; see Check 6 comment).
        const shaped = llmReqEntries.filter(
          (e) => 'fullRequest' in e && !('redactedPayloadHash' in e),
        )
        checks.push({
          name: 'research:llm_request-shape-consistent',
          ok: llmReqEntries.length > 0 && shaped.length === llmReqEntries.length,
          detail: `${shaped.length}/${llmReqEntries.length} llm_request entries have fullRequest+!redactedPayloadHash (research mode contract)`,
        })
      }
    }
  } finally {
    harness.cleanup()
    uninstallCassetteAdapter()
  }
  return {
    id: spec.id,
    ok: checks.every((c) => c.ok),
    checks,
  }
}

function runStamp(): string {
  // Per-run ISO8601 second precision: e.g. 2026-05-09T14:23:05Z. Used as
  // the section header so reruns on the same calendar day each get their
  // own entry instead of being silently dropped by a date-only dedup.
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function appendBlockersEntry(results: WorkflowResult[], stamp: string): void {
  if (!existsSync(BLOCKERS_FILE)) {
    console.warn(`m6-blockers.md not found at ${BLOCKERS_FILE}; skipping append`)
    return
  }
  // No same-day dedup: if a section with this exact stamp somehow
  // already exists (clock-skew, simultaneous run), prefer to record
  // the new evidence under a uniquified header rather than drop it.
  const existing = readFileSync(BLOCKERS_FILE, 'utf-8')
  let header = stamp
  if (existing.includes(`## ${header} — synthea`)) {
    let n = 2
    while (existing.includes(`## ${stamp} (run ${n}) — synthea`)) n++
    header = `${stamp} (run ${n})`
  }
  let entry = `\n## ${header} — synthea (automated runner)\n\n`
  for (const r of results) {
    entry += `- ${r.ok ? '✓' : '✗'} **${r.id}**\n`
    for (const c of r.checks) {
      entry += `    - ${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}\n`
    }
  }
  appendFileSync(BLOCKERS_FILE, entry)
  console.log(`appended ${header} synthea section to m6-blockers.md`)
}

type WorkflowsFlag =
  | { kind: 'absent' }
  | { kind: 'present'; tokens: string[] }
  | { kind: 'missing-value'; raw: string }

/**
 * Parse `--workflows` from argv. Supports both `--workflows=a,b` (=) and
 * `--workflows a,b` (space-separated next argv). Returns:
 *   - { kind: 'absent' }              flag not present → run all
 *   - { kind: 'present', tokens }     flag with one or more comma-tokens
 *   - { kind: 'missing-value', raw }  flag present but value missing
 *                                     (last argv, or next argv begins
 *                                     with `--`, or `=` form with empty
 *                                     value) → main exits 2 instead of
 *                                     silently running every workflow.
 *
 * Pre-fix bugs:
 *   (a) only `--workflows=` was parsed (tokens compared to `a-soap`-form);
 *       `--workflows a,b,c,d,e` from the runbook silently selected zero
 *       specs and reported a vacuous `0/0 OK` (fixed in bfff38a).
 *   (b) bare `--workflows` (no value) treated as if the flag were absent,
 *       so a mistyped filter quietly performed a full dogfood run — and
 *       in --record mode would re-record every cassette. Fixed here by
 *       distinguishing 'missing-value' from 'absent'.
 */
function parseWorkflowsFlag(argv: ReadonlyArray<string>): WorkflowsFlag {
  function clean(s: string): string[] {
    return s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--workflows') {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        return { kind: 'missing-value', raw: a }
      }
      const tokens = clean(next)
      if (tokens.length === 0) return { kind: 'missing-value', raw: `${a} ${next}` }
      return { kind: 'present', tokens }
    }
    if (a.startsWith('--workflows=')) {
      const tokens = clean(a.slice('--workflows='.length))
      if (tokens.length === 0) return { kind: 'missing-value', raw: a }
      return { kind: 'present', tokens }
    }
  }
  return { kind: 'absent' }
}

/**
 * Match a single token against a spec id. Accepts:
 *   - full id:             `workflow-a-soap`
 *   - middle suffix:       `a-soap`
 *   - documented alias:    `a` (the per-letter prefix used in the runbook)
 */
function specMatchesToken(specId: string, token: string): boolean {
  const id = specId.toLowerCase()
  const stripped = id.replace(/^workflow-/, '') // e.g. "a-soap"
  const letter = stripped.split('-')[0] // "a"
  return id === token || stripped === token || letter === token
}

/**
 * Planted validator-surface canary. Calls the MCP `validate_clinical_note`
 * tool with a known-bad note (Aspirin 50000 mg → 50× the typical max in
 * `dose_reference.json`) and asserts at least one warning came back. This
 * is the master-spec post-condition "validator surface fires" — checked
 * once per session, decoupled from cassette content so re-records can't
 * silently strip the gate.
 */
async function runValidatorCanary(): Promise<WorkflowResult> {
  const checks: CheckResult[] = []
  const note =
    'Plan:\n- Start Aspirin 50000 mg PO daily.\n- Continue Lisinopril 5000 mg PO daily.\n'
  const patient = {
    name: 'Canary, Test',
    mrn: 'TEST-CANARY-001',
    sex: 'unknown',
    birth_date: '1970-01-01',
  }
  try {
    const raw = await defaultHarnessCallTool('validate_clinical_note', {
      note,
      patient_context: patient,
      checks: ['dose'],
    })
    const parsed = JSON.parse(raw) as Array<{ check?: string }>
    const doseHits = Array.isArray(parsed)
      ? parsed.filter((w) => w?.check === 'dose')
      : []
    checks.push({
      name: 'validator-canary-fired',
      ok: doseHits.length >= 1,
      detail: `dose warnings=${doseHits.length} (expected ≥1 — Aspirin 50000mg + Lisinopril 5000mg)`,
    })
  } catch (err) {
    checks.push({
      name: 'validator-canary-fired',
      ok: false,
      detail: `MCP error: ${(err as Error).message}`,
    })
  }
  return {
    id: '_canary-validator-surface',
    ok: checks.every((c) => c.ok),
    checks,
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const record = argv.includes('--record')
  const flag = parseWorkflowsFlag(argv)
  if (record) process.env.AEGIS_RECORD = '1'

  // Bare `--workflows` with no value: usage error. Pre-fix this fell
  // through to "no flag" → full dogfood ran, which in --record mode
  // would silently re-record every cassette from a mistyped command.
  if (flag.kind === 'missing-value') {
    console.error(
      `${flag.raw} requires a comma-separated value.\n` +
        `Usage: --workflows a,b,c,d,e   (or full ids, or middle suffixes)`,
    )
    process.exit(2)
  }

  const specs =
    flag.kind === 'present'
      ? WORKFLOW_SPECS.filter((s) => flag.tokens.some((tok) => specMatchesToken(s.id, tok)))
      : WORKFLOW_SPECS

  if (flag.kind === 'present' && specs.length === 0) {
    const allShort = WORKFLOW_SPECS.map((s) => {
      const stripped = s.id.replace(/^workflow-/, '')
      return `${stripped.split('-')[0]} | ${stripped} | ${s.id}`
    }).join('\n  ')
    console.error(
      `--workflows ${JSON.stringify(flag.tokens.join(','))} matched zero specs.\n` +
        `Accepted token forms (any of):\n  ${allShort}`,
    )
    process.exit(2)
  }

  const results: WorkflowResult[] = []

  // Pre-flight: planted validator-surface canary (P1 fix). Independent of
  // any cassette/LLM output so a quiet workflow run can't fake "validator
  // wired" — runs on every invocation, including filtered subsets.
  console.log(`\n=== _canary-validator-surface (preflight) ===`)
  try {
    const canary = await runValidatorCanary()
    for (const c of canary.checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}`)
    results.push(canary)
  } catch (err) {
    console.error(`  ✗ uncaught: ${(err as Error).message}`)
    results.push({
      id: '_canary-validator-surface',
      ok: false,
      checks: [{ name: 'uncaught', ok: false, detail: (err as Error).message }],
    })
  }

  for (const spec of specs) {
    console.log(`\n=== ${spec.id} (${record ? 'RECORD' : 'replay'}) ===`)
    try {
      const r = await runWorkflow(spec, record)
      for (const c of r.checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}`)
      results.push(r)
    } catch (err) {
      console.error(`  ✗ uncaught: ${(err as Error).message}`)
      results.push({
        id: spec.id,
        ok: false,
        checks: [{ name: 'uncaught', ok: false, detail: (err as Error).message }],
      })
    }
  }
  await closeSharedMcpClient()

  appendBlockersEntry(results, runStamp())

  const allOk = results.every((r) => r.ok)
  console.log(`\n=== summary: ${results.filter((r) => r.ok).length}/${results.length} OK ===`)
  process.exit(allOk ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
