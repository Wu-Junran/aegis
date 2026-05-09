import { test, expect, beforeEach, afterEach } from 'bun:test'
import Anthropic from '@anthropic-ai/sdk'
import {
	getSessionProvider,
	setSessionProvider,
} from '../../../src/services/api/sessionProvider.js'
import {
	sendRedactedRequestNonStreaming,
} from '../../../src/services/api/redactedSend.js'
import { __markRedactedForTest } from '../../../src/medical/middleware/phiMiddleware.js'

const saved = process.env.ANTHROPIC_API_KEY
beforeEach(() => {
	setSessionProvider(null)
	process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
})
afterEach(() => {
	if (saved === undefined) delete process.env.ANTHROPIC_API_KEY
	else process.env.ANTHROPIC_API_KEY = saved
})

// This test proves the dispatch-fork branch selection: when
// `getSessionProvider() === null`, redactedSend MUST take the legacy
// `client.beta.messages.create(...)` path and not crash trying to look
// up an adapter. It does NOT prove env-var-based credential discovery —
// the next test does. (Renamed from "env-only fallback" because the
// fakeClient short-circuits the SDK and never reads the env var; that
// half of the contract belongs in `env-only-sdk-construction` below.)
test('null session takes the legacy client branch (caller-supplied client)', async () => {
	let sdkCalled = false
	const fakeClient = {
		beta: {
			messages: {
				create: () => {
					sdkCalled = true
					return Promise.resolve({
						id: 'msg', type: 'message', role: 'assistant',
						content: [{ type: 'text', text: 'ok' }],
						model: 'claude-opus-4-7', stop_reason: 'end_turn',
						stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
					} as any)
				},
			},
		},
	} as any
	const redacted = __markRedactedForTest({
		model: 'claude-opus-4-7',
		max_tokens: 64,
		messages: [{ role: 'user', content: 'hi' }],
	} as any)
	const r = await sendRedactedRequestNonStreaming(fakeClient, redacted, {} as any)
	expect(sdkCalled).toBe(true)
	expect(getSessionProvider()).toBeNull()
	expect((r as any).content[0].text).toBe('ok')
})

// True env-only coverage: construct the real `@anthropic-ai/sdk` client
// with NO `apiKey` argument, set ANTHROPIC_API_KEY in the environment,
// then capture the outgoing request. The SDK reads
// `process.env.ANTHROPIC_API_KEY` at construction time and stamps it
// into the `x-api-key` header, so the captured header is the proof
// that env-only startup discovers the credential.
//
// We pass the capture stub through the SDK's `fetch` constructor option,
// NOT via globalThis.fetch reassignment. The SDK captures its fetch
// reference at module-load time (Anthropic statically imports its shims
// from the runtime detector), so reassigning `globalThis.fetch` after
// `import Anthropic from '@anthropic-ai/sdk'` runs may not intercept —
// the test would silently make a real network request with the fake
// key. The `fetch` option is the documented per-client override.
test('env-only SDK construction stamps ANTHROPIC_API_KEY into request headers', async () => {
	let capturedHeaders: Headers | null = null
	const fakeFetch = (async (_input: any, init: any) => {
		capturedHeaders = new Headers(init?.headers ?? {})
		return new Response(
			JSON.stringify({
				id: 'msg', type: 'message', role: 'assistant',
				content: [{ type: 'text', text: 'ok' }],
				model: 'claude-opus-4-7', stop_reason: 'end_turn',
				stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } },
		)
	}) as typeof fetch
	// Construct WITHOUT explicit apiKey → SDK reads env. Inject our
	// capture stub via the documented `fetch` option (NOT global swap).
	const client = new Anthropic({ fetch: fakeFetch })
	await client.beta.messages.create({
		model: 'claude-opus-4-7',
		max_tokens: 64,
		messages: [{ role: 'user', content: 'hi' }],
	})
	expect(capturedHeaders).not.toBeNull()
	// SDK header name is `x-api-key`; value is the env-derived key.
	expect(capturedHeaders!.get('x-api-key')).toBe('test-anthropic-key')
})
