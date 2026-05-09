import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildMedicalMiddleware } from '../../../src/medical/runtime/middlewareWiring.js'
import { unwrapRedacted } from '../../../src/medical/middleware/phiMiddleware.js'
import type { DeIdentifier } from '../../../src/medical/deid/DeIdentifier.js'
import { medicalPermissionRules } from '../../../src/medical/permissions/medicalRules.js'

// The middleware is content-agnostic: its job is to redact PHI, not to
// detect injection. The defense against the injection text *executing* lives
// in the permission system (Bash/Write alwaysAsk, WebFetch alwaysDeny).
// This test asserts BOTH defenses are in place: the injection text traverses
// the chain unchanged from a content perspective, AND the permission rules
// would block the malicious tool calls the attacker tried to elicit.

const passDeid: DeIdentifier = {
  redact: async (t: string) => ({
    redacted: t,
    mapping: { entries: {}, version: 'v' },
  }),
  restore: async (t: string) => t,
}

test('prompt-injection text in FHIR Observation traverses chain unchanged (content-agnostic)', async () => {
  const bundle = JSON.parse(
    readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'fixtures',
        'fhir-prompt-injection.json',
      ),
      'utf-8',
    ),
  )
  const obs = bundle.entry[1].resource
  const chain = buildMedicalMiddleware({
    deid: passDeid,
    logger: { append: async () => {}, close: async () => {} },
    mode: 'strict',
    setNote: () => {},
    isDraftingContext: () => false,
  })
  const ctx = { requestId: 'inj-1', phiMapping: null }
  let payload: any = {
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'q1',
            // The injection arrives as a tool_result (typical fhir_query path).
            content: [{ type: 'text', text: obs.valueString }],
          },
        ],
      },
    ],
  }
  for (const mw of chain.outbound) payload = await mw.process(payload, ctx)
  const wire = JSON.stringify(unwrapRedacted(payload))
  // Content-agnostic: the text passes through. The defense is the permission
  // gate, asserted in the second test below.
  expect(wire).toContain('IGNORE PREVIOUS INSTRUCTIONS')
})

test('permission rules block the tool calls the injection asks for', () => {
  const rules = Object.fromEntries(
    medicalPermissionRules().map((r) => [r.toolName, r.behavior]),
  )
  // The injection text asks for Write(/etc/passwd) and WebFetch(attacker URL).
  // Spec §6.3 mandates:
  expect(rules['Write']).toBe('ask') // Write is gated, not auto-allowed
  expect(rules['WebFetch']).toBe('deny') // WebFetch is hard-denied
  // So even if the LLM honors the injection, neither tool call can fire
  // without (a) explicit clinician confirmation for Write or (b) at all
  // for WebFetch.
})
