import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildMedicalMiddleware } from '../../../src/medical/runtime/middlewareWiring.js'
import { unwrapRedacted } from '../../../src/medical/middleware/phiMiddleware.js'
import type { DeIdentifier } from '../../../src/medical/deid/DeIdentifier.js'

const TOKENS = ['John Doe', 'Jane Roe', '1958-04-12', '12345678', 'jdoe@example.com']
const stubDeid: DeIdentifier = {
  redact: async (text: string) => {
    let r = text
    const entries: Record<string, { type: string; original: string }> = {}
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

test('non-streaming fallback payload contains zero PHI tokens', async () => {
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
  const ctx = { requestId: 'rf', phiMapping: null }
  const req = { messages: [{ role: 'user', content: phi }], system: phi }
  let payload: any = req
  for (const mw of chain.outbound) payload = await mw.process(payload, ctx)
  const wire = JSON.stringify(unwrapRedacted(payload))
  for (const t of TOKENS) {
    expect(wire.includes(t)).toBe(false)
  }
})
