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

const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'synthea_admission_bundle.json')
const CASSETTE_PATH = join(__dirname, '..', 'cassettes', 'workflow-e-case-report.jsonl')
const HAS_MCP = existsSync(aegisMcpBinPath())
const HAS_CASSETTE = existsSync(CASSETTE_PATH)

if (process.env.AEGIS_RECORD === '1' && !HAS_MCP) {
  throw new Error(
    `AEGIS_RECORD=1 (workflow E) requires aegis-mcp venv at ${aegisMcpBinPath()}. ` +
      'Run `cd aegis-mcp && python3.11 -m venv .venv && .venv/bin/pip install -e ".[dev]"` first.',
  )
}
if (process.env.AEGIS_REQUIRE_MCP === '1' && !HAS_MCP) {
  throw new Error(
    `AEGIS_REQUIRE_MCP=1 (workflow E) requires aegis-mcp venv at ${aegisMcpBinPath()}.`,
  )
}
if (
  process.env.AEGIS_REQUIRE_MCP === '1' &&
  HAS_MCP &&
  !HAS_CASSETTE &&
  process.env.AEGIS_RECORD !== '1'
) {
  throw new Error(
    `AEGIS_REQUIRE_MCP=1 (workflow E) requires a recorded cassette at ${CASSETTE_PATH}. ` +
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
  installCassetteAdapter({ workflow: 'workflow-e-case-report' })
  harness = await makeHarness({
    bundlePath: FIXTURE_PATH,
    templateId: 'case-report',
    phiMode: 'research',
  })
})

afterEach(() => {
  if (!HAS_MCP || !(HAS_CASSETTE || process.env.AEGIS_RECORD === '1')) return
  harness.cleanup()
  uninstallCassetteAdapter()
})

t('Workflow E: case-report draft populates filled_sections, exports md with paper-shape sections, audit kind = report + attestation_kind = research_use', async () => {
  const tmpl = harness.store.getState().currentTemplate
  expect(tmpl?.id).toBe('case-report')
  expect(tmpl?.kind).toBe('report')

  const note = await harness.draftTurn(
    'Draft a publishable case report from this encounter. Wrap each section in the aegis section fences as the system prompt instructs.',
  )
  expect(Object.keys(note.filled_sections).sort()).toEqual([
    'discussion',
    'introduction',
    'investigations',
    'management',
    'outcome',
    'presentation',
  ])
  for (const v of Object.values(note.filled_sections)) {
    expect(v.length).toBeGreaterThan(0)
  }

  const dir = mkdtempSync(join(tmpdir(), 'aegis-wf-e-'))
  const target = join(dir, 'case-report.md')
  const result = await harness.runExport({ target, format: 'md', mode: 'redacted' })
  expect(result.ok).toBe(true)
  expect(existsSync(target)).toBe(true)
  const body = readFileSync(target, 'utf-8')
  expect(body).toContain('# Case Report')
  expect(body).toContain('## Introduction')
  expect(body).toContain('## Case Presentation')
  expect(body).toContain('## Investigations')
  expect(body).toContain('## Management')
  expect(body).toContain('## Outcome and Follow-up')
  expect(body).toContain('## Discussion')

  const auditPath = harness.store.getState().auditLogPath
  expect(auditPath).not.toBeNull()
  const auditLines = readFileSync(auditPath!, 'utf-8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
  const completed = auditLines.find((e: any) => e.type === 'note_export_completed') as any
  expect(completed).toBeDefined()
  expect(completed.attestation_kind).toBe('research_use')
})
