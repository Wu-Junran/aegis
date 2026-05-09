import { test, expect, beforeEach, afterEach, afterAll } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs'
import {
  installCassetteAdapter,
  uninstallCassetteAdapter,
} from '../lib/cassetteAdapter.js'
import { makeHarness } from '../lib/workflowHarness.js'
import { aegisMcpBinPath, closeSharedMcpClient } from '../lib/spawnMcp.js'

const ADMISSION_FIXTURE = join(__dirname, '..', 'fixtures', 'synthea_admission_bundle.json')
const CASSETTE_PATH = join(__dirname, '..', 'cassettes', 'workflow-b-discharge.jsonl')
const HAS_MCP = existsSync(aegisMcpBinPath())
const HAS_CASSETTE = existsSync(CASSETTE_PATH)
if (process.env.AEGIS_RECORD === '1' && !HAS_MCP) {
  throw new Error(
    `AEGIS_RECORD=1 (workflow B) requires aegis-mcp venv at ${aegisMcpBinPath()}. ` +
      'Run `cd aegis-mcp && python3.11 -m venv .venv && .venv/bin/pip install -e ".[dev]"` first.',
  )
}
if (process.env.AEGIS_REQUIRE_MCP === '1' && !HAS_MCP) {
  throw new Error(
    `AEGIS_REQUIRE_MCP=1 (workflow B) requires aegis-mcp venv at ${aegisMcpBinPath()}.`,
  )
}
// (P1 fix) If MCP is present but the cassette is missing under
// AEGIS_REQUIRE_MCP=1, the gate would silently skip — defeating the
// purpose of the var. Hard-fail: cassette must be recorded before CI
// can mark the workflow as exercised. Local devs without the cassette
// leave AEGIS_REQUIRE_MCP unset and get clean test.skip.
if (process.env.AEGIS_REQUIRE_MCP === '1' && HAS_MCP && !HAS_CASSETTE && process.env.AEGIS_RECORD !== '1') {
  throw new Error(
    `AEGIS_REQUIRE_MCP=1 (workflow B) requires a recorded cassette at ${CASSETTE_PATH}. ` +
      'Record with `ANTHROPIC_API_KEY=<key> AEGIS_RECORD=1 bun test tests/integration/workflow-b-discharge.test.ts` first, ' +
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
  installCassetteAdapter({ workflow: 'workflow-b-discharge' })
  harness = await makeHarness({
    bundlePath: ADMISSION_FIXTURE,
    templateId: 'discharge-summary',
    phiMode: 'research',
  })
})

afterEach(() => {
  if (!HAS_MCP || !(HAS_CASSETTE || process.env.AEGIS_RECORD === '1')) return
  harness.cleanup()
  uninstallCassetteAdapter()
})

t('Workflow B: discharge draft → export pdf has valid structure', async () => {
  const note = await harness.draftTurn(
    'Build the discharge summary; pull HPI from the admission note, list current vs. admission meds, and wrap each section in the aegis section fences.',
  )
  expect(Object.keys(note.filled_sections).sort()).toEqual([
    'discharge_medications',
    'follow_up',
    'hospital_course',
    'hpi',
  ])
  for (const v of Object.values(note.filled_sections)) {
    expect(v.length).toBeGreaterThan(0)
  }

  const dir = mkdtempSync(join(tmpdir(), 'aegis-wf-b-'))
  const target = join(dir, 'discharge.pdf')
  const result = await harness.runExport({ target, format: 'pdf', mode: 'redacted' })
  expect(result.ok).toBe(true)
  expect(existsSync(target)).toBe(true)

  // Structural PDF assertions only — byte-exact compare against a checked-in
  // golden file is brittle across platforms (pdfkit emits different font
  // subsets, /CreationDate, /ID, and xref offsets on macOS local vs Ubuntu
  // CI). The dogfood runner does the same structural shape checks for the
  // same reason. The export-gate plumbing — runExport returning ok, file
  // landing on disk with mode 0600, valid PDF wrapper — is what this test
  // is actually here to verify.
  const bytes = readFileSync(target)
  expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  expect(bytes.subarray(-6).toString('ascii')).toContain('%%EOF')
  const pageObjectCount = (bytes.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length
  expect(pageObjectCount).toBeGreaterThanOrEqual(1)
  expect(statSync(target).size).toBeGreaterThan(2000)
  expect(statSync(target).mode & 0o777).toBe(0o600)
})
