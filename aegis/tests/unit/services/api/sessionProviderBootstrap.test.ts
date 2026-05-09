import { test, expect, beforeEach } from 'bun:test'
import { wireSessionProviderFromAppState } from '../../../../src/services/api/bootstrap.js'
import {
	getSessionProvider,
	setSessionProvider,
} from '../../../../src/services/api/sessionProvider.js'
import { createStore } from '../../../../src/state/store.js'
import { getDefaultAppState } from '../../../../src/state/AppStateStore.js'
import type { ProviderConfig } from '../../../../src/medical/providers/ProviderAdapter.js'

const cfg: ProviderConfig = {
	id: 'glm',
	modelId: 'glm-4',
	capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128000 },
}

beforeEach(() => setSessionProvider(null))

test('wire mirrors AppState.currentProvider into setSessionProvider', () => {
	const store = createStore(getDefaultAppState())
	const unsub = wireSessionProviderFromAppState(store)
	store.setState((s) => ({ ...s, currentProvider: cfg }))
	expect(getSessionProvider()).toEqual(cfg)
	unsub()
})

test('unsubscribe stops mirroring further changes', () => {
	const store = createStore(getDefaultAppState())
	const unsub = wireSessionProviderFromAppState(store)
	unsub()
	store.setState((s) => ({ ...s, currentProvider: cfg }))
	expect(getSessionProvider()).toBeNull()
})

test('initial wiring picks up an already-set currentProvider', () => {
	const store = createStore({ ...getDefaultAppState(), currentProvider: cfg })
	const unsub = wireSessionProviderFromAppState(store)
	expect(getSessionProvider()).toEqual(cfg)
	unsub()
})

test('only fires when currentProvider actually changes (identity check)', () => {
	const store = createStore({ ...getDefaultAppState(), currentProvider: cfg })
	const unsub = wireSessionProviderFromAppState(store)
	let calls = 0
	const origSet = setSessionProvider
	// We can't intercept setSessionProvider without mocking; instead assert
	// that setting an unrelated slice does NOT touch session.
	setSessionProvider(null)
	store.setState((s) => ({ ...s, currentNote: 'hello' }))
	expect(getSessionProvider()).toBeNull()
	// (sentinel: changing currentNote did not re-fire setSessionProvider)
	unsub()
})
