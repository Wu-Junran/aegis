import { test, expect, mock } from 'bun:test'
import { createClinicalValidator } from '../../../src/medical/middleware/clinicalValidator.js'
import type { ValidatorWarning } from '../../../src/medical/state/validatorWarnings.js'

const PATIENT = {
	patientId: 'p1',
	demographics: {},
	problems: [], medications: [], allergies: [], observations: [], encounters: [], priorNotes: [],
}

const TEMPLATE = {
	id: 'soap', name: 'SOAP', source: 'builtin' as const,
	sections: [{ id: 'plan', title: 'Plan', requiredFields: [], promptGuidance: '' }],
}

test('calls validate_clinical_note with checks 1-4 + pushes + decorates res.warnings (P1#2)', async () => {
	const calls: any[] = []
	const callTool = mock(async (name: string, args: any) => {
		calls.push({ name, args })
		return JSON.stringify([
			{ check: 'dose', severity: 'warn', message: 'overdose', evidence: {} },
		])
	})
	let pushed: ValidatorWarning[] | null = null
	const mw = createClinicalValidator({
		callTool: callTool as any,
		getPatientContext: () => PATIENT,
		getTemplate: () => TEMPLATE,
		isDraftingContext: () => true,
		pushValidatorWarnings: ws => { pushed = ws },
	})
	const ctx = { requestId: 'r1', phiMapping: null }
	const out = await mw.process(
		{ message: { content: [{ type: 'text', text: 'Lisinopril 1000mg daily.' }] } } as any,
		ctx as any,
	)
	expect(calls).toHaveLength(1)
	expect(calls[0].name).toBe('validate_clinical_note')
	expect(calls[0].args.checks).toEqual(['dose', 'dates', 'labs', 'allergies'])
	expect(pushed).not.toBeNull()
	expect(pushed?.length).toBe(1)
	expect(pushed?.[0]?.check).toBe('dose')
	expect((out as any).warnings).toEqual(pushed)
	expect((out as any).message.content[0].text).toBe('Lisinopril 1000mg daily.')
})

test('skips when not in drafting context', async () => {
	const callTool = mock(async () => '[]')
	const pushed: ValidatorWarning[][] = []
	const mw = createClinicalValidator({
		callTool: callTool as any,
		getPatientContext: () => null,
		getTemplate: () => null,
		isDraftingContext: () => false,
		pushValidatorWarnings: ws => pushed.push(ws),
	})
	await mw.process(
		{ message: { content: [{ type: 'text', text: 'x' }] } } as any,
		{ requestId: 'r1', phiMapping: null } as any,
	)
	expect(callTool).toHaveBeenCalledTimes(0)
	expect(pushed).toEqual([])
})

test('swallow MCP errors and push empty warnings (also decorates res.warnings = [])', async () => {
	const callTool = mock(async () => { throw new Error('mcp boom') })
	let pushed: ValidatorWarning[] | null = null
	const mw = createClinicalValidator({
		callTool: callTool as any,
		getPatientContext: () => PATIENT,
		getTemplate: () => TEMPLATE,
		isDraftingContext: () => true,
		pushValidatorWarnings: ws => { pushed = ws },
	})
	const out = await mw.process(
		{ message: { content: [{ type: 'text', text: 'x' }] } } as any,
		{ requestId: 'r1', phiMapping: null } as any,
	)
	expect(pushed).toEqual([])
	expect((out as any).warnings).toEqual([])
})
