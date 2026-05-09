import { test, expect } from 'bun:test'
import type {
  AuditEntry,
  AuditLogger,
  PhiMode,
} from '../../../src/medical/audit/AuditLogger.js'
import {
  createAuditOutbound,
  createAuditInbound,
} from '../../../src/medical/middleware/auditMiddleware.js'

function recordingLogger(): AuditLogger & { entries: AuditEntry[] } {
  const entries: AuditEntry[] = []
  return {
    entries,
    async append(e) { entries.push(e) },
    async close() {},
  }
}

const baseCtx = (mapping: any = null) => ({ requestId: 'r-1', phiMapping: mapping })

test('strict-mode outbound writes redactedPayloadHash + entity counts', async () => {
  const log = recordingLogger()
  const out = createAuditOutbound(log, 'strict' satisfies PhiMode)
  const ctx = baseCtx({
    entries: { '<PERSON_1>': { type: 'PERSON', original: 'X' } },
    version: 'v',
  })
  const req = { model: 'm', messages: [] }
  const back = await out.process(req as any, ctx)
  expect(back).toBe(req)  // outbound audit is read-only — passes through
  expect(log.entries).toHaveLength(1)
  expect(log.entries[0]).toMatchObject({
    type: 'llm_request',
    requestId: 'r-1',
    mode: 'strict',
    phiEntityCounts: { PERSON: 1 },
  })
  expect(log.entries[0].redactedPayloadHash).toMatch(/^sha256:/)
  expect(log.entries[0].fullRequest).toBeUndefined()
})

test('research-mode outbound writes plaintext fullRequest', async () => {
  const log = recordingLogger()
  const out = createAuditOutbound(log, 'research')
  const req = { model: 'm', messages: [{ role: 'user', content: 'hi' }] }
  await out.process(req as any, baseCtx())
  expect(log.entries[0].mode).toBe('research')
  expect(log.entries[0].fullRequest).toEqual(req)
  expect(log.entries[0].redactedPayloadHash).toBeUndefined()
})

test('strict-mode inbound logs token usage + warning count, not the body', async () => {
  const log = recordingLogger()
  const inb = createAuditInbound(log, 'strict')
  const res = {
    message: { usage: { input_tokens: 100, output_tokens: 50 } },
    warnings: ['fab_lab'],
  }
  await inb.process(res as any, baseCtx())
  expect(log.entries[0]).toMatchObject({
    type: 'llm_response',
    mode: 'strict',
    usage: { input_tokens: 100, output_tokens: 50 },
    warningCount: 1,
  })
  expect((log.entries[0] as any).fullResponse).toBeUndefined()
})

test('research-mode inbound logs full plaintext response', async () => {
  const log = recordingLogger()
  const inb = createAuditInbound(log, 'research')
  const res = { message: { content: [{ type: 'text', text: 'hi' }] } }
  await inb.process(res as any, baseCtx())
  expect((log.entries[0] as any).fullResponse).toEqual(res)
})

test('COMPOSED research-mode chain: fullRequest is the RAW payload (not the redacted one)', async () => {
  // Regression for the audit+phi composition bug: `buildMedicalMiddleware`
  // runs phi.outbound → audit.outbound. phi.outbound mutates `req` in place,
  // so without a raw snapshot audit.outbound would log the REDACTED request
  // as `fullRequest` — contradicting the research-mode contract and the
  // REPL banner that promises "payloads logged in plaintext".
  //
  // This test runs the middlewares THROUGH `buildMedicalMiddleware` the
  // exact way claude.ts does, so the composition is under test, not each
  // middleware in isolation.
  const { buildMedicalMiddleware } = await import(
    '../../../src/medical/runtime/middlewareWiring.js'
  )
  const { unwrapRedacted } = await import(
    '../../../src/medical/middleware/phiMiddleware.js'
  )
  // Minimal deid that replaces "John Doe" → "<PERSON_1>".
  const deid = {
    redact: async (t: string) => ({
      redacted: t.replaceAll('John Doe', '<PERSON_1>'),
      mapping: {
        entries: { '<PERSON_1>': { type: 'PERSON', original: 'John Doe' } },
        version: 'test',
      },
    }),
    restore: async (t: string) => t.replaceAll('<PERSON_1>', 'John Doe'),
  }
  const log = recordingLogger()
  const chain = buildMedicalMiddleware({
    deid,
    logger: log,
    mode: 'research',
    setNote: () => {},
    isDraftingContext: () => false,
  })
  const ctx = {
    requestId: 'r-composed-research',
    phiMapping: null as any,
  }
  const req = {
    model: 'claude-sonnet-4-6',
    system: 'You are drafting for John Doe.',
    messages: [{ role: 'user', content: 'Patient John Doe presented.' }],
  }
  let payload: any = req
  for (const mw of chain.outbound) payload = await mw.process(payload, ctx as any)

  // The payload the SDK would see is REDACTED.
  const wire = JSON.stringify(unwrapRedacted(payload))
  expect(wire).not.toContain('John Doe')
  expect(wire).toContain('<PERSON_1>')

  // The audit log's fullRequest is the RAW plaintext — not what hit the wire.
  const reqEntry = log.entries.find((e) => e.type === 'llm_request')!
  expect(reqEntry.mode).toBe('research')
  const fullRequest = (reqEntry as any).fullRequest
  const fullRequestJson = JSON.stringify(fullRequest)
  expect(fullRequestJson).toContain('John Doe') // ← the bug: was missing
  expect(fullRequestJson).not.toContain('<PERSON_1>') // ← proves it's the snapshot, not a sub-restore
  // Structural round-trip: snapshot equals the original request object.
  expect(fullRequest.system).toBe('You are drafting for John Doe.')
  expect(fullRequest.messages[0].content).toBe('Patient John Doe presented.')
})

test('COMPOSED strict-mode chain: no fullRequest; redactedPayloadHash present and hashes the REDACTED payload', async () => {
  // Control for the research test above — strict mode keeps the pre-fix
  // behavior: hash of the POST-redaction payload (that's what got sent),
  // no fullRequest.
  const { buildMedicalMiddleware } = await import(
    '../../../src/medical/runtime/middlewareWiring.js'
  )
  const { unwrapRedacted } = await import(
    '../../../src/medical/middleware/phiMiddleware.js'
  )
  const deid = {
    redact: async (t: string) => ({
      redacted: t.replaceAll('John Doe', '<PERSON_1>'),
      mapping: {
        entries: { '<PERSON_1>': { type: 'PERSON', original: 'John Doe' } },
        version: 'test',
      },
    }),
    restore: async (t: string) => t.replaceAll('<PERSON_1>', 'John Doe'),
  }
  const log = recordingLogger()
  const chain = buildMedicalMiddleware({
    deid,
    logger: log,
    mode: 'strict',
    setNote: () => {},
    isDraftingContext: () => false,
  })
  const ctx = { requestId: 'r-composed-strict', phiMapping: null as any }
  const req = {
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'Patient John Doe presented.' }],
  }
  let payload: any = req
  for (const mw of chain.outbound) payload = await mw.process(payload, ctx as any)

  const reqEntry = log.entries.find((e) => e.type === 'llm_request')!
  expect(reqEntry.mode).toBe('strict')
  expect((reqEntry as any).fullRequest).toBeUndefined()
  expect((reqEntry as any).redactedPayloadHash).toMatch(/^sha256:/)
  // The hash is over the REDACTED payload — proving strict mode logs what
  // hit the wire, not the plaintext.
  const { sha256Hex } = await import('../../../src/medical/audit/redaction.js')
  const expectedHash = sha256Hex(JSON.stringify(unwrapRedacted(payload)))
  expect((reqEntry as any).redactedPayloadHash).toBe(expectedHash)
})

test('COMPOSED research-mode INBOUND chain: fullResponse is the RESTORED plaintext (not the placeholders)', async () => {
  // Symmetric regression-defense for the inbound side. Plan order is
  // [phi.inbound, audit.inbound]: phi.inbound restores placeholders → plaintext,
  // THEN audit.inbound logs `fullResponse` in research mode. If the order
  // were reversed (audit then phi), audit would log the placeholders and
  // research-mode `fullResponse` would silently violate the spec contract
  // ("research mode: payloads logged in plaintext").
  const { buildMedicalMiddleware } = await import(
    '../../../src/medical/runtime/middlewareWiring.js'
  )
  const deid = {
    redact: async (t: string) => ({
      redacted: t.replaceAll('John Doe', '<PERSON_1>'),
      mapping: {
        entries: { '<PERSON_1>': { type: 'PERSON', original: 'John Doe' } },
        version: 'test',
      },
    }),
    restore: async (t: string) => t.replaceAll('<PERSON_1>', 'John Doe'),
  }
  const log = recordingLogger()
  const chain = buildMedicalMiddleware({
    deid,
    logger: log,
    mode: 'research',
    setNote: () => {},
    isDraftingContext: () => false,
  })
  const ctx = {
    requestId: 'r-inbound-research',
    phiMapping: {
      entries: { '<PERSON_1>': { type: 'PERSON' as const, original: 'John Doe' } },
      version: 'test',
    },
  }
  // Simulate an assistant response that came back with the placeholder
  // intact (the wire shape — phi.inbound hasn't run yet).
  const wireResponse = {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: 'Reviewing <PERSON_1> now.' }],
    },
  }
  let restored: any = wireResponse
  for (const mw of chain.inbound) restored = await mw.process(restored, ctx as any)

  // The restored response (what downstream consumers see) has plaintext.
  expect(restored.message.content[0].text).toBe('Reviewing John Doe now.')

  // The audit's fullResponse is the PLAINTEXT view — symmetric to outbound's
  // plaintext fullRequest. Pin both directions: contains "John Doe" AND
  // does NOT contain "<PERSON_1>".
  const respEntry = log.entries.find((e) => e.type === 'llm_response')!
  expect(respEntry.mode).toBe('research')
  const fullResponse = (respEntry as any).fullResponse
  const fullResponseJson = JSON.stringify(fullResponse)
  expect(fullResponseJson).toContain('John Doe') // ← would fail if order were [audit, phi]
  expect(fullResponseJson).not.toContain('<PERSON_1>')
})

test('off mode: buildMedicalMiddleware returns empty chains (pure Claude Code per spec §6.4)', async () => {
  const { buildMedicalMiddleware } = await import(
    '../../../src/medical/runtime/middlewareWiring.js'
  )
  const log = recordingLogger()
  const deid = {
    redact: async () => ({ redacted: '', mapping: { entries: {}, version: 'noop' } }),
    restore: async (t: string) => t,
  }
  const chain = buildMedicalMiddleware({
    deid,
    logger: log,
    mode: 'off',
    setNote: () => {},
    isDraftingContext: () => false,
  })
  expect(chain.outbound).toEqual([])
  expect(chain.inbound).toEqual([])
})

test('strict mode wires phi + audit + notePersist in correct order', async () => {
  const { buildMedicalMiddleware } = await import(
    '../../../src/medical/runtime/middlewareWiring.js'
  )
  const log = recordingLogger()
  const deid = {
    redact: async (t: string) => ({ redacted: t, mapping: { entries: {}, version: 'v' } }),
    restore: async (t: string) => t,
  }
  const chain = buildMedicalMiddleware({
    deid,
    logger: log,
    mode: 'strict',
    setNote: () => {},
    isDraftingContext: () => false,
    callTool: async () => '[]',
    getPatientContext: () => null,
    getTemplate: () => null,
    pushValidatorWarnings: () => {},
  } as any)
  expect(chain.outbound.map((m) => m.name)).toEqual(['phi.outbound', 'audit.outbound'])
  expect(chain.inbound.map((m) => m.name)).toEqual(['phi.inbound', 'notePersist', 'clinicalValidator', 'audit.inbound'])
})

test('research mode wires phi + audit + notePersist in correct order', async () => {
  const { buildMedicalMiddleware } = await import(
    '../../../src/medical/runtime/middlewareWiring.js'
  )
  const log = recordingLogger()
  const deid = {
    redact: async (t: string) => ({ redacted: t, mapping: { entries: {}, version: 'v' } }),
    restore: async (t: string) => t,
  }
  const chain = buildMedicalMiddleware({
    deid,
    logger: log,
    mode: 'research',
    setNote: () => {},
    isDraftingContext: () => false,
    callTool: async () => '[]',
    getPatientContext: () => null,
    getTemplate: () => null,
    pushValidatorWarnings: () => {},
  } as any)
  expect(chain.inbound.map((m) => m.name)).toEqual(['phi.inbound', 'notePersist', 'clinicalValidator', 'audit.inbound'])
})
