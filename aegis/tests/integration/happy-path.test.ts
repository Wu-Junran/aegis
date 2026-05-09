import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadPatient } from '../../src/medical/adapters/fhirAdapter.js'
import { appendClinicalOverlay } from '../../src/medical/prompts/clinicalSystemPrompt.js'
import { createTemplateRegistry } from '../../src/medical/templates/templateRegistry.js'
import {
	getDefaultAppState,
	type AppState,
} from '../../src/state/AppStateStore.js'
import { createStore } from '../../src/state/store.js'

const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'synthea_minimal.json')

function makeTestStore() {
	return createStore<AppState>(getDefaultAppState())
}

test('adapter → setState → appendClinicalOverlay surfaces fixture facts in the drafting prompt', async () => {
	const fixtureBundle = readFileSync(FIXTURE_PATH, 'utf8')
	expect(fixtureBundle.length).toBeGreaterThan(0)

	const parsedContext = {
		patientId: 'pat-001',
		demographics: { gender: 'male', birthDate: '1958-03-12' },
		problems: [
			{
				resourceType: 'Condition',
				code: { text: 'Congestive heart failure' },
			},
		],
		medications: [
			{
				resourceType: 'MedicationRequest',
				medicationCodeableConcept: { text: 'Lisinopril 10mg' },
			},
		],
		allergies: [
			{
				resourceType: 'AllergyIntolerance',
				code: { text: 'Penicillin allergy' },
			},
		],
		observations: [],
		encounters: [],
		priorNotes: [],
		sourceBundlePath: FIXTURE_PATH,
	}
	const templates = [
		{
			id: 'soap',
			name: 'SOAP',
			source: 'builtin',
			sections: [
				{
					id: 'S',
					title: 'Subjective',
					requiredFields: [],
					promptGuidance: 'patient story',
				},
				{
					id: 'O',
					title: 'Objective',
					requiredFields: [],
					promptGuidance: 'observations',
				},
				{
					id: 'A',
					title: 'Assessment',
					requiredFields: [],
					promptGuidance: 'problems',
				},
				{
					id: 'P',
					title: 'Plan',
					requiredFields: [],
					promptGuidance: 'next steps',
				},
			],
		},
	]

	const callTool = async (name: string, args: any) => {
		if (name === 'fhir_load_bundle') {
			expect(args.path).toBe(FIXTURE_PATH)
			return JSON.stringify(parsedContext)
		}
		if (name === 'list_templates') return JSON.stringify(templates)
		throw new Error(`unexpected tool ${name}`)
	}

	const store = makeTestStore()

	const patient = await loadPatient(FIXTURE_PATH, { callTool })
	store.setState(s => ({ ...s, currentPatient: patient }))

	const reg = createTemplateRegistry({ callTool })
	const template = await reg.getTemplate('soap')
	store.setState(s => ({ ...s, currentTemplate: template }))

	const afterWrites = store.getState()
	expect(afterWrites.currentPatient?.patientId).toBe('pat-001')
	expect(afterWrites.currentTemplate?.id).toBe('soap')

	const baseParts = ['# You are Claude Code', 'Env info: x']
	const finalParts = appendClinicalOverlay(baseParts, store.getState())

	expect(finalParts.length).toBe(baseParts.length + 1)
	const clinical = finalParts[finalParts.length - 1]!
	expect(clinical).toContain('SOAP')
	expect(clinical).toContain('pat-001')
	expect(clinical).toContain('Congestive heart failure')
	expect(clinical).toContain('Lisinopril')
	expect(clinical).toContain('Penicillin')
	expect(clinical).toMatch(
		/Subjective[\s\S]*Objective[\s\S]*Assessment[\s\S]*Plan/,
	)

	// Clear parity: after clearing the patient, overlay is suppressed.
	store.setState(s => ({ ...s, currentPatient: null }))
	expect(appendClinicalOverlay(baseParts, store.getState())).toEqual(
		baseParts,
	)
})
