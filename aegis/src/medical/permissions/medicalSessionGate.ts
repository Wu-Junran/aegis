import { getPhiMode } from '../runtime/phiMode.js'

/**
 * True when the current process is running inside a medical session — i.e.,
 * any phi-mode other than `off`. The permissions engine consults this to
 * decide whether the Bash sandbox auto-allow exception is allowed to bypass
 * a whole-tool ask rule. In medical sessions it is NOT — see Task 4.12 doc
 * comment for the rationale.
 */
export function isMedicalSessionActive(): boolean {
	return getPhiMode() !== 'off'
}
