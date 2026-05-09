import { test, expect } from 'bun:test'
import {
	appendClinicalOverlay,
	clinicalSystemPromptOverlay,
} from '../../src/medical/prompts/clinicalSystemPrompt.js'
import { getDefaultAppState } from '../../src/state/AppStateStore.js'

const patient = {
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
		{ resourceType: 'AllergyIntolerance', code: { text: 'Penicillin' } },
	],
	observations: [],
	encounters: [],
	priorNotes: [],
}

const template = {
	id: 'soap',
	name: 'SOAP',
	sections: [
		{
			id: 'S',
			title: 'Subjective',
			requiredFields: [],
			promptGuidance: 'patient story',
		},
	],
	source: 'builtin' as const,
}

test('overlay is empty string when patient or template missing', () => {
	expect(clinicalSystemPromptOverlay(null, null)).toBe('')
	expect(clinicalSystemPromptOverlay(patient as any, null)).toBe('')
	expect(clinicalSystemPromptOverlay(null, template)).toBe('')
})

test('overlay includes template name and surfaces fixture facts', () => {
	const out = clinicalSystemPromptOverlay(patient as any, template)
	expect(out).toContain('SOAP')
	expect(out).toContain('pat-001')
	expect(out).toContain('Congestive heart failure')
	expect(out).toContain('Lisinopril')
	expect(out).toContain('Penicillin')
})

test('appendClinicalOverlay returns input unchanged when slots empty', () => {
	const state = getDefaultAppState()
	const parts = ['# You are Claude Code', 'env info']
	expect(appendClinicalOverlay(parts, state)).toEqual(parts)
})

test('appendClinicalOverlay appends one entry when both slots are set', () => {
	const state = {
		...getDefaultAppState(),
		currentPatient: patient as any,
		currentTemplate: template,
	}
	const parts = ['# You are Claude Code', 'env info']
	const out = appendClinicalOverlay(parts, state as any)
	expect(out.length).toBe(parts.length + 1)
	expect(out[0]).toBe(parts[0])
	expect(out[1]).toBe(parts[1])
	expect(out[out.length - 1]).toContain('SOAP')
	expect(out[out.length - 1]).toContain('pat-001')
})

const PATIENT_FENCE = {
	patientId: 'p1',
	demographics: { gender: 'male', birthDate: '1958-01-01' },
	problems: [],
	medications: [],
	allergies: [],
	observations: [],
	encounters: [],
	priorNotes: [],
}

const SOAP_FENCE = {
	id: 'soap',
	name: 'SOAP Note',
	source: 'builtin' as const,
	sections: [
		{ id: 'subjective', title: 'Subjective', requiredFields: [], promptGuidance: '' },
		{ id: 'plan', title: 'Plan', requiredFields: [], promptGuidance: '' },
	],
}

test('overlay teaches the section-fence delivery contract', () => {
	const out = clinicalSystemPromptOverlay(PATIENT_FENCE as any, SOAP_FENCE)
	expect(out).toContain('aegis:section=subjective')
	expect(out).toContain('aegis:section=end')
	expect(out).toContain('<!-- aegis:section=')
})

test('overlay shows one fenced example per section', () => {
	const out = clinicalSystemPromptOverlay(PATIENT_FENCE as any, SOAP_FENCE)
	for (const s of SOAP_FENCE.sections) {
		expect(out).toContain(`aegis:section=${s.id}`)
	}
})
