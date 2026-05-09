import { test, expect } from 'bun:test'
import { buildMedicalMiddleware } from '../../src/medical/runtime/middlewareWiring.js'
import type { DeIdentifier } from '../../src/medical/deid/DeIdentifier.js'
import { unwrapRedacted } from '../../src/medical/middleware/phiMiddleware.js'

const regexDeid: DeIdentifier = {
  // Test-only deterministic deid: matches "John Doe" / "Jane Roe" / dates.
  redact: async (text: string) => {
    const PERSONS = ['John Doe', 'Jane Roe']
    const entries: Record<string, { type: 'PERSON'; original: string }> = {}
    let counter = 1
    let r = text
    for (const p of PERSONS) {
      if (r.includes(p)) {
        const k = `<PERSON_${counter}>`
        entries[k] = { type: 'PERSON', original: p }
        r = r.replaceAll(p, k)
        counter++
      }
    }
    return { redacted: r, mapping: { entries, version: 'regex-test-1' } }
  },
  restore: async (text: string, mapping) => {
    let r = text
    for (const [k, v] of Object.entries(mapping.entries)) {
      r = r.replaceAll(k, v.original)
    }
    return r
  },
}

const captureLogger = () => {
  const entries: any[] = []
  return {
    entries,
    append: async (e: any) => {
      entries.push(e)
    },
    close: async () => {},
  }
}

test('outbound redacts every text path; inbound restores only via mapping', async () => {
  const log = captureLogger()
  const chain = buildMedicalMiddleware({
    deid: regexDeid,
    logger: log,
    mode: 'strict',
    setNote: () => {},
    isDraftingContext: () => true,
    // clinicalValidator deps — no-op stubs so the validator short-circuits
    // (getPatientContext returns null → validator returns res unchanged).
    callTool: async () => '[]',
    getPatientContext: () => null,
    getTemplate: () => null,
    pushValidatorWarnings: () => {},
  })
  const ctx = { requestId: 'r1', phiMapping: null }
  const req = {
    model: 'claude-sonnet-4-6',
    system: 'You are drafting for John Doe.',
    messages: [
      { role: 'user', content: 'Patient John Doe and Jane Roe presented.' },
    ],
  }
  let payload: any = req
  for (const mw of chain.outbound) payload = await mw.process(payload, ctx)
  const unwrapped = unwrapRedacted(payload)
  expect(JSON.stringify(unwrapped)).not.toContain('John Doe')
  expect(JSON.stringify(unwrapped)).not.toContain('Jane Roe')
  expect(log.entries.find((e) => e.type === 'llm_request')).toBeDefined()

  // Simulate LLM response containing both placeholders.
  let res: any = {
    message: {
      content: [{ type: 'text', text: 'Hi <PERSON_1> and <PERSON_2>.' }],
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  }
  for (const mw of chain.inbound) res = await mw.process(res, ctx)
  expect(res.message.content[0].text).toBe('Hi John Doe and Jane Roe.')
  expect(log.entries.find((e) => e.type === 'llm_response')).toBeDefined()
})
