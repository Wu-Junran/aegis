import { test, expect } from 'bun:test'
import { getDefaultAppState } from '../../../src/state/AppStateStore.js'
import { createStore } from '../../../src/state/store.js'
import type { ProviderConfig } from '../../../src/medical/providers/ProviderAdapter.js'

test('currentProvider defaults to null in fresh AppState', () => {
	const state = getDefaultAppState()
	expect(state.currentProvider).toBeNull()
})

test('currentProvider can be set and read via the store', () => {
	const store = createStore(getDefaultAppState())
	const cfg: ProviderConfig = {
		id: 'openai',
		modelId: 'gpt-5',
		capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128000 },
	}
	store.setState((s) => ({ ...s, currentProvider: cfg }))
	expect(store.getState().currentProvider).toEqual(cfg)
})

test('clearing currentProvider returns to null', () => {
	const store = createStore(getDefaultAppState())
	store.setState((s) => ({
		...s,
		currentProvider: { id: 'glm', modelId: 'glm-4', capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128000 } },
	}))
	store.setState((s) => ({ ...s, currentProvider: null }))
	expect(store.getState().currentProvider).toBeNull()
})
