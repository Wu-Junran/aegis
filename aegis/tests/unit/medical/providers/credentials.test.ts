import { test, expect, beforeEach, afterEach } from 'bun:test'
import {
	loadCredential,
	saveCredential,
	clearCredential,
	MissingCredentialError,
	__setKeytarForTest,
	__clearKeytarForTest,
} from '../../../../src/medical/providers/credentials.ts'

const ENV_KEY = 'OPENAI_API_KEY'
const saved: string | undefined = process.env[ENV_KEY]
beforeEach(() => {
	delete process.env[ENV_KEY]
	__clearKeytarForTest()
})
afterEach(() => {
	if (saved === undefined) delete process.env[ENV_KEY]
	else process.env[ENV_KEY] = saved
})

test('env wins: loadCredential reads OPENAI_API_KEY when set', async () => {
	process.env[ENV_KEY] = 'env-secret'
	expect(await loadCredential('openai')).toBe('env-secret')
})

test('falls back to keychain when env absent', async () => {
	const fake = new Map<string, string>([['aegis:openai', 'keychain-secret']])
	__setKeytarForTest({
		getPassword: async (svc: string, acc: string) => fake.get(`${svc}:${acc}`) ?? null,
		setPassword: async () => {},
		deletePassword: async () => true,
	})
	expect(await loadCredential('openai')).toBe('keychain-secret')
})

test('throws MissingCredentialError when both env and keychain are empty', async () => {
	__setKeytarForTest({
		getPassword: async () => null,
		setPassword: async () => {},
		deletePassword: async () => true,
	})
	await expect(loadCredential('openai')).rejects.toBeInstanceOf(MissingCredentialError)
})

test('MissingCredentialError for openai points to /provider creds', async () => {
	const err = new MissingCredentialError('openai')
	// Non-Anthropic providers must surface the masked-paste flow.
	expect(err.message).toContain('OPENAI_API_KEY')
	expect(err.message).toContain('/provider creds openai')
})

test('MissingCredentialError for anthropic does NOT recommend /provider creds (rejected by renderCreds)', async () => {
	// Regression: the generic message used to send users to
	// `/provider creds anthropic`, but renderCreds rejects that id on
	// purpose because Anthropic auth is owned upstream (OAuth /
	// ANTHROPIC_API_KEY). Surface the upstream remediation instead so
	// the recovery path is actually actionable.
	const err = new MissingCredentialError('anthropic')
	expect(err.message).toContain('ANTHROPIC_API_KEY')
	expect(err.message).not.toContain('/provider creds')
})

test('saveCredential writes only to keychain, never to env', async () => {
	const stored = new Map<string, string>()
	__setKeytarForTest({
		getPassword: async (svc, acc) => stored.get(`${svc}:${acc}`) ?? null,
		setPassword: async (svc, acc, pw) => { stored.set(`${svc}:${acc}`, pw) },
		deletePassword: async () => true,
	})
	await saveCredential('openai', 'new-secret')
	expect(stored.get('aegis:openai')).toBe('new-secret')
	expect(process.env[ENV_KEY]).toBeUndefined()
})

test('clearCredential removes the keychain entry', async () => {
	const stored = new Map<string, string>([['aegis:openai', 'old']])
	__setKeytarForTest({
		getPassword: async (svc, acc) => stored.get(`${svc}:${acc}`) ?? null,
		setPassword: async () => {},
		deletePassword: async (svc, acc) => stored.delete(`${svc}:${acc}`),
	})
	await clearCredential('openai')
	expect(stored.has('aegis:openai')).toBe(false)
})
