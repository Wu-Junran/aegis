import { test, expect, beforeEach, afterEach, afterAll } from 'bun:test'
import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import {
  installCassetteAdapter,
  uninstallCassetteAdapter,
} from '../lib/cassetteAdapter.js'
import { makeHarness } from '../lib/workflowHarness.js'
import { aegisMcpBinPath, closeSharedMcpClient } from '../lib/spawnMcp.js'

const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'synthea_minimal.json')
const CASSETTE_PATH = join(__dirname, '..', 'cassettes', 'workflow-c-research-soap.jsonl')
const HAS_MCP = existsSync(aegisMcpBinPath())
const HAS_CASSETTE = existsSync(CASSETTE_PATH)
if (process.env.AEGIS_RECORD === '1' && !HAS_MCP) {
  throw new Error(
    `AEGIS_RECORD=1 (workflow C) requires aegis-mcp venv at ${aegisMcpBinPath()}. ` +
      'Run `cd aegis-mcp && python3.11 -m venv .venv && .venv/bin/pip install -e ".[dev]"` first.',
  )
}
if (process.env.AEGIS_REQUIRE_MCP === '1' && !HAS_MCP) {
  throw new Error(
    `AEGIS_REQUIRE_MCP=1 (workflow C) requires aegis-mcp venv at ${aegisMcpBinPath()}.`,
  )
}
// (P1 fix) If MCP is present but the cassette is missing under
// AEGIS_REQUIRE_MCP=1, the gate would silently skip — defeating the
// purpose of the var. Hard-fail: cassette must be recorded before CI
// can mark the workflow as exercised. Local devs without the cassette
// leave AEGIS_REQUIRE_MCP unset and get clean test.skip.
if (process.env.AEGIS_REQUIRE_MCP === '1' && HAS_MCP && !HAS_CASSETTE && process.env.AEGIS_RECORD !== '1') {
  throw new Error(
    `AEGIS_REQUIRE_MCP=1 (workflow C) requires a recorded cassette at ${CASSETTE_PATH}. ` +
      'Record with `ANTHROPIC_API_KEY=<key> AEGIS_RECORD=1 bun test tests/integration/workflow-c-research.test.ts` first, ' +
      'or unset AEGIS_REQUIRE_MCP to allow skipping.',
  )
}
// (Deferred-recording gate, M6 dogfood) Workflow cassette is recorded
// during Task 6.28 dogfood with a live ANTHROPIC_API_KEY. Until then,
// this test skips even if MCP is available — replay would otherwise
// throw "cassette miss".
const t = (HAS_MCP && (HAS_CASSETTE || process.env.AEGIS_RECORD === '1')) ? test : test.skip

afterAll(() => closeSharedMcpClient())

let harness: Awaited<ReturnType<typeof makeHarness>>

beforeEach(async () => {
  if (!HAS_MCP || !(HAS_CASSETTE || process.env.AEGIS_RECORD === '1')) return
  installCassetteAdapter({ workflow: 'workflow-c-research-soap' })
  harness = await makeHarness({
    bundlePath: FIXTURE_PATH,
    templateId: 'soap',
    phiMode: 'research',
  })
})

afterEach(() => {
  if (!HAS_MCP || !(HAS_CASSETTE || process.env.AEGIS_RECORD === '1')) return
  harness.cleanup()
  uninstallCassetteAdapter()
})

t('Workflow C: research mode logs plaintext payloads (not redacted hashes)', async () => {
  await harness.draftTurn(
    'Draft a SOAP note. Use the aegis section fences for each section.',
  )
  const auditPath = harness.store.getState().auditLogPath!
  const entries = readFileSync(auditPath, 'utf-8')
    .trim().split('\n').filter(Boolean).map(l => JSON.parse(l))

  const out = entries.find(e => e.type === 'llm_request')
  const inn = entries.find(e => e.type === 'llm_response')
  expect(out).toBeTruthy()
  expect(inn).toBeTruthy()

  expect(out.fullRequest).toBeDefined()
  expect(out.redactedPayloadHash).toBeUndefined()
  expect(out.mode).toBe('research')
  expect(inn.fullResponse).toBeDefined()
  expect(typeof inn.warningCount).toBe('number')

  const slice = harness.store.getState().validatorWarnings ?? []
  expect(inn.warningCount).toBe(slice.length)
})
