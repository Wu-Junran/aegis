import { test, expect } from 'bun:test'
import { createAnthropicAdapter } from '../../../../src/medical/providers/AnthropicAdapter.js'
import type { ProviderConfig } from '../../../../src/medical/providers/ProviderAdapter.js'

const cfg: ProviderConfig = {
	id: 'anthropic',
	modelId: 'claude-opus-4-7',
	capabilities: { streaming: true, toolUse: true, promptCache: true, maxContextTokens: 1_000_000 },
}

test('dispatch routes through client.beta.messages.create and emits raw events', async () => {
	let seenParams: any = null
	let seenOpts: any = null
	const fakeClient = {
		beta: {
			messages: {
				create: (params: any, opts: any) => {
					seenParams = params
					seenOpts = opts
					const data: any = (async function* () {
						yield { type: 'message_start', message: { id: 'msg_test', model: 'claude-opus-4-7', role: 'assistant', content: [], usage: { input_tokens: 1, output_tokens: 0 } } }
						yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
						yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }
						yield { type: 'content_block_stop', index: 0 }
						yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }
						yield { type: 'message_stop' }
					})()
					data.controller = new AbortController()
					return {
						withResponse: () =>
							Promise.resolve({
								data,
								response: new Response(null, { status: 200 }),
								request_id: 'req_test_123',
							}),
					}
				},
			},
		},
	} as any
	const adapter = createAnthropicAdapter(fakeClient)
	// Note: `request.model` is the legacy/upstream choice; `cfg.modelId` is
	// the session-selected model. Pass-through MUST use cfg.modelId.
	const req = { model: 'claude-opus-4-6', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] } as any
	const sig = new AbortController().signal
	const out = await adapter.dispatch(req, cfg, { signal: sig, headers: { 'x-aegis-request-id': 'cli_42' } })
	expect(adapter.id).toBe('anthropic')
	expect(out.kind).toBe('events')
	// P1.4: model override — config.modelId wins over request.model.
	expect(seenParams.model).toBe('claude-opus-4-7')
	expect(seenParams.stream).toBe(true)
	// P1.3: opts threaded through (signal + headers).
	expect(seenOpts.signal).toBe(sig)
	expect(seenOpts.headers['x-aegis-request-id']).toBe('cli_42')
	// P1.2: request_id surfaced on AdapterResponse.
	expect((out as { requestId?: string | null }).requestId).toBe('req_test_123')
	const types: string[] = []
	if (out.kind === 'events') for await (const e of out.events) types.push((e as any).type)
	expect(types).toEqual(['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop'])
})
