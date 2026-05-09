import type Anthropic from '@anthropic-ai/sdk'
import type {
	BetaMessage,
	BetaMessageStreamParams,
	BetaRawMessageStreamEvent,
	MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.js'
import type { RedactedAPIRequest } from '../../medical/middleware/phiMiddleware.js'
import { unwrapRedacted } from '../../medical/middleware/phiMiddleware.js'
import { getSessionProvider } from './sessionProvider.js'
import { getAdapter } from '../../medical/providers/adapterRegistry.js'
import type { AdapterRequestOptions } from '../../medical/providers/ProviderAdapter.js'

/**
 * The ONLY production file allowed to import unwrapRedacted. All Anthropic
 * SDK calls in claude.ts must route through here. This is the M4 type-system
 * boundary: claude.ts builds a RedactedAPIRequest via the middleware chain
 * and passes it here; this function is the single point of unwrap.
 */
export function sendRedactedRequestStreaming(
	client: Anthropic,
	redacted: RedactedAPIRequest,
	opts: Parameters<Anthropic['beta']['messages']['create']>[1],
) {
	const params = unwrapRedacted<BetaMessageStreamParams>(redacted)
	const session = getSessionProvider()
	if (!session) {
		// Legacy / Anthropic-direct path — preserves upstream behavior. The
		// SDK's withResponse() result already has `data` as a Stream with
		// `controller`, plus `request_id`, so it satisfies queryModel's
		// contract (claude.ts:2028 reads `result.request_id`) directly.
		return client.beta.messages.create({ ...params, stream: true }, opts).withResponse()
	}
	// Override `params.model` with the session-selected model BEFORE dispatch.
	// /provider set + /model both write `currentProvider.modelId`; the request
	// must land on that model regardless of what legacy paramsFromContext
	// chose. This is one place, applies to all adapters uniformly.
	const effectiveParams: BetaMessageStreamParams = { ...params, model: session.modelId }
	const adapter = getAdapter(session.id, client)
	// Translate the SDK opts to `AdapterRequestOptions` (signal / headers /
	// timeout) — explicit allowlist forwarding so unknown SDK keys can't
	// leak into adapter dispatch unintentionally. Streaming callers (claude.ts
	// :2020) currently omit `timeout` and rely on the streaming idle watchdog,
	// but we forward it unconditionally so future callers don't need a
	// matching change here.
	const adapterOpts: AdapterRequestOptions = {
		signal: (opts as { signal?: AbortSignal } | undefined)?.signal,
		headers: (opts as { headers?: Record<string, string> } | undefined)?.headers,
		timeout: (opts as { timeout?: number } | undefined)?.timeout,
	}
	return adapter.dispatch(effectiveParams, session, adapterOpts).then((r) => {
		const events: AsyncIterable<BetaRawMessageStreamEvent> =
			r.kind === 'events' ? r.events : synthesizeEventStream(r.message)
		const upstreamController = r.kind === 'events' ? r.controller : undefined
		// Surface request_id so claude.ts:2028 (`streamRequestId = result.request_id`)
		// records the adapter's upstream id when known. `null` matches the
		// SDK's own type for "no request id".
		return {
			data: makeStreamCompat(events, upstreamController),
			response: new Response(null, { status: 200 }),
			request_id: r.requestId ?? null,
		}
	})
}

/**
 * Non-streaming fallback variant. Used by executeNonStreamingRequest when
 * the streaming attempt is bypassed (idle-watchdog timeout, certain 4xx).
 * Same brand discipline; same one-line unwrap.
 *
 * Defensive `stream` strip: the unwrap is typed as `BetaMessageStreamParams`
 * (the base shape that allows `stream: true`). If the underlying redacted
 * params ever carry `stream: true`, the SDK overload would pick the streaming
 * variant and return a `Stream<…>` instead of a `BetaMessage`, which the
 * caller would then mis-await. Stripping `stream` lets the
 * `MessageCreateParamsNonStreaming` overload select cleanly without an
 * `as unknown as` lie.
 */
export async function sendRedactedRequestNonStreaming(
	client: Anthropic,
	redacted: RedactedAPIRequest,
	opts: Parameters<Anthropic['beta']['messages']['create']>[1],
): Promise<BetaMessage> {
	const params = unwrapRedacted<BetaMessageStreamParams>(redacted)
	const session = getSessionProvider()
	if (!session) {
		const { stream: _stream, ...nonStreamingParams } = params as { stream?: unknown } & typeof params
		return client.beta.messages.create(
			nonStreamingParams as MessageCreateParamsNonStreaming,
			opts,
		) as Promise<BetaMessage>
	}
	const effectiveParams: BetaMessageStreamParams = { ...params, model: session.modelId }
	// Non-streaming fallback path — `claude.ts:1019` passes `timeout:
	// fallbackTimeoutMs`. Forwarding it here is load-bearing: without it,
	// provider-mode (OpenAI / GLM / Minimax / openai-compatible) fallback
	// calls would ignore the bounded fallback window and could hang
	// indefinitely past the configured timeout. Adapters honor it natively
	// (Anthropic / OpenAI SDKs) or via internal AbortController +
	// setTimeout (raw-fetch Minimax).
	const adapterOpts: AdapterRequestOptions = {
		signal: (opts as { signal?: AbortSignal } | undefined)?.signal,
		headers: (opts as { headers?: Record<string, string> } | undefined)?.headers,
		timeout: (opts as { timeout?: number } | undefined)?.timeout,
	}
	const adapter = getAdapter(session.id, client)
	const r = await adapter.dispatch(effectiveParams, session, adapterOpts)
	if (r.kind === 'message') return r.message
	// `kind: 'events'` → reassemble a BetaMessage from the raw event stream.
	return reassembleBetaMessage(r.events)
}

/**
 * Stream-compatible wrapper for queryModel.
 *
 * `claude.ts` checks `'controller' in stream` to distinguish a live stream
 * from an API error (line ~2046) and calls `stream.controller.abort()` on
 * cleanup (line ~3118). A bare async generator does not satisfy this
 * contract. We always return a uniform `{ controller, [Symbol.asyncIterator] }`
 * object:
 *
 *  - When the adapter natively streams, `upstream` is the SDK's underlying
 *    AbortController; aborting our wrapper aborts the live HTTP request.
 *  - When events are synthesized from a one-shot BetaMessage, we mint a
 *    fresh AbortController; the cleanup `.abort()` call is a no-op, which
 *    is the correct behavior for an already-completed response.
 */
function makeStreamCompat(
	events: AsyncIterable<BetaRawMessageStreamEvent>,
	upstream: AbortController | undefined,
): { controller: AbortController; [Symbol.asyncIterator](): AsyncIterator<BetaRawMessageStreamEvent> } {
	const controller = upstream ?? new AbortController()
	return {
		controller,
		[Symbol.asyncIterator]: () => events[Symbol.asyncIterator](),
	}
}

/**
 * Convert a one-shot BetaMessage into the raw event sequence queryModel
 * consumes. Emits, in order:
 *   message_start
 *   for each content block: content_block_start → content_block_delta* → content_block_stop
 *   message_delta { stop_reason, stop_sequence } + final usage
 *   message_stop
 *
 * For text blocks: a single content_block_delta with the full text. For
 * tool_use blocks: a single content_block_delta with the input_json_delta
 * carrying JSON.stringify(input). The shape mirrors what the Anthropic SDK
 * emits for buffered responses.
 */
async function* synthesizeEventStream(
	message: BetaMessage,
): AsyncIterable<BetaRawMessageStreamEvent> {
	yield {
		type: 'message_start',
		message: {
			id: message.id,
			type: 'message',
			role: message.role,
			model: message.model,
			content: [],
			stop_reason: null,
			stop_sequence: null,
			usage: { input_tokens: message.usage.input_tokens, output_tokens: 0 },
		},
	} as BetaRawMessageStreamEvent
	for (let i = 0; i < message.content.length; i++) {
		const block = message.content[i]!
		if ((block as { type: string }).type === 'text') {
			const text = (block as { type: 'text'; text: string }).text
			yield { type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } } as BetaRawMessageStreamEvent
			yield { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text } } as BetaRawMessageStreamEvent
			yield { type: 'content_block_stop', index: i } as BetaRawMessageStreamEvent
		} else if ((block as { type: string }).type === 'tool_use') {
			const tu = block as { type: 'tool_use'; id: string; name: string; input: unknown }
			yield { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: tu.id, name: tu.name, input: {} } } as BetaRawMessageStreamEvent
			yield { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(tu.input) } } as BetaRawMessageStreamEvent
			yield { type: 'content_block_stop', index: i } as BetaRawMessageStreamEvent
		}
		// Other block types (server_tool_use, etc.) pass through best-effort:
		else {
			yield { type: 'content_block_start', index: i, content_block: block } as BetaRawMessageStreamEvent
			yield { type: 'content_block_stop', index: i } as BetaRawMessageStreamEvent
		}
	}
	yield {
		type: 'message_delta',
		delta: { stop_reason: message.stop_reason ?? 'end_turn', stop_sequence: message.stop_sequence ?? null },
		usage: { output_tokens: message.usage.output_tokens },
	} as BetaRawMessageStreamEvent
	yield { type: 'message_stop' } as BetaRawMessageStreamEvent
}

/**
 * Walk a raw event stream and rebuild the final BetaMessage. Mirrors the
 * accumulation queryModel does in claude.ts but in one helper for the
 * non-streaming code path that needs a single BetaMessage to return.
 */
async function reassembleBetaMessage(
	events: AsyncIterable<BetaRawMessageStreamEvent>,
): Promise<BetaMessage> {
	let id = ''
	let model = ''
	let role: BetaMessage['role'] = 'assistant'
	const content: BetaMessage['content'] = []
	let stopReason: BetaMessage['stop_reason'] = null
	let stopSequence: BetaMessage['stop_sequence'] = null
	let inputTokens = 0
	let outputTokens = 0
	// Tool-use blocks: Anthropic streams the input JSON as a sequence of
	// `input_json_delta` events whose `partial_json` fragments — when
	// concatenated — form a single valid JSON document. Parsing each
	// fragment alone (e.g. `{"path":` and `"/etc/hosts"}` separately) fails,
	// so accumulate as a STRING per block index and JSON.parse once at
	// `content_block_stop`. Falls back to {} on parse failure (malformed
	// upstream payload — better to land an empty input than crash).
	const toolJsonBuffers: Map<number, string> = new Map()
	for await (const e of events) {
		const evt = e as { type: string } & Record<string, unknown>
		if (evt.type === 'message_start') {
			const m = evt.message as { id: string; model: string; role: BetaMessage['role']; usage: { input_tokens: number } }
			id = m.id
			model = m.model
			role = m.role
			inputTokens = m.usage.input_tokens
		} else if (evt.type === 'content_block_start') {
			content.push((evt.content_block as BetaMessage['content'][number]))
			const idx = evt.index as number
			const cb = evt.content_block as { type: string }
			if (cb?.type === 'tool_use') toolJsonBuffers.set(idx, '')
		} else if (evt.type === 'content_block_delta') {
			const idx = evt.index as number
			const delta = evt.delta as { type: string; text?: string; partial_json?: string }
			const block = content[idx]
			if (block && (block as { type: string }).type === 'text' && delta.type === 'text_delta') {
				;(block as { text: string }).text += delta.text ?? ''
			}
			if (block && (block as { type: string }).type === 'tool_use' && delta.type === 'input_json_delta') {
				toolJsonBuffers.set(idx, (toolJsonBuffers.get(idx) ?? '') + (delta.partial_json ?? ''))
			}
		} else if (evt.type === 'content_block_stop') {
			const idx = evt.index as number
			const buf = toolJsonBuffers.get(idx)
			if (buf !== undefined) {
				const block = content[idx]
				let parsed: Record<string, unknown> = {}
				try { parsed = (buf.length > 0 ? JSON.parse(buf) : {}) as Record<string, unknown> } catch { parsed = {} }
				if (block && (block as { type: string }).type === 'tool_use') {
					;(block as { input: unknown }).input = parsed
				}
				toolJsonBuffers.delete(idx)
			}
		} else if (evt.type === 'message_delta') {
			const d = evt.delta as { stop_reason?: BetaMessage['stop_reason']; stop_sequence?: BetaMessage['stop_sequence'] }
			if (d.stop_reason) stopReason = d.stop_reason
			if (d.stop_sequence !== undefined) stopSequence = d.stop_sequence
			const u = evt.usage as { output_tokens?: number } | undefined
			if (u?.output_tokens !== undefined) outputTokens = u.output_tokens
		}
	}
	return { id, type: 'message', role, model, content, stop_reason: stopReason, stop_sequence: stopSequence, usage: { input_tokens: inputTokens, output_tokens: outputTokens } } as BetaMessage
}
