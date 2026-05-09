import { test, expect } from 'bun:test'
import { loadPatient } from '../../src/medical/adapters/fhirAdapter.js'

test('loadPatient returns PatientContext from stubbed callTool', async () => {
	const calls: Array<{ name: string; args: unknown }> = []
	const stubCtx = {
		patientId: 'pat-001',
		demographics: { gender: 'male', birthDate: '1958-03-12' },
		problems: [{ resourceType: 'Condition', id: 'c1' }],
		medications: [],
		allergies: [],
		observations: [],
		encounters: [],
		priorNotes: [],
		sourceBundlePath: '/tmp/x.json',
	}
	const callTool = async (name: string, args: Record<string, unknown>) => {
		calls.push({ name, args })
		return JSON.stringify(stubCtx)
	}
	const result = await loadPatient('/tmp/x.json', { callTool })
	expect(calls).toEqual([
		{ name: 'fhir_load_bundle', args: { path: '/tmp/x.json' } },
	])
	expect(result.patientId).toBe('pat-001')
	expect(result.problems).toHaveLength(1)
})

test('loadPatient propagates MCP error strings as Error', async () => {
	const callTool = async () => {
		throw new Error('bundle not found')
	}
	await expect(loadPatient('/nope.json', { callTool })).rejects.toThrow(
		'bundle not found',
	)
})
