import { test, expect } from 'bun:test'
import {
	saveCredential,
	loadCredential,
	clearCredential,
} from '../../../src/medical/providers/credentials.js'

const HAS_KEYCHAIN = process.env.AEGIS_HAS_KEYCHAIN === '1'

test.skipIf(!HAS_KEYCHAIN)('keychain round-trip: save → load → delete', async () => {
	const id = 'openai-compatible' as const
	const secret = `test-${Date.now()}`
	delete process.env.OPENAI_COMPATIBLE_API_KEY
	await saveCredential(id, secret)
	try {
		const back = await loadCredential(id)
		expect(back).toBe(secret)
	} finally {
		await clearCredential(id)
	}
})
