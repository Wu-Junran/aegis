#!/usr/bin/env bun
/**
 * Build deterministic cassettes for the Workflow A/B/C/D/E integration tests.
 *
 * Why this script exists: the M6 plan called for cassettes recorded against a
 * live Anthropic API during dogfood (Task 6.28). Without a live API key the
 * cassettes cannot be recorded that way, but the workflow tests aren't
 * checking LLM-quality content — they're checking the harness plumbing
 * (fence parsing → filled_sections, export shape, audit-log invariants).
 * The same approach Task 6.26 uses for the planted-hallucination cassette
 * (synthetic but well-shaped LLM response, real redacted-request canonical
 * hash) generalises cleanly to A/B/C/D/E.
 *
 * Output:
 *   - aegis/tests/cassettes/workflow-a-soap.jsonl
 *   - aegis/tests/cassettes/workflow-b-discharge.jsonl
 *   - aegis/tests/cassettes/workflow-c-research-soap.jsonl
 *   - aegis/tests/cassettes/workflow-d-progress.jsonl
 *   - aegis/tests/cassettes/workflow-e-case-report.jsonl
 *
 * Side-effect (workflow B): regenerates aegis/tests/fixtures/discharge-golden.pdf
 * to match whatever the deterministic markdownToPdf produces for the synthetic
 * discharge response. The PDF renderer is byte-stable so this is safe.
 *
 * Run with: `bun run scripts/build-workflow-cassettes.ts` (from aegis/).
 * Re-run only when the synthetic responses or canonical-request shape changes.
 */

import { existsSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStore } from '../src/state/store.js'
import { getDefaultAppState, type AppState } from '../src/state/AppStateStore.js'
import { setMedicalRuntime, __resetMedicalRuntimeForTests } from '../src/medical/runtime/medicalRuntime.js'
import { setPhiModeFromCli, __resetPhiModeForTests } from '../src/medical/runtime/phiMode.js'
import { loadPatient } from '../src/medical/adapters/fhirAdapter.js'
import { createTemplateRegistry } from '../src/medical/templates/templateRegistry.js'
import { sharedMcpClient, closeSharedMcpClient } from '../tests/lib/spawnMcp.js'
import { defaultHarnessCallTool, buildRedactedDraftRequest } from '../tests/lib/workflowHarness.js'
import type { CallMcpTool } from '../src/medical/adapters/fhirAdapter.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..')
const FIXTURES = join(REPO_ROOT, 'tests', 'fixtures')
const CASSETTES = join(REPO_ROOT, 'tests', 'cassettes')

const SOAP_RESPONSE_TEXT =
  '<!-- aegis:section=subjective -->\n' +
  'Patient reports stable chest pain symptoms following last week\'s ED visit. ' +
  'No new complaints. Adherent to medications.\n' +
  '<!-- aegis:section=end -->\n' +
  '<!-- aegis:section=objective -->\n' +
  'Vital signs within normal limits. Cardiac exam unremarkable. ' +
  'Recent labs reviewed; values consistent with prior bundle.\n' +
  '<!-- aegis:section=end -->\n' +
  '<!-- aegis:section=assessment -->\n' +
  'Coronary artery disease, stable. No acute decompensation.\n' +
  '<!-- aegis:section=end -->\n' +
  '<!-- aegis:section=plan -->\n' +
  'Continue current medications. Lifestyle counseling reinforced. ' +
  'Follow-up in three months.\n' +
  '<!-- aegis:section=end -->\n'

const DISCHARGE_RESPONSE_TEXT =
  '<!-- aegis:section=hpi -->\n' +
  'Patient admitted for chest pain with elevated troponin per the admission ' +
  'note in priorNotes. Cardiac workup initiated on admission day one.\n' +
  '<!-- aegis:section=end -->\n' +
  '<!-- aegis:section=hospital_course -->\n' +
  'Day 1: serial troponins trended down. Day 2: stress test negative. ' +
  'Day 3: stable for discharge home with cardiology follow-up.\n' +
  '<!-- aegis:section=end -->\n' +
  '<!-- aegis:section=discharge_medications -->\n' +
  'Continue admission medications. Aspirin 81 mg PO daily added. ' +
  'No other dose changes from admission med list.\n' +
  '<!-- aegis:section=end -->\n' +
  '<!-- aegis:section=follow_up -->\n' +
  'Cardiology in two weeks. Return precautions: recurrent chest pain, ' +
  'shortness of breath, syncope. PCP in one month.\n' +
  '<!-- aegis:section=end -->\n'

const PROGRESS_RESPONSE_TEXT =
  '<!-- aegis:section=subjective -->\n' +
  'Patient reports stable chest discomfort overnight, no acute distress. ' +
  'Sleep adequate. Appetite improving. Bowel and bladder normal.\n' +
  '<!-- aegis:section=end -->\n' +
  '<!-- aegis:section=objective -->\n' +
  'Vitals stable since yesterday. Cardiac exam unchanged. ' +
  'Today\'s troponin trending down vs. yesterday.\n' +
  '<!-- aegis:section=end -->\n' +
  '<!-- aegis:section=assessment -->\n' +
  'Coronary artery disease, stable; clinically improving day over day. ' +
  'No new acute issues.\n' +
  '<!-- aegis:section=end -->\n' +
  '<!-- aegis:section=plan -->\n' +
  'Continue current regimen. Repeat troponin tomorrow morning. ' +
  'Discharge criteria: 24h symptom-free + downtrending troponins.\n' +
  '<!-- aegis:section=end -->\n'

const CASE_REPORT_RESPONSE_TEXT =
  '<!-- aegis:section=introduction -->\n' +
  'This case illustrates the diagnostic challenge of stable angina presenting ' +
  'in a patient with multiple cardiovascular risk factors.\n' +
  '<!-- aegis:section=end -->\n' +
  '<!-- aegis:section=presentation -->\n' +
  'A patient with longstanding hypertension and hyperlipidemia presented ' +
  'with exertional chest discomfort relieved by rest.\n' +
  '<!-- aegis:section=end -->\n' +
  '<!-- aegis:section=investigations -->\n' +
  'Initial troponin negative. Subsequent stress test demonstrated reversible ' +
  'ischemia in the inferior territory.\n' +
  '<!-- aegis:section=end -->\n' +
  '<!-- aegis:section=management -->\n' +
  'Initiated dual antiplatelet therapy and statin. Cardiology referral for ' +
  'consideration of catheterization.\n' +
  '<!-- aegis:section=end -->\n' +
  '<!-- aegis:section=outcome -->\n' +
  'Discharged stable on day three with cardiology follow-up at two weeks.\n' +
  '<!-- aegis:section=end -->\n' +
  '<!-- aegis:section=discussion -->\n' +
  'Stable angina remains a clinical diagnosis supported by stress imaging. ' +
  'Limitations: single case, retrospective documentation review.\n' +
  '<!-- aegis:section=end -->\n'

type CassetteSpec = {
  workflow: string
  bundleFixture: string
  templateId: string
  responseText: string
  userPrompt: string
  phiMode: 'strict' | 'research'
}

const SPECS: ReadonlyArray<CassetteSpec> = [
  {
    workflow: 'workflow-a-soap',
    bundleFixture: 'synthea_minimal.json',
    templateId: 'soap',
    responseText: SOAP_RESPONSE_TEXT,
    userPrompt:
      'Draft a SOAP note for this patient. Wrap each section in the aegis section fences as the system prompt instructs.',
    phiMode: 'research',
  },
  {
    workflow: 'workflow-b-discharge',
    bundleFixture: 'synthea_admission_bundle.json',
    templateId: 'discharge-summary',
    responseText: DISCHARGE_RESPONSE_TEXT,
    userPrompt:
      'Build the discharge summary; pull HPI from the admission note, list current vs. admission meds, and wrap each section in the aegis section fences.',
    phiMode: 'research',
  },
  {
    workflow: 'workflow-c-research-soap',
    bundleFixture: 'synthea_minimal.json',
    templateId: 'soap',
    responseText: SOAP_RESPONSE_TEXT,
    userPrompt: 'Draft a SOAP note. Use the aegis section fences for each section.',
    phiMode: 'research',
  },
  {
    workflow: 'workflow-d-progress',
    bundleFixture: 'synthea_minimal.json',
    templateId: 'progress-note',
    responseText: PROGRESS_RESPONSE_TEXT,
    userPrompt:
      "Draft today's progress note for this patient. Wrap each section in the aegis section fences as the system prompt instructs. Treat any `<DATE_N>`, `<PERSON_N>`, or `<MRN_N>` tokens as opaque values — do not ask for them to be filled in.",
    phiMode: 'research',
  },
  {
    workflow: 'workflow-e-case-report',
    bundleFixture: 'synthea_admission_bundle.json',
    templateId: 'case-report',
    responseText: CASE_REPORT_RESPONSE_TEXT,
    userPrompt:
      'Draft a publishable case report from this encounter. Wrap each section in the aegis section fences as the system prompt instructs.',
    phiMode: 'research',
  },
  // workflow-f exercises the strict-mode dogfood path — the only one of
  // the six that asserts "no plaintext PHI literals appear anywhere in
  // the audit log" (`run-synthea.ts` Check 6 strict branch). Without
  // this spec, `phiMode === 'strict'` was an unreachable branch in the
  // runner; the README claim that the dogfood proves PHI doesn't leak
  // to the audit log was unfalsifiable. The synthetic SOAP_RESPONSE_TEXT
  // is reused — its content contains zero PHI literals from
  // `synthea_minimal.json`, so post-redaction-post-restore the audit
  // log is genuinely clean and the sweep has something real to verify.
  {
    workflow: 'workflow-f-strict-soap',
    bundleFixture: 'synthea_minimal.json',
    templateId: 'soap',
    responseText: SOAP_RESPONSE_TEXT,
    userPrompt:
      'Strict-mode SOAP draft. Wrap each section in the aegis section fences as the system prompt instructs.',
    phiMode: 'strict',
  },
]

async function buildOne(spec: CassetteSpec, callTool: CallMcpTool): Promise<void> {
  __resetMedicalRuntimeForTests()
  __resetPhiModeForTests()
  setPhiModeFromCli({ mode: spec.phiMode, allowOff: false })

  const store = createStore<AppState>(getDefaultAppState())
  setMedicalRuntime({
    getState: () => store.getState(),
    setState: updater => store.setState(updater),
    getMcpClients: () => [],
    sessionId: 'cassette-build',
  })

  const bundlePath = join(FIXTURES, spec.bundleFixture)
  if (!existsSync(bundlePath)) throw new Error(`fixture not found: ${bundlePath}`)
  const patient = await loadPatient(bundlePath, { callTool })
  store.setState(s => ({ ...s, currentPatient: patient }))
  const reg = createTemplateRegistry({ callTool })
  const template = await reg.getTemplate(spec.templateId)
  store.setState(s => ({ ...s, currentTemplate: template }))

  const built = await buildRedactedDraftRequest({
    store,
    callTool,
    phiMode: spec.phiMode,
    userPrompt: spec.userPrompt,
  })

  const line = JSON.stringify({
    requestHash: built.requestHash,
    request: built.canonicalRequest,
    response: {
      kind: 'message',
      message: {
        id: `msg_${spec.workflow}`,
        role: 'assistant',
        type: 'message',
        model: 'claude-haiku-4-5-20251001',
        content: [{ type: 'text', text: spec.responseText }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    },
  })
  const out = join(CASSETTES, `${spec.workflow}.jsonl`)
  writeFileSync(out, line + '\n')
  console.log(`wrote ${out} (hash=${built.requestHash.slice(0, 16)}…)`)
}

async function main(): Promise<void> {
  // Idempotency / safety. After A.7 the workflow A–E cassettes were
  // re-recorded against DeepSeek's Anthropic-compatible endpoint and
  // committed; running this script unguarded would silently overwrite
  // those real recordings with synthetic-LLM responses. Default
  // behaviour is now to skip any spec whose cassette already exists;
  // pass `--force` to overwrite (rebuild-from-scratch) or
  // `--only=<workflow-id>[,<workflow-id>...]` to target specific specs.
  const argv = process.argv.slice(2)
  const force = argv.includes('--force')

  // Parse `--only` carefully. Pre-fix code did
  //   const onlyArg = argv.find(...)?.slice('--only='.length)
  //   const onlySet = onlyArg ? new Set(...) : null
  // which treated an empty value (`--only=`) as falsy → null →
  // "no filter", so `--force --only=` blew away every cassette.
  // Distinguish absent / missing-value / valid by the same pattern
  // we use in run-synthea.ts.
  const onlyRaw = argv.find((a) => a.startsWith('--only='))
  let onlySet: Set<string> | null = null
  if (onlyRaw !== undefined) {
    const value = onlyRaw.slice('--only='.length)
    const tokens = value.split(',').map((s) => s.trim()).filter(Boolean)
    if (tokens.length === 0) {
      console.error(
        '--only= requires a comma-separated value.\n' +
          `Known workflow ids: ${SPECS.map((s) => s.workflow).join(', ')}`,
      )
      process.exit(2)
    }
    const known = new Set(SPECS.map((s) => s.workflow))
    const unknown = tokens.filter((t) => !known.has(t))
    if (unknown.length > 0) {
      console.error(
        `--only= got unknown workflow id(s): ${unknown.join(', ')}\n` +
          `Known: ${[...known].join(', ')}`,
      )
      process.exit(2)
    }
    onlySet = new Set(tokens)
  }

  // Warm the shared MCP client once so all spec runs reuse it.
  await sharedMcpClient()
  try {
    const callTool = defaultHarnessCallTool
    for (const spec of SPECS) {
      if (onlySet && !onlySet.has(spec.workflow)) continue
      const out = join(CASSETTES, `${spec.workflow}.jsonl`)
      if (existsSync(out) && !force) {
        console.log(`skip ${spec.workflow} (cassette exists; pass --force to overwrite)`)
        continue
      }
      await buildOne(spec, callTool)
    }
  } finally {
    await closeSharedMcpClient()
  }
  __resetMedicalRuntimeForTests()
  __resetPhiModeForTests()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
