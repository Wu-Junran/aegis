import { test, expect, beforeEach, afterEach } from 'bun:test'
import { createMinimaxAdapter } from '../../../../src/medical/providers/MinimaxAdapter.js'
import { createOpenAICompatibleAdapter } from '../../../../src/medical/providers/OpenAICompatibleAdapter.js'
import type { ProviderConfig } from '../../../../src/medical/providers/ProviderAdapter.js'

// ───────────────────────────────────────────────────────────────────────
// `AdapterRequestOptions.timeout` regression suite. claude.ts:1019 passes
// `timeout: fallbackTimeoutMs` on the non-streaming fallback path, but
// `redactedSend.ts` previously only forwarded `signal` and `headers` to
// adapters — so provider-mode (OpenAI / GLM / Minimax / openai-compatible)
// fallback calls silently dropped the bounded fallback window. Without
// the fix a runaway upstream could hang past the configured timeout.
//
// These tests pin the contract end-to-end:
//  • Minimax (raw fetch): adapter wraps an internal AbortController +
//    setTimeout, so a never-resolving fetch rejects within
//    `timeout + tolerance`.
//  • OpenAI-compatible (OpenAI SDK): the SDK transforms `timeout` into an
//    internal AbortController.signal forwarded on every fetch call. We
//    capture the first stub-fetch call's signal and assert it aborts
//    within `timeout + tolerance` even when the stub never resolves.
//
// Both tests depend ONLY on observable outcomes — no inspection of
// adapter internals — so they catch regressions in either the
// `redactedSend.ts` forwarding or the per-adapter honoring.
// ───────────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 50
const TOLERANCE_MS = 200 // generous: covers test-env scheduling jitter

const realFetch = globalThis.fetch
let savedMinimaxKey: string | undefined
let savedOpenAIKey: string | undefined

beforeEach(() => {
	savedMinimaxKey = process.env.MINIMAX_API_KEY
	savedOpenAIKey = process.env.OPENAI_API_KEY
	process.env.MINIMAX_API_KEY = 'test-secret'
	process.env.OPENAI_API_KEY = 'test-secret'
})

afterEach(() => {
	globalThis.fetch = realFetch
	if (savedMinimaxKey === undefined) delete process.env.MINIMAX_API_KEY
	else process.env.MINIMAX_API_KEY = savedMinimaxKey
	if (savedOpenAIKey === undefined) delete process.env.OPENAI_API_KEY
	else process.env.OPENAI_API_KEY = savedOpenAIKey
})

test('Minimax: AdapterRequestOptions.timeout aborts a never-resolving fetch within the bounded window', async () => {
	// Stub fetch to never resolve UNLESS the AbortController fires. When
	// the inner controller (installed by MinimaxAdapter for the timeout)
	// aborts, fetch settles with an AbortError-shaped rejection — exactly
	// what the runtime fetch does. Without the fix, no timer fires; the
	// test would hang past TOLERANCE and fail.
	let observedSignal: AbortSignal | null = null
	globalThis.fetch = ((_input: unknown, init?: { signal?: AbortSignal }) => {
		observedSignal = init?.signal ?? null
		return new Promise((_resolve, reject) => {
			init?.signal?.addEventListener(
				'abort',
				() => {
					const err = new Error('aborted')
					;(err as { name: string }).name = 'AbortError'
					reject(err)
				},
				{ once: true },
			)
		})
	}) as typeof fetch

	const adapter = createMinimaxAdapter()
	const cfg: ProviderConfig = {
		id: 'minimax',
		modelId: 'abab6.5-chat',
		capabilities: { streaming: false, toolUse: false, promptCache: false, maxContextTokens: 245000 },
	}
	const start = Date.now()
	let rejected = false
	try {
		await adapter.dispatch(
			{ model: 'abab6.5-chat', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] } as any,
			cfg,
			{ timeout: TIMEOUT_MS },
		)
	} catch {
		rejected = true
	}
	const elapsed = Date.now() - start
	expect(rejected).toBe(true)
	expect(observedSignal).not.toBeNull()
	// The stub-observed signal MUST be the inner controller's signal that
	// the timer aborts. If timeout were dropped, the signal would never
	// abort and we'd hang past TOLERANCE.
	expect(observedSignal!.aborted).toBe(true)
	expect(elapsed).toBeLessThan(TIMEOUT_MS + TOLERANCE_MS)
})

test('OpenAI-compatible: AdapterRequestOptions.timeout is the ACTUAL deadline (single attempt, no SDK retries)', async () => {
	// Bidirectional regression for two coupled bugs:
	//   (1) Without `timeout` forwarding, the SDK fell through to its
	//       default (~10 min) — dispatch would hang past TOLERANCE.
	//   (2) Without `maxRetries: 0`, the SDK's default `maxRetries: 2`
	//       resets the per-request deadline on each retry. A 50ms
	//       `timeout` would actually take ~3 attempts × 50ms ≈ 150ms+
	//       before final rejection (and the production 300s
	//       `fallbackTimeoutMs` could stretch even further across the
	//       three attempts). claude.ts:executeNonStreamingRequest already
	//       owns retry policy; the adapter's job is to make ONE dispatch
	//       and honor its deadline.
	//
	// Stub fetch never resolves; the SDK aborts its internal signal when
	// the `timeout` fires, which rejects fetch with AbortError. With
	// `maxRetries: 0` the dispatch promise itself rejects within TIMEOUT
	// + TOLERANCE — ONE attempt, total elapsed ≈ TIMEOUT, NOT 3×TIMEOUT.
	// We also count fetch invocations to lock the no-retry contract.
	let fetchCalls = 0
	let firstSignal: AbortSignal | null = null
	globalThis.fetch = ((_input: unknown, init?: { signal?: AbortSignal }) => {
		fetchCalls += 1
		if (firstSignal === null) firstSignal = init?.signal ?? null
		return new Promise((_resolve, reject) => {
			init?.signal?.addEventListener(
				'abort',
				() => {
					const err = new Error('aborted')
					;(err as { name: string }).name = 'AbortError'
					reject(err)
				},
				{ once: true },
			)
		})
	}) as typeof fetch

	const adapter = createOpenAICompatibleAdapter('openai')
	const cfg: ProviderConfig = {
		id: 'openai',
		baseURL: 'https://api.openai.com/v1',
		modelId: 'gpt-5',
		capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128000 },
	}
	const start = Date.now()
	let rejected = false
	try {
		await adapter.dispatch(
			{ model: 'gpt-5', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] } as any,
			cfg,
			{ timeout: TIMEOUT_MS },
		)
	} catch {
		rejected = true
	}
	const elapsed = Date.now() - start
	expect(rejected).toBe(true)
	expect(firstSignal).not.toBeNull()
	expect(firstSignal!.aborted).toBe(true)
	// Load-bearing #1: the dispatch itself rejects within the bounded
	// window. Without `timeout` forwarding it would hang; without
	// `maxRetries: 0` it would take ~3×TIMEOUT and exceed TOLERANCE.
	expect(elapsed).toBeLessThan(TIMEOUT_MS + TOLERANCE_MS)
	// Load-bearing #2: exactly ONE attempt. Pre-fix `maxRetries=2` (SDK
	// default) caused 3 fetch calls per dispatch — locking this to 1
	// catches both regressions of (a) accidentally re-enabling retries
	// here, and (b) some future SDK upgrade flipping the default.
	expect(fetchCalls).toBe(1)
})
