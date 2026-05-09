import type { PatientContext } from '../adapters/InputAdapter.js'
import type { CallMcpTool } from '../adapters/fhirAdapter.js'
import type { ValidatorWarning } from '../state/validatorWarnings.js'
import type { Template } from '../templates/Template.js'
import type { InboundMiddleware } from './phiMiddleware.js'

type ContentBlock = { type: string; text?: string; [k: string]: unknown }

export type ClinicalValidatorDeps = {
	callTool: CallMcpTool
	getPatientContext: () => PatientContext | null
	getTemplate: () => Template | null
	isDraftingContext: () => boolean
	pushValidatorWarnings: (ws: ValidatorWarning[]) => void
}

const PER_TURN_CHECKS: ValidatorWarning['check'][] = ['dose', 'dates', 'labs', 'allergies']

/**
 * Inbound middleware (M6 Decision 4). Calls `validate_clinical_note` with
 * checks 1–4 every drafting-context turn; section completeness (check 5)
 * runs only at the export gate. Failure-tolerant: a thrown MCP error logs
 * and pushes an empty warnings list — drafting MUST never break because
 * validation tooling failed.
 */
export function createClinicalValidator(
	deps: ClinicalValidatorDeps,
): InboundMiddleware<
	{ message: { content: readonly ContentBlock[] }; [k: string]: unknown },
	{ message: { content: readonly ContentBlock[] }; [k: string]: unknown }
> {
	return {
		name: 'clinicalValidator',
		async process(res, ctx) {
			if (!deps.isDraftingContext()) return res
			const patient = deps.getPatientContext()
			if (!patient) return res
			const template = deps.getTemplate()
			const text = res.message.content
				.filter((b) => b.type === 'text' && typeof b.text === 'string')
				.map((b) => b.text as string)
				.join('\n')
			if (text.length === 0) return res
			try {
				const raw = await deps.callTool('validate_clinical_note', {
					note: text,
					patient_context: patient,
					template,
					checks: PER_TURN_CHECKS,
				})
				const warnings = JSON.parse(raw) as ValidatorWarning[]
				const safe = Array.isArray(warnings) ? warnings : []
				deps.pushValidatorWarnings(safe)
				// (P1#2 fix) Decorate the response so audit.inbound's
				// `warningCount: warnings.length` field reflects the validator
				// output. AppState pushes feed the REPL banner; the response
				// decoration feeds the audit log. Both sinks are required.
				return { ...res, warnings: safe }
			} catch (err) {
				// Validator tooling must never break drafting. Log once and continue.
				// eslint-disable-next-line no-console
				console.warn(
					`[clinicalValidator] (request ${ctx.requestId}) tool error:`,
					(err as Error).message,
				)
				deps.pushValidatorWarnings([])
				return { ...res, warnings: [] }
			}
		},
	}
}
