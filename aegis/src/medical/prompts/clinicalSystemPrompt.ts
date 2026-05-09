import type { AppState } from '../../state/AppStateStore.js'
import type { PatientContext } from '../adapters/InputAdapter.js'
import type { Template } from '../templates/Template.js'

/**
 * Returns the clinical overlay string. Empty when either slot is missing —
 * callers pass the result through unchanged.
 */
export function clinicalSystemPromptOverlay(
	patient: PatientContext | null,
	template: Template | null,
): string {
	if (!patient || !template) return ''

	const demo = (patient.demographics ?? {}) as Record<string, unknown>
	const problems = (patient.problems as any[])
		.map((p) => p?.code?.text ?? p?.code?.coding?.[0]?.display)
		.filter(Boolean) as string[]
	const meds = (patient.medications as any[])
		.map(
			(m) =>
				m?.medicationCodeableConcept?.text ?? m?.medicationCodeableConcept?.coding?.[0]?.display,
		)
		.filter(Boolean) as string[]
	const allergies = (patient.allergies as any[])
		.map((a) => a?.code?.text ?? a?.code?.coding?.[0]?.display)
		.filter(Boolean) as string[]

	return [
		'# Clinical documentation session',
		'',
		`You are drafting a clinical note using the **${template.name}** template (id: ${template.id}).`,
		'Fill each section in turn. Do not fabricate data that is not present in the patient context below.',
		'',
		'## Patient',
		`- id: ${patient.patientId}`,
		demo.gender ? `- gender: ${demo.gender as string}` : '',
		demo.birthDate ? `- birthDate: ${demo.birthDate as string}` : '',
		'',
		problems.length ? `## Problems\n${problems.map((p) => `- ${p}`).join('\n')}` : '',
		meds.length ? `## Medications\n${meds.map((m) => `- ${m}`).join('\n')}` : '',
		allergies.length ? `## Allergies\n${allergies.map((a) => `- ${a}`).join('\n')}` : '',
		'',
		'## Template sections',
		...template.sections.map(
			(s) =>
				`- **${s.title}** (${s.id}) — ${s.promptGuidance || 'fill according to clinical judgment'}`,
		),
		'',
		'## Delivery contract (REQUIRED)',
		'',
		'Wrap each rendered section in HTML-comment fences so the harness can',
		'parse partial streams safely. Begin a section with',
		'`<!-- aegis:section=<id> -->` and end with `<!-- aegis:section=end -->`.',
		'Use the section ids from the table above. Free-form prose (questions,',
		'clarifications, summaries) MUST live OUTSIDE any fence. Example:',
		'',
		'```',
		...template.sections.map(
			(s) => `<!-- aegis:section=${s.id} -->\n…${s.title} body…\n<!-- aegis:section=end -->`,
		),
		'```',
	]
		.filter(Boolean)
		.join('\n')
}

/**
 * Pure helper used at the two drafting callsites (QueryEngine.ts and
 * queryContext.ts) to append the clinical overlay to the final system-prompt
 * array. Returns a copy of the input array with no extra entry when either
 * slot is empty.
 */
export function appendClinicalOverlay(parts: readonly string[], appState: AppState): string[] {
	const overlay = clinicalSystemPromptOverlay(appState.currentPatient, appState.currentTemplate)
	return overlay ? [...parts, overlay] : [...parts]
}
