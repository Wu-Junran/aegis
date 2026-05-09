import { test, expect, beforeEach, afterEach, afterAll } from 'bun:test'
import { join } from 'node:path'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  installCassetteAdapter,
  uninstallCassetteAdapter,
} from '../lib/cassetteAdapter.js'
import { makeHarness } from '../lib/workflowHarness.js'
import { aegisMcpBinPath, closeSharedMcpClient } from '../lib/spawnMcp.js'

const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'synthea_minimal.json')
const CASSETTE_PATH = join(__dirname, '..', 'cassettes', 'workflow-a-soap.jsonl')
const HAS_MCP = existsSync(aegisMcpBinPath())
const HAS_CASSETTE = existsSync(CASSETTE_PATH)
// Recording requires the venv. `test.skip` would silently exit green and
// produce no cassette — refuse loudly instead.
if (process.env.AEGIS_RECORD === '1' && !HAS_MCP) {
  throw new Error(
    `AEGIS_RECORD=1 (workflow A) requires aegis-mcp venv at ${aegisMcpBinPath()}. ` +
      'Run `cd aegis-mcp && python3.11 -m venv .venv && .venv/bin/pip install -e ".[dev]"` first.',
  )
}
// CI sets AEGIS_REQUIRE_MCP=1 (see Task 6.30) so a missing venv on the
// required path is a hard failure, not a silent skip.
if (process.env.AEGIS_REQUIRE_MCP === '1' && !HAS_MCP) {
  throw new Error(
    `AEGIS_REQUIRE_MCP=1 (workflow A) requires aegis-mcp venv at ${aegisMcpBinPath()}.`,
  )
}
// (P1 fix) If MCP is present but the cassette is missing under
// AEGIS_REQUIRE_MCP=1, the gate would silently skip — defeating the
// purpose of the var. Hard-fail: cassette must be recorded before CI
// can mark the workflow as exercised. Local devs without the cassette
// leave AEGIS_REQUIRE_MCP unset and get clean test.skip.
if (process.env.AEGIS_REQUIRE_MCP === '1' && HAS_MCP && !HAS_CASSETTE && process.env.AEGIS_RECORD !== '1') {
  throw new Error(
    `AEGIS_REQUIRE_MCP=1 (workflow A) requires a recorded cassette at ${CASSETTE_PATH}. ` +
      'Record with `ANTHROPIC_API_KEY=<key> AEGIS_RECORD=1 bun test tests/integration/workflow-a-soap.test.ts` first, ' +
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
  installCassetteAdapter({ workflow: 'workflow-a-soap' })
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

t('Workflow A: SOAP draft populates filled_sections + export writes md with all section headings', async () => {
  const note = await harness.draftTurn(
    'Draft a SOAP note for this patient. Wrap each section in the aegis section fences as the system prompt instructs.',
  )
  expect(Object.keys(note.filled_sections).sort()).toEqual([
    'assessment',
    'objective',
    'plan',
    'subjective',
  ])
  for (const v of Object.values(note.filled_sections)) {
    expect(v.length).toBeGreaterThan(0)
  }

  const dir = mkdtempSync(join(tmpdir(), 'aegis-wf-a-'))
  const target = join(dir, 'soap.md')
  const result = await harness.runExport({ target, format: 'md', mode: 'redacted' })
  expect(result.ok).toBe(true)
  expect(existsSync(target)).toBe(true)
  const body = readFileSync(target, 'utf-8')
  expect(body).toContain('# SOAP Note')
  expect(body).toContain('## Subjective')
  expect(body).toContain('## Objective')
  expect(body).toContain('## Assessment')
  expect(body).toContain('## Plan')

  expect(result.promptSummary).not.toBeNull()
  expect(typeof result.promptSummary!.validatorWarnings.count).toBe('number')

  const auditPath = harness.store.getState().auditLogPath
  expect(auditPath).not.toBeNull()
  const auditLines = readFileSync(auditPath!, 'utf-8').trim().split('\n').map(l => JSON.parse(l))
  expect(auditLines.some(e => e.type === 'note_export_completed')).toBe(true)
})
