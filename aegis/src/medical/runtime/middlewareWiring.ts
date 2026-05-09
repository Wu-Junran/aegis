import type { PatientContext } from '../adapters/InputAdapter.js'
import type { CallMcpTool } from '../adapters/fhirAdapter.js'
import type { AuditLogger, PhiMode } from '../audit/AuditLogger.js'
import type { DeIdentifier } from '../deid/DeIdentifier.js'
import { createAuditInbound, createAuditOutbound } from '../middleware/auditMiddleware.js'
import { createClinicalValidator } from '../middleware/clinicalValidator.js'
import { createNotePersist } from '../middleware/notePersistMiddleware.js'
import { createPhiMiddlewarePair } from '../middleware/phiMiddleware.js'
import type { InboundMiddleware, OutboundMiddleware } from '../middleware/phiMiddleware.js'
import type { CurrentNoteValue } from '../state/currentNote.js'
import type { ValidatorWarning } from '../state/validatorWarnings.js'
import type { Template } from '../templates/Template.js'

export type BuildMedicalMiddlewareDeps = {
	deid: DeIdentifier
	logger: AuditLogger
	mode: PhiMode
	/**
	 * Set the active note value. Consumed by `notePersist` (Task
	 * 4.9) on every drafting-context inbound response, so `/note show` can read
	 * `AppState.currentNote` instead of scraping the transcript.
	 */
	setNote: (value: CurrentNoteValue) => void
	/**
	 * Whether the current request is a note-drafting context (vs. arbitrary
	 * chit-chat). `notePersist` gates writes on this so we don't snapshot every
	 * assistant turn into the on-disk note.
	 */
	isDraftingContext: () => boolean
	/** MCP tool dispatcher — used by the validator middleware. */
	callTool: CallMcpTool
	/** Live getter for the current patient context. */
	getPatientContext: () => PatientContext | null
	/** Live getter for the current template. */
	getTemplate: () => Template | null
	/** Sink for validator warnings (replaces the slice per turn). */
	pushValidatorWarnings: (ws: ValidatorWarning[]) => void
}

/**
 * Compose the medical middleware chain for outbound (request) and inbound
 * (response) sides.
 *
 * Outbound order: `phi.outbound` → `audit.outbound`
 * Inbound order:  `phi.inbound` → `notePersist` → `clinicalValidator` → `audit.inbound`
 *
 * Order rationale (P1#2 fix):
 *   - `phi.inbound` first restores PHI placeholders to plaintext.
 *   - `notePersist` runs second so the validator sees the
 *     parsed-into-sections note value already on `ctx.noteValue`.
 *   - `clinicalValidator` decorates `res.warnings` from the MCP tool output.
 *   - `audit.inbound` runs LAST so its `warningCount: warnings.length` field
 *     reflects the validator output instead of always recording 0.
 *
 * Off mode bypasses the chain entirely.
 */
export function buildMedicalMiddleware(deps: BuildMedicalMiddlewareDeps): {
	outbound: OutboundMiddleware[]
	inbound: InboundMiddleware[]
} {
	// Off mode: pure Claude Code behavior, chain is empty (spec §6.4).
	if (deps.mode === 'off') {
		return { outbound: [], inbound: [] }
	}
	const phi = createPhiMiddlewarePair(deps.deid)
	const auditOut = createAuditOutbound(deps.logger, deps.mode)
	const auditIn = createAuditInbound(deps.logger, deps.mode)
	const notePersist = createNotePersist({
		setNote: deps.setNote,
		isDraftingContext: deps.isDraftingContext,
	})
	const validator = createClinicalValidator({
		callTool: deps.callTool,
		getPatientContext: deps.getPatientContext,
		getTemplate: deps.getTemplate,
		isDraftingContext: deps.isDraftingContext,
		pushValidatorWarnings: deps.pushValidatorWarnings,
	})
	return {
		outbound: [phi.outbound, auditOut],
		// (P1#2) audit.inbound runs LAST so it observes res.warnings decorated
		// by the validator in the previous step.
		inbound: [phi.inbound, notePersist, validator, auditIn],
	}
}
