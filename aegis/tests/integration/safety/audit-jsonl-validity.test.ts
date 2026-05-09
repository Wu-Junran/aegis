import { test, expect, afterEach } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openAuditLogger } from '../../../src/medical/audit/AuditLogger.js'
import { buildMedicalMiddleware } from '../../../src/medical/runtime/middlewareWiring.js'
import type { DeIdentifier } from '../../../src/medical/deid/DeIdentifier.js'

const tmps: string[] = []
afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true })
})

const fakeDeid: DeIdentifier = {
  redact: async (text: string) => ({
    redacted: text.replaceAll('John Doe', '<PERSON_1>'),
    mapping: {
      entries: { '<PERSON_1>': { type: 'PERSON', original: 'John Doe' } },
      version: 'fake-1',
    },
  }),
  restore: async (t: string) => t,
}

async function exerciseChain(
  mode: 'strict' | 'research',
  logPath: string,
): Promise<void> {
  const logger = openAuditLogger(logPath, mode)
  const chain = buildMedicalMiddleware({
    deid: fakeDeid,
    logger,
    mode,
    setNote: () => {},
    isDraftingContext: () => false,
  })
  for (let i = 0; i < 5; i++) {
    const ctx = { requestId: `r-${i}`, phiMapping: null }
    let req: any = {
      model: 'm',
      messages: [{ role: 'user', content: `John Doe note ${i}` }],
    }
    for (const mw of chain.outbound) req = await mw.process(req, ctx)
    let res: any = {
      message: {
        content: [{ type: 'text', text: `Hi <PERSON_1> ${i}.` }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    }
    for (const mw of chain.inbound) res = await mw.process(res, ctx)
  }
  await logger.close()
}

test('strict mode: every line is valid JSON, mode field always strict, no plaintext bodies', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-audit-'))
  tmps.push(dir)
  const path = join(dir, 'session.jsonl')
  await exerciseChain('strict', path)
  const lines = readFileSync(path, 'utf-8').trim().split('\n')
  expect(lines.length).toBeGreaterThan(0)
  for (const line of lines) {
    const obj = JSON.parse(line)
    expect(obj.mode).toBe('strict')
    expect(obj.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(typeof obj.requestId).toBe('string')
    // Strict-mode invariant: no plaintext request/response bodies.
    expect(obj.fullRequest).toBeUndefined()
    expect(obj.fullResponse).toBeUndefined()
  }
})

test('research mode: every line carries the literal request/response bodies', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-audit-'))
  tmps.push(dir)
  const path = join(dir, 'session.jsonl')
  await exerciseChain('research', path)
  const lines = readFileSync(path, 'utf-8').trim().split('\n')
  for (const line of lines) {
    const obj = JSON.parse(line)
    expect(obj.mode).toBe('research')
    if (obj.type === 'llm_request') expect(obj.fullRequest).toBeDefined()
    if (obj.type === 'llm_response') expect(obj.fullResponse).toBeDefined()
  }
})

test('ordering: request always precedes its matching response per requestId', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-audit-'))
  tmps.push(dir)
  const path = join(dir, 'session.jsonl')
  await exerciseChain('strict', path)
  const events = readFileSync(path, 'utf-8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
  const seen: Record<string, string[]> = {}
  for (const e of events) {
    seen[e.requestId] = seen[e.requestId] ?? []
    seen[e.requestId].push(e.type)
  }
  for (const rid of Object.keys(seen)) {
    const types = seen[rid]
    expect(types[0]).toBe('llm_request')
    expect(types[1]).toBe('llm_response')
  }
})
