import { expect, test } from 'bun:test'
import type { AuditLogger } from '../../../src/medical/audit/AuditLogger.js'
import type { DeIdentifier } from '../../../src/medical/deid/DeIdentifier.js'
import { buildMedicalMiddleware } from '../../../src/medical/runtime/middlewareWiring.js'

const fakeDeid: DeIdentifier = {
	redact: async (t: string) => ({
		redacted: t,
		mapping: { entries: {}, version: 'v' },
	}),
	restore: async (t: string) => t,
}
const fakeLog: AuditLogger = { append: async () => {}, close: async () => {} }

test('strict mode wires phi + audit + notePersist', () => {
	const c = buildMedicalMiddleware({
		deid: fakeDeid,
		logger: fakeLog,
		mode: 'strict',
		setNote: () => {},
		isDraftingContext: () => false,
		callTool: async () => '[]',
		getPatientContext: () => null,
		getTemplate: () => null,
		pushValidatorWarnings: () => {},
	} as any)
	expect(c.outbound.map((m) => m.name)).toEqual(['phi.outbound', 'audit.outbound'])
	expect(c.inbound.map((m) => m.name)).toEqual(['phi.inbound', 'notePersist', 'clinicalValidator', 'audit.inbound'])
})

test('off mode returns empty chains (handled by claude.ts bypass)', () => {
	const c = buildMedicalMiddleware({
		deid: fakeDeid,
		logger: fakeLog,
		mode: 'off',
		setNote: () => {},
		isDraftingContext: () => false,
		callTool: async () => '[]',
		getPatientContext: () => null,
		getTemplate: () => null,
		pushValidatorWarnings: () => {},
	} as any)
	expect(c.outbound).toHaveLength(0)
	expect(c.inbound).toHaveLength(0)
})

test('inbound chain order: phi → notePersist → clinicalValidator → audit (P1#2)', () => {
  const chain = buildMedicalMiddleware({
    deid: { redact: async () => ({ redacted: '', mapping: { entries: {}, version: 'x' } }), restore: async s => s },
    logger: { append: async () => {}, close: async () => {} },
    mode: 'strict',
    setNote: () => {},
    isDraftingContext: () => true,
    callTool: async () => '[]',
    getPatientContext: () => null,
    getTemplate: () => null,
    pushValidatorWarnings: () => {},
  } as any)
  expect(chain.inbound.map(m => m.name)).toEqual([
    'phi.inbound',
    'notePersist',
    'clinicalValidator',
    'audit.inbound',
  ])
})

test('audit.inbound observes warningCount > 0 after validator decorates res (P1#2)', async () => {
  const audit: any[] = []
  const chain = buildMedicalMiddleware({
    deid: { redact: async () => ({ redacted: '', mapping: { entries: {}, version: 'x' } }), restore: async s => s },
    logger: { append: async e => audit.push(e), close: async () => {} },
    mode: 'strict',
    setNote: () => {},
    isDraftingContext: () => true,
    callTool: async (name: string) => {
      if (name === 'validate_clinical_note') {
        return JSON.stringify([
          { check: 'dose', severity: 'warn', message: 'Potential overdose', evidence: {} },
          { check: 'dates', severity: 'info', message: 'Date outside window', evidence: {} },
        ])
      }
      return '[]'
    },
    getPatientContext: () => ({ patientId: 'p1', demographics: {}, problems: [], medications: [], allergies: [], observations: [], encounters: [], priorNotes: [] }) as any,
    getTemplate: () => ({ id: 'soap', name: 'SOAP', source: 'builtin', sections: [] }) as any,
    pushValidatorWarnings: () => {},
  } as any)
  const ctx: any = { requestId: 'r1', phiMapping: null }
  let res: any = { message: { content: [{ type: 'text', text: 'Lisinopril 100mg daily.' }] } }
  for (const mw of chain.inbound) {
    res = await mw.process(res, ctx)
  }
  const llm = audit.find(e => e.type === 'llm_response')
  expect(llm).toBeTruthy()
  expect(llm.warningCount).toBe(2)
})
