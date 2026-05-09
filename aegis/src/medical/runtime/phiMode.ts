import type { PhiMode } from '../audit/AuditLogger.js'

let _mode: PhiMode = 'strict'
let _allowOff = false
let _set = false
// Track whether THIS module set CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC so
// the test reset can undo it without clobbering an operator-supplied value.
let _setNonessentialEnvGate = false

export function getPhiMode(): PhiMode {
	return _mode
}

export function isOffAllowed(): boolean {
	return _allowOff
}

/**
 * Aegis network policy for the lifetime of this process.
 *
 * `strict` and `research` are MEDICAL modes. The operator has opted into
 * PHI-grade handling, which carries an aegis-wide invariant:
 *
 *     **No incidental external HTTP traffic at startup or runtime.**
 *
 * Concretely this means: no Grove qualifier probe to `api.anthropic.com`,
 * no GrowthBook feature-flag fetch, no model-capabilities probe, no
 * release-notes fetch, no auto-update check, no Datadog/telemetry, no
 * feedback survey. All of those check `isEssentialTrafficOnly()` from
 * `src/utils/privacyLevel.ts`, which is gated by the env var below.
 *
 * **Why default-disable?** Three reasons:
 *
 *  1. **Network independence.** A medical deployment may run against a
 *     local LLM (`http://localhost:8000/v1` via the `openai-compatible`
 *     adapter) on an isolated network with NO internet. Stock Claude
 *     Code's startup hangs waiting for a Grove qualifier response that
 *     can never arrive. Aegis MUST start cleanly in those environments.
 *
 *  2. **PHI safety.** Even with internet, telemetry/feature-flag traffic
 *     can incidentally exfiltrate session metadata. Medical mode says:
 *     no traffic the operator hasn't authorized.
 *
 *  3. **Single source of truth for the audience.** If a clinical operator
 *     picks `--phi-mode=strict`, they have already decided this is a
 *     PHI-handling session. Forcing them to also remember
 *     `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` would split policy
 *     across two flags that always mean the same thing.
 *
 * `off` mode is the explicit "act like upstream Claude Code" escape
 * hatch (gated by `--allow-phi-off`). In off mode we do NOT touch the
 * env var, so upstream's default phone-home behavior is preserved.
 *
 * Operator override: if the env var is ALREADY set (truthy or falsy)
 * before `setPhiModeFromCli` runs, we do not overwrite it. An operator
 * who explicitly wants Grove notifications in strict mode can set
 * `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=` (empty) before launch.
 */
function applyMedicalNetworkPolicy(mode: PhiMode): void {
	if (mode === 'off') return
	// Honor an explicit operator value, including an explicit empty string
	// (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=`) which means "I want
	// nonessential traffic on even in medical mode". `delete env.X` is
	// the only way to truly unset; an empty-string assignment is treated
	// as falsy by `isEssentialTrafficOnly` per privacyLevel.ts:21.
	if (process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC !== undefined) return
	process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
	_setNonessentialEnvGate = true
}

export function setPhiModeFromCli(args: {
	mode: PhiMode
	allowOff: boolean
}): void {
	if (_set) {
		throw new Error('phiMode already set; setPhiModeFromCli must be called exactly once at startup')
	}
	if (args.mode === 'off' && !args.allowOff) {
		throw new Error('--phi-mode=off requires the --allow-phi-off launch flag (spec §6.4)')
	}
	_mode = args.mode
	_allowOff = args.allowOff
	_set = true
	applyMedicalNetworkPolicy(args.mode)
}

/** TEST-ONLY. Resets module state between bun:test cases. */
export function __resetPhiModeForTests(): void {
	_mode = 'strict'
	_allowOff = false
	_set = false
	// Only undo the env var if THIS module set it — do not clobber an
	// operator-supplied value that pre-existed the setPhiModeFromCli call.
	if (_setNonessentialEnvGate) {
		process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = undefined
		_setNonessentialEnvGate = false
	}
}
