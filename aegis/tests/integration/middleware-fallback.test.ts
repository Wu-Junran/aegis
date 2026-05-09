import { test, expect } from 'bun:test'
import { buildMedicalMiddleware } from '../../src/medical/runtime/middlewareWiring.js'
import { unwrapRedacted } from '../../src/medical/middleware/phiMiddleware.js'
import type { DeIdentifier } from '../../src/medical/deid/DeIdentifier.js'

const fakeDeid: DeIdentifier = {
  redact: async (text: string) => ({
    redacted: text.replaceAll('John Doe', '<PERSON_1>'),
    mapping: {
      entries: { '<PERSON_1>': { type: 'PERSON', original: 'John Doe' } },
      version: 'v',
    },
  }),
  restore: async (t: string) => t.replaceAll('<PERSON_1>', 'John Doe'),
}

test('non-streaming fallback: outbound + inbound run with the SAME chain', async () => {
  const log: any[] = []
  const chain = buildMedicalMiddleware({
    deid: fakeDeid,
    logger: { append: async (e: any) => { log.push(e) }, close: async () => {} },
    mode: 'strict',
    setNote: () => {},
    isDraftingContext: () => false,
  })
  const ctx = { requestId: 'rf-1', phiMapping: null }
  const req = {
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'Patient John Doe presented.' }],
  }
  // Outbound (what would hit sendRedactedRequestNonStreaming)
  let payload: any = req
  for (const mw of chain.outbound) payload = await mw.process(payload, ctx)
  expect(JSON.stringify(unwrapRedacted(payload))).not.toContain('John Doe')
  // Inbound (what the caller would do on the BetaMessage→AssistantMessage)
  let res: any = {
    message: { content: [{ type: 'text', text: 'Hi <PERSON_1>.' }], usage: { input_tokens: 0, output_tokens: 0 } },
  }
  for (const mw of chain.inbound) res = await mw.process(res, ctx)
  expect(res.message.content[0].text).toBe('Hi John Doe.')
  expect(log.find((e) => e.type === 'llm_request')).toBeDefined()
  expect(log.find((e) => e.type === 'llm_response')).toBeDefined()
})
