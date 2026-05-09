import { test, expect, beforeEach } from 'bun:test'
import { PROVIDER_PRESETS } from '../../../src/medical/providers/presets.js'
import { setSessionProvider } from '../../../src/services/api/sessionProvider.js'
import {
	__clearAdapterCacheForTest,
	__clearAdapterOverrideForTest,
	__setAdapterForTest,
	getAdapter,
} from '../../../src/medical/providers/adapterRegistry.js'
import { __setKeytarForTest } from '../../../src/medical/providers/credentials.js'
import { loadCassette, makeFetchStub, anthropicStreamFromCassette } from './cassetteReplay.js'

beforeEach(() => {
	setSessionProvider(null)
	__clearAdapterCacheForTest()
	__setKeytarForTest({
		getPassword: async () => 'test-key',
		setPassword: async () => {},
		deletePassword: async () => true,
	})
})

const CASSETTES = new Map<string, string>([
	['anthropic', 'cassette-anthropic.json'],
	['openai', 'cassette-openai.json'],
	['openai-compatible', 'cassette-openai-compatible.json'],
	['glm', 'cassette-glm.json'],
	['minimax', 'cassette-minimax.json'],
])

for (const preset of PROVIDER_PRESETS) {
	test(`capability-matrix: ${preset.id} round-trip`, async () => {
		const cas = loadCassette(CASSETTES.get(preset.id)!)
		const origFetch = globalThis.fetch
		const { stub, captured } = makeFetchStub(cas)
		globalThis.fetch = stub
		try {
			// `openai-compatible` cassette carries a providerOverride to
			// exercise the configurable baseURL/modelId path (Ollama / vLLM
			// / Together). Other presets use their preset defaults.
			const override = (cas as { providerOverride?: { baseURL?: string; modelId?: string } }).providerOverride ?? {}
			setSessionProvider({
				id: preset.id,
				baseURL: override.baseURL ?? preset.defaultBaseURL,
				modelId: override.modelId ?? preset.defaultModelId,
				capabilities: preset.capabilities,
			})
			// Hit the adapter directly; the round-trip exercises the
			// outbound + inbound transforms. `getAdapter` is imported at
			// the top of the file — both loops in this file (plain and
			// tool-use) and any future loop must resolve the same binding.
			// fakeClient is only consulted by AnthropicAdapter; other
			// adapters route through `globalThis.fetch` (stubbed above).
			// Anthropic cassettes must shape `response` as an event array
			// (`anthropicStreamFromCassette` enforces this).
			const fakeClient = {
				beta: {
					messages: {
						create: () => ({
							withResponse: () =>
								preset.id === 'anthropic'
									? Promise.resolve({ data: anthropicStreamFromCassette(cas), response: new Response(null), request_id: 'req_cassette' })
									: Promise.reject(new Error(`non-anthropic adapter (${preset.id}) must not use fakeClient`)),
						}),
					},
				},
			} as any
			const adapter = getAdapter(preset.id, fakeClient)
			const r = await adapter.dispatch(cas.request as any, {
				id: preset.id,
				baseURL: override.baseURL ?? preset.defaultBaseURL,
				modelId: override.modelId ?? preset.defaultModelId,
				capabilities: preset.capabilities,
			})
			expect(['events', 'message']).toContain(r.kind)
			// If events: assert raw event vocabulary; if message: assert it
			// can be synthesized by walking through redactedSend's wrapper.
			if (r.kind === 'events') {
				const types: string[] = []
				for await (const e of r.events) types.push((e as { type: string }).type)
				expect(types).toContain('message_start')
				expect(types).toContain('message_stop')
			} else {
				expect(r.message.role).toBe('assistant')
				expect(r.message.content.length).toBeGreaterThan(0)
			}
			// Outbound-shape assertions for HTTP adapters. Skipped for
			// Anthropic (uses the SDK Stream path, not globalThis.fetch).
			// A bare always-returns-cassette stub cannot detect baseURL
			// drift, model swaps, or dropped tool/system fields — that's
			// what these assertions catch.
			if (preset.id !== 'anthropic') {
				expect(captured.length).toBeGreaterThan(0)
				const call = captured[0]
				const expectedBaseURL = override.baseURL ?? preset.defaultBaseURL
				expect(expectedBaseURL).toBeDefined()
				expect(call.url.startsWith(expectedBaseURL!)).toBe(true)
				expect(call.method).toBe('POST')
				const body = call.body as { model?: string }
				expect(body.model).toBe(override.modelId ?? preset.defaultModelId)
			}
		} finally {
			globalThis.fetch = origFetch
		}
	})
}

// ─── Tool-use round-trip ──────────────────────────────────────────────
// One cassette per preset, exercising the multi-turn tool-use path the
// matrix is meant to cover. For `toolUse: true` providers we assert the
// adapter surfaces a tool_use block (BetaMessage content) or the
// equivalent stream events. For `toolUse: false` (per Decision #11
// capabilities are informative, not restrictive), we assert the call
// completes without throwing and degrades gracefully to text.
const TOOL_CASSETTES = new Map<string, string>([
	['anthropic', 'cassette-anthropic-tool-use.json'],
	['openai', 'cassette-openai-tool-use.json'],
	['openai-compatible', 'cassette-openai-compatible-tool-use.json'],
	['glm', 'cassette-glm-tool-use.json'],
	['minimax', 'cassette-minimax-tool-use.json'],
])

for (const preset of PROVIDER_PRESETS) {
	test(`capability-matrix: ${preset.id} tool-use round-trip`, async () => {
		const cas = loadCassette(TOOL_CASSETTES.get(preset.id)!)
		const origFetch = globalThis.fetch
		const { stub, captured } = makeFetchStub(cas)
		globalThis.fetch = stub
		try {
			const override = (cas as { providerOverride?: { baseURL?: string; modelId?: string } }).providerOverride ?? {}
			setSessionProvider({
				id: preset.id,
				baseURL: override.baseURL ?? preset.defaultBaseURL,
				modelId: override.modelId ?? preset.defaultModelId,
				capabilities: preset.capabilities,
			})
			// fakeClient is only consulted by AnthropicAdapter; other
			// adapters route through `globalThis.fetch` (stubbed above).
			// `anthropicStreamFromCassette` throws if response isn't an
			// event array, so gate it on the anthropic preset.
			const fakeClient = {
				beta: {
					messages: {
						create: () => ({
							withResponse: () =>
								preset.id === 'anthropic'
									? Promise.resolve({ data: anthropicStreamFromCassette(cas), response: new Response(null), request_id: 'req_cassette' })
									: Promise.reject(new Error(`non-anthropic adapter (${preset.id}) must not use fakeClient`)),
						}),
					},
				},
			} as any
			const adapter = getAdapter(preset.id, fakeClient)
			const r = await adapter.dispatch(cas.request as any, {
				id: preset.id,
				baseURL: override.baseURL ?? preset.defaultBaseURL,
				modelId: override.modelId ?? preset.defaultModelId,
				capabilities: preset.capabilities,
			})

			if (preset.capabilities.toolUse) {
				// MUST surface a tool_use block (events branch: tool_use
				// content_block_start; message branch: tool_use in content[]).
				// Currently this is anthropic / openai / glm. (Minimax is
				// `toolUse: false` until the adapter parses function_call —
				// see preset comment.)
				if (r.kind === 'events') {
					const blocks: Array<{ type: string; name?: string }> = []
					for await (const e of r.events) {
						const evt = e as { type: string; content_block?: { type: string; name?: string } }
						if (evt.type === 'content_block_start' && evt.content_block) blocks.push(evt.content_block)
					}
					expect(blocks.find((b) => b.type === 'tool_use')).toBeDefined()
				} else {
					const toolBlocks = r.message.content.filter((b) => (b as { type: string }).type === 'tool_use')
					expect(toolBlocks.length).toBeGreaterThan(0)
					const tu = toolBlocks[0] as { name: string; input: Record<string, unknown> }
					expect(tu.name).toBe('FileRead')
					expect(tu.input).toEqual({ path: '/etc/hosts' })
				}
			} else {
				// preset.capabilities.toolUse === false → openai-compatible
				// or minimax (until Minimax function-call lands). Graceful
				// degrade in both cases, but the wire-body contract differs:
				//   • openai-compatible (Decision #11, informative-flag rule):
				//     the Anthropic-side request still carries `tools` AND
				//     the OpenAI wire body still carries `tools` — the agent
				//     loop just doesn't require a tool round-trip; the model
				//     degrades to plain text.
				//   • minimax v1 (explicit exception to Decision #11): the
				//     Anthropic-side request carries `tools`, but the
				//     adapter strips both `tools` and `functions` from the
				//     wire body before dispatch. The matrix's outbound-
				//     assertion loop pins this with
				//     `expect(body.tools).toBeUndefined()` AND
				//     `expect(body.functions).toBeUndefined()`.
				// Both contracts share the inbound assertion (text block
				// present, no tool_use blocks), which is what we check here:
				expect(r.kind).toBe('message')
				if (r.kind === 'message') {
					const textBlocks = r.message.content.filter((b) => (b as { type: string }).type === 'text')
					expect(textBlocks.length).toBeGreaterThan(0)
					const toolBlocks = r.message.content.filter((b) => (b as { type: string }).type === 'tool_use')
					expect(toolBlocks).toHaveLength(0)
				}
			}
			// Outbound assertions: URL/model must always be correct for
			// HTTP adapters. Tool propagation is more nuanced — see the
			// per-adapter branches below. Skip Anthropic — it goes via
			// the SDK Stream path.
			if (preset.id !== 'anthropic') {
				expect(captured.length).toBeGreaterThan(0)
				const call = captured[0]
				const expectedBaseURL = override.baseURL ?? preset.defaultBaseURL
				expect(call.url.startsWith(expectedBaseURL!)).toBe(true)
				const body = call.body as { model?: string; tools?: unknown[]; functions?: unknown[] }
				expect(body.model).toBe(override.modelId ?? preset.defaultModelId)
				if (preset.id === 'minimax') {
					// Minimax v1 graceful-degrade contract: the adapter
					// does NOT translate Anthropic's `tools` schema to
					// Minimax's `functions` vocabulary (master plan §M5
					// 5.8 left native protocols for follow-up). The wire
					// body therefore has no `functions` field — locking
					// this in so a future PR can't silently start
					// emitting a half-mapped schema. When function_call
					// parsing lands, flip Minimax's preset `toolUse` to
					// `true`, add the schema mapping, and replace this
					// negative assertion with the same `tools.length > 0`
					// check the OpenAI-family adapters use.
					expect(body.functions).toBeUndefined()
					expect(body.tools).toBeUndefined()
				} else {
					// OpenAI / OpenAI-compatible / GLM use OpenAI's `tools`
					// vocabulary; Decision #11 says `toolUse: false`
					// (`openai-compatible`) does NOT mean "drop tools" —
					// it means "the agent can ignore the response". A
					// regression that strips tools at the OpenAI-shape
					// adapter boundary is caught here.
					const tools = body.tools ?? []
					expect(Array.isArray(tools) && tools.length > 0).toBe(true)
				}
			}
		} finally {
			globalThis.fetch = origFetch
		}
	})
}

// ─── redactedSend pipe round-trip ──────────────────────────────────────
// The two loops above call `adapter.dispatch` directly, which proves the
// outbound/inbound transforms work but skips the layers above the
// adapter. This loop fills in part of that gap by driving
// `sendRedactedRequestStreaming` per preset (with a `__setAdapterForTest`
// fake so we don't depend on cassette wire-shape correctness here) and
// asserts the **dispatch-fork selection**, **StreamCompat wrapper shape**
// (`controller` + `[Symbol.asyncIterator]` — what `claude.ts:queryModel`
// actually consumes), **event synthesis** when the adapter returns
// `kind: 'message'`, and **request_id propagation** are correct per
// provider. **Scope honesty:** this is NOT full agent-loop coverage. We
// do not run `queryModel` itself, do not exercise the inbound middleware
// chain (re-id / audit / notePersist), do not bridge through AppState,
// and do not run the real adapter against a real wire response. The M5
// master-plan exit criterion "agent loop on each provider in research
// mode" is partially covered here (the redactedSend half) and the rest
// is left to manual verification — see the manual-checklist task at the
// end of the plan. A future task can replace the `__setAdapterForTest`
// fake with the real adapter + cassette-stubbed transport to widen
// coverage without redesigning the loop.
// `__setAdapterForTest` / `__clearAdapterOverrideForTest` / `getAdapter`
// are imported at the top of the file. Only redactedSend + phi helpers
// are added here.
import { sendRedactedRequestStreaming } from '../../../src/services/api/redactedSend.js'
import { __markRedactedForTest } from '../../../src/medical/middleware/phiMiddleware.js'

for (const preset of PROVIDER_PRESETS) {
	test(`capability-matrix: ${preset.id} sendRedactedRequestStreaming round-trip`, async () => {
		// We deliberately split the fake adapters across both response
		// shapes so this loop covers BOTH redactedSend branches:
		//   • two presets (anthropic, openai) get a `kind: 'events'` fake
		//     — drives the passthrough path that wraps the upstream
		//     `AsyncIterable` in a `StreamCompat` shell.
		//   • the remaining three get a `kind: 'message'` fake — drives
		//     the synthesis path where redactedSend builds
		//     `message_start` → `content_block_*` → `message_stop` from a
		//     one-shot BetaMessage.
		// The split is for redactedSend coverage ONLY and does NOT reflect
		// the real adapters' wire shapes. In particular, the **real**
		// OpenAI v1 adapter is `stream: false` and returns
		// `kind: 'message'` (Task 5.7) — the Anthropic adapter is the
		// only preset whose real implementation produces `kind: 'events'`.
		// The fake here puts OpenAI on the events branch purely to ensure
		// both branches are exercised across the matrix; do NOT read this
		// as "OpenAI v1 streams."
		const useEvents = preset.id === 'anthropic' || preset.id === 'openai'
		async function* fakeEvents(): AsyncIterable<unknown> {
			yield { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', content: [], model: preset.defaultModelId, stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }
			yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
			yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } }
			yield { type: 'content_block_stop', index: 0 }
			yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }
			yield { type: 'message_stop' }
		}
		const fakeAdapter = {
			id: preset.id,
			displayName: preset.displayName,
			async dispatch() {
				if (useEvents) {
					const ctl = new AbortController()
					return { kind: 'events' as const, events: fakeEvents() as any, controller: ctl, requestId: `req_${preset.id}` }
				}
				return {
					kind: 'message' as const,
					message: {
						id: 'm', type: 'message', role: 'assistant',
						content: [{ type: 'text', text: 'hi' }],
						model: preset.defaultModelId, stop_reason: 'end_turn',
						stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
					} as any,
					requestId: `req_${preset.id}`,
				}
			},
		}
		__setAdapterForTest(preset.id, fakeAdapter as any)
		setSessionProvider({
			id: preset.id,
			baseURL: preset.defaultBaseURL,
			modelId: preset.defaultModelId,
			capabilities: preset.capabilities,
		})
		try {
			const redacted = __markRedactedForTest({
				model: preset.defaultModelId,
				max_tokens: 64,
				messages: [{ role: 'user', content: 'hi' }],
			} as any)
			const out = await sendRedactedRequestStreaming({} as any, redacted, {} as any)
			// `claude.ts:queryModel` checks `'controller' in stream` to
			// distinguish a Stream from an API error — this is the load-
			// bearing assertion for the StreamCompat invariant.
			expect(out.data).toBeDefined()
			expect((out.data as { controller?: unknown }).controller).toBeDefined()
			expect(out.request_id).toBe(`req_${preset.id}`)
			const types: string[] = []
			for await (const e of out.data as AsyncIterable<{ type: string }>) {
				types.push(e.type)
			}
			expect(types[0]).toBe('message_start')
			expect(types[types.length - 1]).toBe('message_stop')
		} finally {
			__clearAdapterOverrideForTest()
			setSessionProvider(null)
		}
	})
}
