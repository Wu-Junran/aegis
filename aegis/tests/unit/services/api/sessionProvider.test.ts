import { test, expect, beforeEach } from 'bun:test'
import {
	getSessionProvider,
	setSessionProvider,
	hasConfirmedProvider,
	markProviderConfirmed,
	clearConfirmedProviders,
} from '../../../../src/services/api/sessionProvider.js'
import type { ProviderConfig } from '../../../../src/medical/providers/ProviderAdapter.js'

const cfg: ProviderConfig = {
	id: 'openai',
	modelId: 'gpt-5',
	capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128000 },
}

beforeEach(() => {
	setSessionProvider(null)
	clearConfirmedProviders()
})

test('default session provider is null', () => {
	expect(getSessionProvider()).toBeNull()
})

test('set then get returns the same config', () => {
	setSessionProvider(cfg)
	expect(getSessionProvider()).toEqual(cfg)
})

test('clearing session provider sets to null', () => {
	setSessionProvider(cfg)
	setSessionProvider(null)
	expect(getSessionProvider()).toBeNull()
})

test('markProviderConfirmed records the id; hasConfirmedProvider reflects it', () => {
	expect(hasConfirmedProvider('openai')).toBe(false)
	markProviderConfirmed('openai')
	expect(hasConfirmedProvider('openai')).toBe(true)
	expect(hasConfirmedProvider('glm')).toBe(false)
})

test('clearConfirmedProviders empties the set', () => {
	markProviderConfirmed('openai')
	clearConfirmedProviders()
	expect(hasConfirmedProvider('openai')).toBe(false)
})
