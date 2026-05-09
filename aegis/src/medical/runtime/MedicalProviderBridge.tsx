import { useEffect, useRef } from 'react'
import { wireSessionProviderFromAppState } from '../../services/api/bootstrap.js'
import { useAppStateStore } from '../../state/AppState.js'

/**
 * Null-render bridge that wires AppState.currentProvider into the
 * sessionProvider holder. Mount once inside <AppStateProvider>; unmount
 * cleans up the subscription. See the lint-equivalent test
 * sessionProvider-callers.test.ts — bootstrap.ts is the ONLY production
 * importer of setSessionProvider, and this is the only call site.
 */
export function MedicalProviderBridge(): null {
	const store = useAppStateStore()
	const unsubRef = useRef<(() => void) | null>(null)
	useEffect(() => {
		unsubRef.current = wireSessionProviderFromAppState(store)
		return () => {
			unsubRef.current?.()
			unsubRef.current = null
		}
	}, [store])
	return null
}
