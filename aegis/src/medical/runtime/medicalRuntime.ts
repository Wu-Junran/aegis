import type { MCPServerConnection } from '../../services/mcp/types.js'
import type { AppState } from '../../state/AppStateStore.js'

export type MedicalRuntime = {
	/** Snapshot AppState (synchronous, non-React caller). */
	getState: () => AppState
	/** Mutate AppState (synchronous, non-React caller). */
	setState: (updater: (prev: AppState) => AppState) => void
	/**
	 * Live getter for the connected MCP servers — used by McpDeIdentifier to
	 * find aegis-mcp. Backed by a React ref the bridge updates on every render
	 * so MCP reconnects do not require re-setting the runtime.
	 */
	getMcpClients: () => readonly MCPServerConnection[]
	/** Session id; feeds defaultAuditLogPath. Stable for the process. */
	sessionId: string
}

let _runtime: MedicalRuntime | null = null

/**
 * Install/replace the process-singleton medical runtime.
 *
 * **Last-writer-wins**, intentionally idempotent. The original guard threw on
 * re-set as a safety net against init-order bugs, but the actual caller —
 * `<MedicalRuntimeBridge>` — is rendered inside REPL.tsx's conditional UI
 * tree (gated by `focusedInputDialog`, `cursor`, `isExiting`, etc.) and
 * therefore unmounts/remounts during normal user flow: opening any slash-
 * command picker, entering message-actions cursor mode, etc. Each remount
 * creates a *new* `clientsRef`, so the bridge's `getMcpClients` closure
 * captures fresh state. Refusing the re-set would mean the runtime's
 * `getMcpClients()` keeps pointing at the *old, unmounted* ref forever,
 * silently breaking McpDeIdentifier as soon as the user opens any picker.
 *
 * The bridge is the only legitimate caller (enforced by code review, since
 * `setMedicalRuntime` is internal to `src/medical/runtime/`). If a future
 * change introduces a second caller, that's a code-review concern, not
 * something the runtime can detect at runtime — fresh-vs-stale closures
 * look identical.
 */
export function setMedicalRuntime(rt: MedicalRuntime): void {
	_runtime = rt
}

export function getMedicalRuntime(): MedicalRuntime {
	if (!_runtime) {
		throw new Error(
			'medicalRuntime not initialized; main.tsx must call setMedicalRuntime ' +
				'after AppStateProvider mounts and after MCP boot completes',
		)
	}
	return _runtime
}

/** TEST-ONLY. */
export function __resetMedicalRuntimeForTests(): void {
	_runtime = null
}
