import { test, expect, beforeEach, afterEach, afterAll } from 'bun:test'
import { join } from 'node:path'
import { existsSync, writeFileSync } from 'node:fs'
import {
  installCassetteAdapter,
  uninstallCassetteAdapter,
} from '../lib/cassetteAdapter.js'
import {
  makeHarness,
  defaultHarnessCallTool,
  buildRedactedDraftRequest,
} from '../lib/workflowHarness.js'
import { aegisMcpBinPath, closeSharedMcpClient } from '../lib/spawnMcp.js'
import type { CallMcpTool } from '../../src/medical/adapters/fhirAdapter.js'

const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'synthea_minimal.json')
const HAS_MCP = existsSync(aegisMcpBinPath())
const t = HAS_MCP ? test : test.skip
if (process.env.AEGIS_RECORD === '1' && !HAS_MCP) {
  throw new Error(
    'AEGIS_RECORD=1 against validator-planted-hallucination requires aegis-mcp venv at ' +
      aegisMcpBinPath() +
      ' — run scripts/generate-mcp-config.sh first.',
  )
}

afterAll(() => closeSharedMcpClient())

const CASSETTE_DIR = join(__dirname, '..', 'cassettes')
const CASSETTE_PATH = join(CASSETTE_DIR, 'planted-hallucination.jsonl')

const PLANTED_PROMPT = 'Draft a SOAP note. Use the aegis section fences for each section.'

const PLANTED_RESPONSE_TEXT =
  '<!-- aegis:section=subjective -->\nCHF f/u.\n<!-- aegis:section=end -->\n' +
  '<!-- aegis:section=objective -->\nPotassium was 5.4 mmol/L.\n<!-- aegis:section=end -->\n' +
  '<!-- aegis:section=assessment -->\nStable.\n<!-- aegis:section=end -->\n' +
  '<!-- aegis:section=plan -->\nContinue lisinopril.\n<!-- aegis:section=end -->\n'

let harness: Awaited<ReturnType<typeof makeHarness>>

const stubCallTool: CallMcpTool = async (name, args) => {
  if (name === 'validate_clinical_note') {
    return JSON.stringify([
      {
        check: 'labs',
        severity: 'warn',
        message: 'Reported potassium 5.4 mmol/L does not match source bundle (4.2 mmol/L).',
        evidence: { extracted: '5.4', source: '4.2' },
      },
    ])
  }
  return defaultHarnessCallTool(name, args)
}

// 30s timeout: the first integration test to call `makeHarness` pays the
// MCP-server cold-start cost (spawn aegis-mcp Python subprocess, load
// spaCy model). On CI's fresh container that easily exceeds Bun's
// default 5s hook timeout; local machines with a warm venv stay well
// under. Subsequent tests share the MCP client and finish in <1s.
beforeEach(async () => {
  if (!HAS_MCP) return
  harness = await makeHarness({
    bundlePath: FIXTURE_PATH,
    templateId: 'soap',
    phiMode: 'research',
    callTool: stubCallTool,
  })
  const built = await buildRedactedDraftRequest({
    store: harness.store,
    callTool: stubCallTool,
    phiMode: 'research',
    userPrompt: PLANTED_PROMPT,
  })
  const line = JSON.stringify({
    requestHash: built.requestHash,
    request: built.canonicalRequest,
    response: {
      kind: 'message',
      message: {
        id: 'msg_planted',
        role: 'assistant',
        type: 'message',
        model: 'claude-haiku-4-5-20251001',
        content: [{ type: 'text', text: PLANTED_RESPONSE_TEXT }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    },
  })
  writeFileSync(CASSETTE_PATH, line + '\n')
  installCassetteAdapter({ workflow: 'planted-hallucination' })
}, 30_000)

afterEach(() => {
  if (!HAS_MCP) return
  harness.cleanup()
  uninstallCassetteAdapter()
})

t('validator labs check fires on a fabricated potassium value', async () => {
  await harness.draftTurn(PLANTED_PROMPT)
  const slice = harness.store.getState().validatorWarnings ?? []
  const labsWarning = slice.find((w: any) => w.check === 'labs')
  expect(labsWarning).toBeDefined()
  expect(labsWarning!.severity).toBe('warn')
  expect((labsWarning!.evidence as any).extracted).toBe('5.4')
})
