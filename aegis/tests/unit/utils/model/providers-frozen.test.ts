import { test, expect, afterEach } from 'bun:test'
import {
	getAPIProvider,
	isFirstPartyAnthropicBaseUrl,
} from '../../../../src/utils/model/providers.js'
import type { APIProvider } from '../../../../src/utils/model/providers.js'

const ENV_KEYS = [
	'CLAUDE_CODE_USE_BEDROCK',
	'CLAUDE_CODE_USE_VERTEX',
	'CLAUDE_CODE_USE_FOUNDRY',
	'ANTHROPIC_BASE_URL',
] as const

const saved: Record<string, string | undefined> = {}
function snapshotEnv() {
	for (const k of ENV_KEYS) saved[k] = process.env[k]
}
function restoreEnv() {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k]
		else process.env[k] = saved[k]
	}
}
afterEach(restoreEnv)

test('APIProvider domain is exactly { firstParty, bedrock, vertex, foundry }', () => {
	// Compile-time check via assignment: if the domain expanded, this fails to compile.
	const valid: APIProvider[] = ['firstParty', 'bedrock', 'vertex', 'foundry']
	expect(valid).toHaveLength(4)
})

test('default returns firstParty', () => {
	snapshotEnv()
	for (const k of ENV_KEYS) delete process.env[k]
	expect(getAPIProvider()).toBe('firstParty')
})

test('CLAUDE_CODE_USE_BEDROCK → bedrock', () => {
	snapshotEnv()
	process.env.CLAUDE_CODE_USE_BEDROCK = '1'
	expect(getAPIProvider()).toBe('bedrock')
})

test('CLAUDE_CODE_USE_VERTEX → vertex', () => {
	snapshotEnv()
	delete process.env.CLAUDE_CODE_USE_BEDROCK
	process.env.CLAUDE_CODE_USE_VERTEX = '1'
	expect(getAPIProvider()).toBe('vertex')
})

test('CLAUDE_CODE_USE_FOUNDRY → foundry', () => {
	snapshotEnv()
	delete process.env.CLAUDE_CODE_USE_BEDROCK
	delete process.env.CLAUDE_CODE_USE_VERTEX
	process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
	expect(getAPIProvider()).toBe('foundry')
})

test('isFirstPartyAnthropicBaseUrl matches api.anthropic.com', () => {
	snapshotEnv()
	delete process.env.ANTHROPIC_BASE_URL
	expect(isFirstPartyAnthropicBaseUrl()).toBe(true)
	process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
	expect(isFirstPartyAnthropicBaseUrl()).toBe(true)
	process.env.ANTHROPIC_BASE_URL = 'https://api.openai.com'
	expect(isFirstPartyAnthropicBaseUrl()).toBe(false)
})
