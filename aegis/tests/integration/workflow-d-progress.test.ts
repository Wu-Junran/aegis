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
const CASSETTE_PATH = join(__dirname, '..', 'cassettes', 'workflow-d-progress.jsonl')
const HAS_MCP = existsSync(aegisMcpBinPath())
const HAS_CASSETTE = existsSync(CASSETTE_PATH)

if (process.env.AEGIS_RECORD === '1' && !HAS_MCP) {
  throw new Error(
    `AEGIS_RECORD=1 (workflow D) requires aegis-mcp venv at ${aegisMcpBinPath()}. ` +
      'Run `cd aegis-mcp && python3.11 -m venv .venv && .venv/bin/pip install -e ".[dev]"` first.',
  )
}
if (process.env.AEGIS_REQUIRE_MCP === '1' && !HAS_MCP) {
  throw new Error(
    `AEGIS_REQUIRE_MCP=1 (workflow D) requires aegis-mcp venv at ${aegisMcpBinPath()}.`,
  )
}
if (
  process.env.AEGIS_REQUIRE_MCP === '1' &&
  HAS_MCP &&
  !HAS_CASSETTE &&
  process.env.AEGIS_RECORD !== '1'
) {
  throw new Error(
    `AEGIS_REQUIRE_MCP=1 (workflow D) requires a recorded cassette at ${CASSETTE_PATH}. ` +
      'Build with `bun run scripts/build-workflow-cassettes.ts` or record with ' +
      'AEGIS_RECORD=1.',
  )
}

const t =
  HAS_MCP && (HAS_CASSETTE || process.env.AEGIS_RECORD === '1') ? test : test.skip

afterAll(() => closeSharedMcpClient())

let harness: Awaited<ReturnType<typeof makeHarness>>

beforeEach(async () => {
  if (!HAS_MCP || !(HAS_CASSETTE || process.env.AEGIS_RECORD === '1')) return
  installCassetteAdapter({ workflow: 'workflow-d-progress' })
  harness = await makeHarness({
    bundlePath: FIXTURE_PATH,
    templateId: 'progress-note',
    phiMode: 'research',
  })
})

afterEach(() => {
  if (!HAS_MCP || !(HAS_CASSETTE || process.env.AEGIS_RECORD === '1')) return
  harness.cleanup()
  uninstallCassetteAdapter()
})

t('Workflow D: progress note populates filled_sections and exports md with all section headings', async () => {
  const note = await harness.draftTurn(
    "Draft today's progress note for this patient. Wrap each section in the aegis section fences as the system prompt instructs. Treat any `<DATE_N>`, `<PERSON_N>`, or `<MRN_N>` tokens as opaque values — do not ask for them to be filled in.",
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

  const dir = mkdtempSync(join(tmpdir(), 'aegis-wf-d-'))
  const target = join(dir, 'progress.md')
  const result = await harness.runExport({ target, format: 'md', mode: 'redacted' })
  expect(result.ok).toBe(true)
  expect(existsSync(target)).toBe(true)
  const body = readFileSync(target, 'utf-8')
  expect(body).toContain('# Progress Note')
  expect(body).toContain('## Subjective')
  expect(body).toContain('## Objective')
  expect(body).toContain('## Assessment')
  expect(body).toContain('## Plan')

  const auditPath = harness.store.getState().auditLogPath
  expect(auditPath).not.toBeNull()
  const auditLines = readFileSync(auditPath!, 'utf-8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
  expect(auditLines.some((e: any) => e.type === 'note_export_completed')).toBe(true)
})
