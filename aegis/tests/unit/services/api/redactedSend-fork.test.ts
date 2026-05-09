import { test, expect, beforeEach } from 'bun:test'
import {
	setSessionProvider,
} from '../../../../src/services/api/sessionProvider.js'
import {
	sendRedactedRequestNonStreaming,
	sendRedactedRequestStreaming,
} from '../../../../src/services/api/redactedSend.js'
import { __markRedactedForTest } from '../../../../src/medical/middleware/phiMiddleware.js'
import {
	__clearAdapterCacheForTest,
	__clearAdapterOverrideForTest,
	__setAdapterForTest,
} from '../../../../src/medical/providers/adapterRegistry.js'

beforeEach(() => {
	setSessionProvider(null)
	__clearAdapterCacheForTest()
	__clearAdapterOverrideForTest()
})

test('legacy branch: no session provider → calls client.beta.messages.create', async () => {
	let called = false
	const fakeClient = {
		beta: {
			messages: {
				create: () => {
					called = true
					return Promise.resolve({ id: 'msg', content: [], role: 'assistant', model: 'x', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } as any)
				},
			},
		},
	} as any
	const redacted = __markRedactedForTest({ model: 'x', max_tokens: 1, messages: [] } as any)
	await sendRedactedRequestNonStreaming(fakeClient, redacted, {} as any)
	expect(called).toBe(true)
})

test('adapter branch: session provider set → calls adapter.dispatch', async () => {
	let dispatchedWith: any = null
	const cfg = {
		id: 'openai' as const,
		modelId: 'gpt-5',
		capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128000 },
	}
	setSessionProvider(cfg)
	__setAdapterForTest('openai', {
		id: 'openai',
		displayName: 'OpenAI',
		dispatch: async (req: any, _cfg: any) => {
			dispatchedWith = req
			return {
				kind: 'message' as const,
				message: { id: 'msg', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'ok' }], model: 'gpt-5', stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } as any,
			}
		},
	})

	const redacted = __markRedactedForTest({ model: 'gpt-5', max_tokens: 1, messages: [] } as any)
	const fakeClient = { beta: { messages: { create: () => { throw new Error('legacy must not be called') } } } } as any
	await sendRedactedRequestNonStreaming(fakeClient, redacted, {} as any)
	expect(dispatchedWith).not.toBeNull()
})

test('non-streaming reassembly handles tool input split across multiple input_json_delta events', async () => {
	// Anthropic streams JSON across deltas; parsing each fragment alone
	// would fail and silently drop the input. Split `{"path":"/etc/hosts"}`
	// into three fragments and assert the reassembled tool_use carries the
	// full input.
	const cfg = {
		id: 'anthropic' as const,
		modelId: 'claude-opus-4-7',
		capabilities: { streaming: true, toolUse: true, promptCache: true, maxContextTokens: 1_000_000 },
	}
	setSessionProvider(cfg)
	__setAdapterForTest('anthropic', {
		id: 'anthropic',
		displayName: 'Anthropic',
		dispatch: async () => ({
			kind: 'events' as const,
			events: (async function* () {
				yield { type: 'message_start', message: { id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-4-7', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } }
				yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_1', name: 'FileRead', input: {} } }
				yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":' } }
				yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"/etc/' } }
				yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'hosts"}' } }
				yield { type: 'content_block_stop', index: 0 }
				yield { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 8 } }
				yield { type: 'message_stop' }
			})() as any,
		}),
	})

	const redacted = __markRedactedForTest({ model: 'claude-opus-4-7', max_tokens: 1, messages: [] } as any)
	const fakeClient = { beta: { messages: { create: () => { throw new Error('legacy must not be called') } } } } as any
	const msg = await sendRedactedRequestNonStreaming(fakeClient, redacted, {} as any)
	const toolBlock = msg.content.find((b) => (b as { type: string }).type === 'tool_use') as { name: string; input: Record<string, unknown> } | undefined
	expect(toolBlock).toBeDefined()
	expect(toolBlock!.name).toBe('FileRead')
	// The whole input must round-trip — parsing each fragment alone would
	// have failed and left input as {}.
	expect(toolBlock!.input).toEqual({ path: '/etc/hosts' })
})

test('streaming branch synthesizes raw events from a kind=message adapter', async () => {
	// Stub adapter that returns kind: 'message' (the OAI/GLM/Minimax shape).
	const cfg = {
		id: 'openai' as const,
		modelId: 'gpt-5',
		capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128000 },
	}
	setSessionProvider(cfg)
	__setAdapterForTest('openai', {
		id: 'openai',
		displayName: 'OpenAI',
		dispatch: async () => ({
			kind: 'message' as const,
			message: {
				id: 'msg', type: 'message', role: 'assistant', model: 'gpt-5',
				content: [{ type: 'text', text: 'hello' }, { type: 'tool_use', id: 'call_1', name: 'F', input: { p: 1 } }],
				stop_reason: 'tool_use', stop_sequence: null,
				usage: { input_tokens: 4, output_tokens: 7 },
			} as any,
		}),
	})

	const redacted = __markRedactedForTest({ model: 'gpt-5', max_tokens: 1, messages: [] } as any)
	const fakeClient = { beta: { messages: { create: () => { throw new Error('legacy must not be called') } } } } as any
	const { data } = await sendRedactedRequestStreaming(fakeClient, redacted, {} as any)
	// claude.ts checks `'controller' in stream` and calls
	// `stream.controller.abort()` on cleanup — a bare async generator
	// would fail both. Assert the wrapper shape explicitly.
	expect('controller' in (data as object)).toBe(true)
	expect((data as { controller: AbortController }).controller).toBeInstanceOf(AbortController)
	const types: string[] = []
	for await (const e of data as AsyncIterable<{ type: string }>) types.push(e.type)
	// Two content blocks → 2× (start, delta, stop) sandwiched between
	// message_start / message_delta / message_stop = 1 + 6 + 2 = 9 events.
	expect(types[0]).toBe('message_start')
	expect(types[types.length - 1]).toBe('message_stop')
	expect(types.filter((t) => t === 'content_block_start')).toHaveLength(2)
	expect(types.filter((t) => t === 'content_block_stop')).toHaveLength(2)
	expect(types).toContain('message_delta')
})
