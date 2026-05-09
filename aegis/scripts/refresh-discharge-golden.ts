#!/usr/bin/env bun
/**
 * Re-render aegis/tests/fixtures/discharge-golden.pdf from the current
 * Workflow B cassette + harness path. Run after build-workflow-cassettes.ts
 * if the discharge synthetic response or the renderer changes.
 *
 * Why this exists separately: the renderer is byte-stable, so once a cassette
 * is committed the golden has to match the exact bytes the synthetic
 * response yields through redact → render → markdownToPdf. Hand-tweaking
 * the golden is brittle; running the real path and snapshotting is robust.
 */

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  installCassetteAdapter,
  uninstallCassetteAdapter,
} from '../tests/lib/cassetteAdapter.js'
import { makeHarness } from '../tests/lib/workflowHarness.js'
import { closeSharedMcpClient } from '../tests/lib/spawnMcp.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..')
const FIXTURES = join(REPO_ROOT, 'tests', 'fixtures')
const ADMISSION_FIXTURE = join(FIXTURES, 'synthea_admission_bundle.json')
const GOLDEN_PATH = join(FIXTURES, 'discharge-golden.pdf')
const CASSETTE_PATH = join(REPO_ROOT, 'tests', 'cassettes', 'workflow-b-discharge.jsonl')

async function main(): Promise<void> {
  if (!existsSync(CASSETTE_PATH)) {
    throw new Error(`cassette not found: ${CASSETTE_PATH}\n  Run scripts/build-workflow-cassettes.ts first.`)
  }
  installCassetteAdapter({ workflow: 'workflow-b-discharge' })
  try {
    const harness = await makeHarness({
      bundlePath: ADMISSION_FIXTURE,
      templateId: 'discharge-summary',
      phiMode: 'research',
    })
    await harness.draftTurn(
      'Build the discharge summary; pull HPI from the admission note, list current vs. admission meds, and wrap each section in the aegis section fences.',
    )
    const dir = mkdtempSync(join(tmpdir(), 'aegis-golden-'))
    const target = join(dir, 'discharge.pdf')
    const result = await harness.runExport({ target, format: 'pdf', mode: 'redacted' })
    if (!result.ok) throw new Error(`export failed: ${result.message}`)
    const bytes = readFileSync(target)
    writeFileSync(GOLDEN_PATH, bytes)
    console.log(`refreshed ${GOLDEN_PATH} (${bytes.byteLength} bytes)`)
    harness.cleanup()
  } finally {
    uninstallCassetteAdapter()
    await closeSharedMcpClient()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
