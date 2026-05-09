import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildMedicalMiddleware } from '../../../src/medical/runtime/middlewareWiring.js'
import { unwrapRedacted } from '../../../src/medical/middleware/phiMiddleware.js'
import type { DeIdentifier } from '../../../src/medical/deid/DeIdentifier.js'

// Adding a row to fixtures/regression-cases.json is the only motion needed
// when a new known-hard case surfaces. The deterministic deid below catches
// the seeded cases; the live Presidio run is exercised by the aegis-mcp
// Python tests + Gate B clinician-machine smoke.

type Case = { name: string; input: string; mustNotAppear: string[] }

const cases = JSON.parse(
  readFileSync(
    join(import.meta.dir, '..', '..', 'fixtures', 'regression-cases.json'),
    'utf-8',
  ),
) as Case[]

function makeStubDeid(): DeIdentifier {
  // Detect any token that appears in any case's mustNotAppear list.
  const all = new Set<string>()
  for (const c of cases) for (const t of c.mustNotAppear) all.add(t)
  return {
    redact: async (text: string) => {
      let r = text
      const entries: Record<string, { type: 'ID'; original: string }> = {}
      let i = 1
      for (const t of all) {
        if (r.includes(t)) {
          const k = `<X_${i++}>`
          entries[k] = { type: 'ID', original: t }
          r = r.replaceAll(t, k)
        }
      }
      return { redacted: r, mapping: { entries, version: 'stub-suite' } }
    },
    restore: async (t: string) => t,
  }
}

test.each(cases)('regression case: $name', async (c) => {
  const chain = buildMedicalMiddleware({
    deid: makeStubDeid(),
    logger: { append: async () => {}, close: async () => {} },
    mode: 'strict',
    setNote: () => {},
    isDraftingContext: () => false,
  })
  const ctx = { requestId: c.name, phiMapping: null }
  let req: any = {
    system: c.input,
    messages: [
      { role: 'user', content: c.input },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't', content: c.input }],
      },
    ],
  }
  for (const mw of chain.outbound) req = await mw.process(req, ctx)
  const wire = JSON.stringify(unwrapRedacted(req))
  for (const must of c.mustNotAppear) {
    expect(wire.includes(must)).toBe(false)
  }
})
