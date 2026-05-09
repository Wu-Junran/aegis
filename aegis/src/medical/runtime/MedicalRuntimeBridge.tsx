import { homedir } from 'node:os'
import * as React from 'react'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import { useAppStateStore } from '../../state/AppState.js'
import { defaultAuditLogPath } from './auditPath.js'
import { setMedicalRuntime } from './medicalRuntime.js'
import { getPhiMode } from './phiMode.js'

export function MedicalRuntimeBridge({
	mcpClients,
	sessionId,
}: {
	mcpClients: readonly MCPServerConnection[]
	sessionId: string
}): null {
	const store = useAppStateStore()
	// Live ref — updated every render so getMcpClients() always returns latest.
	const clientsRef = React.useRef(mcpClients)
	clientsRef.current = mcpClients

	// Populate auditLogPath + seed phiMode + register the runtime.
	// mcpClients is intentionally NOT in the deps — clients drift through clientsRef.
	// `store` and `sessionId` are both stable for the life of the React tree
	// (provider identity is stable; sessionId is process-stable).
	//
	// This effect re-runs on every remount. The bridge IS remounted during
	// normal UI flow: REPL.tsx renders it inside a conditional gated on
	// `focusedInputDialog`/`cursor`/`isExiting`, so opening any slash-command
	// picker (e.g. `/model`) unmounts the bridge, and closing it remounts.
	// Each remount creates a fresh `clientsRef`, and `setMedicalRuntime` is
	// last-writer-wins so `getMcpClients()` always points at the live ref.
	// If we ever want to make the bridge truly mount-once, hoist it above the
	// `focusedInputDialog` gate in REPL.tsx — but the current setter contract
	// makes that purely a styling choice, not a correctness requirement.
	// [M4] phiMode seed (decision #6): the non-React module `runtime/phiMode.ts`
	// was already populated by `setPhiModeFromCli` in main.tsx (before any React
	// tree exists). This bridge runs *inside* the React tree, so it's the place
	// where `getPhiMode()` becomes safely reachable to dump into AppState. Without
	// this seed, `AppState.phiMode` would stay at the `getDefaultAppState()`
	// default of `'strict'` even when the user launched with `--phi-mode research`,
	// and `<PhiModeBanner>` would lie about the active mode. Both writes happen
	// in a single setState so the state transition is atomic.
	React.useEffect(() => {
		store.setState((prev) => ({
			...prev,
			auditLogPath: defaultAuditLogPath(sessionId, homedir()),
			phiMode: getPhiMode(),
		}))
		setMedicalRuntime({
			getState: store.getState,
			setState: store.setState,
			getMcpClients: () => clientsRef.current,
			sessionId,
		})
		// eslint-disable-next-line react-hooks/exhaustive-deps -- clientsRef is the live source
	}, [store, sessionId])
	return null
}
