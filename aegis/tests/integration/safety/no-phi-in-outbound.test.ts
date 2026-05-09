import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildMedicalMiddleware } from '../../../src/medical/runtime/middlewareWiring.js'
import { unwrapRedacted } from '../../../src/medical/middleware/phiMiddleware.js'
import type { DeIdentifier } from '../../../src/medical/deid/DeIdentifier.js'

// Deterministic stand-in for the real Presidio engine. The point of this test
// is to lock down the middleware's discipline (every text path is processed),
// not Presidio's coverage — that's covered by aegis-mcp's own tests.
const TOKENS = [
  'John Doe',
  'Jane Roe',
  '1958-04-12',
  '2026-04-22',
  '12345678',
  '555-867-5309',
  'jdoe@example.com',
]
const stubDeid: DeIdentifier = {
  redact: async (text: string) => {
    const entries: Record<string, { type: 'ID'; original: string }> = {}
    let r = text
    let i = 1
    for (const t of TOKENS) {
      if (r.includes(t)) {
        const k = `<X_${i++}>`
        entries[k] = { type: 'ID', original: t }
        r = r.replaceAll(t, k)
      }
    }
    return { redacted: r, mapping: { entries, version: 'stub' } }
  },
  restore: async (t: string) => t,
}

test('PHI tokens never appear in the outbound payload after the chain runs', async () => {
  const phi = readFileSync(
    join(import.meta.dir, '..', '..', 'fixtures', 'phi-input.txt'),
    'utf-8',
  )
  const chain = buildMedicalMiddleware({
    deid: stubDeid,
    logger: { append: async () => {}, close: async () => {} },
    mode: 'strict',
    setNote: () => {},
    isDraftingContext: () => false,
  })
  const ctx = { requestId: 'r1', phiMapping: null }
  const req = {
    model: 'claude-sonnet-4-6',
    system: phi,
    messages: [
      { role: 'user', content: phi },
      { role: 'assistant', content: [{ type: 'text', text: phi }] },
    ],
  }
  let payload: any = req
  for (const mw of chain.outbound) payload = await mw.process(payload, ctx)
  const wire = JSON.stringify(unwrapRedacted(payload))
  for (const tok of TOKENS) {
    expect(wire.includes(tok)).toBe(false)
  }
})
