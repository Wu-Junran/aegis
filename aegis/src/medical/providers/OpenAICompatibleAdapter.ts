import type {
	BetaMessage,
	BetaMessageStreamParams,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import OpenAI from 'openai'
import type {
	AdapterRequest,
	AdapterRequestOptions,
	AdapterResponse,
	ProviderAdapter,
	ProviderConfig,
} from './ProviderAdapter.js'
import { loadCredential } from './credentials.js'

type OAIMessage = {
	role: 'system' | 'user' | 'assistant' | 'tool'
	content: string | null
	tool_calls?: Array<{
		id: string
		type: 'function'
		function: { name: string; arguments: string }
	}>
	tool_call_id?: string
}
type OAITool = {
	type: 'function'
	function: { name: string; description?: string; parameters: unknown }
}

export function createOpenAICompatibleAdapter(
	id: 'openai' | 'openai-compatible' = 'openai-compatible',
): ProviderAdapter {
	return {
		id,
		displayName: id === 'openai' ? 'OpenAI' : 'OpenAI-compatible',
		async dispatch(
			request: AdapterRequest,
			config: ProviderConfig,
			opts?: AdapterRequestOptions,
		): Promise<AdapterResponse> {
			const apiKey = await loadCredential(config.id)
			// Forward `globalThis.fetch` explicitly. The OpenAI SDK
			// resolves its fetch reference via runtime detection at
			// import/construct time, which can pin to a captured
			// reference that bypasses `globalThis.fetch` swaps installed
			// later by tests. Reading `globalThis.fetch` here at
			// dispatch time and passing it via the documented `fetch`
			// option guarantees the cassette stub installed by
			// `makeFetchStub` intercepts every adapter request — and
			// has zero effect in production where the global is the
			// runtime fetch the SDK would have used anyway. This applies
			// transitively to GLM (which delegates here) and the
			// generic `openai-compatible` preset.
			const client = new OpenAI({ apiKey, baseURL: config.baseURL, fetch: globalThis.fetch })
			const oaiReq = transformRequest(request, config)
			// Forward signal so claude.ts cancellation aborts the upstream
			// request. OpenAI SDK's second arg accepts `{ signal, headers }`.
			// Cast through `unknown` because our internal OAIMessage type
			// uses `content: string | null` (valid for the assistant role per
			// the OpenAI spec) while the SDK's union discriminates per-role.
			// The runtime value is always correct — this is a type-level
			// simplification.
			// `timeout` is honored by the OpenAI SDK per-request and
			// converted to an internal AbortController. claude.ts:1019
			// passes `fallbackTimeoutMs` for the non-streaming fallback
			// path; forwarding it here closes the dropped-timeout gap
			// for OpenAI / GLM / openai-compatible (GLM delegates to
			// this adapter unchanged).
			//
			// Only include `timeout` when DEFINED — the OpenAI SDK
			// validates `timeout` strictly even when set to `undefined`
			// ("timeout must be an integer"), so blanket-spreading
			// `opts?.timeout` would break the streaming path that
			// (correctly) passes no timeout.
			//
			// `maxRetries: 0` is load-bearing: by default the OpenAI SDK
			// retries 2× per request, and each retry resets the per-request
			// `timeout` deadline. With the default a `timeout` of e.g.
			// 50ms would actually take ~3 attempts × 50ms before final
			// rejection, and the production `fallbackTimeoutMs` (300_000
			// per claude.ts) could stretch across multiple attempts —
			// silently violating the bounded-fallback contract. Retry
			// policy belongs to `executeNonStreamingRequest` in claude.ts;
			// the adapter's job is to make ONE dispatch and honor its
			// deadline. This makes `timeout` the actual elapsed cap.
			const sdkOpts: {
				signal?: AbortSignal
				headers?: Record<string, string>
				timeout?: number
				maxRetries: number
			} = {
				signal: opts?.signal,
				headers: opts?.headers,
				maxRetries: 0,
			}
			if (typeof opts?.timeout === 'number') sdkOpts.timeout = opts.timeout
			const completion = await (
				client.chat.completions.create as unknown as (
					body: unknown,
					opts?: unknown,
				) => Promise<OAIRawResponse>
			)({ ...oaiReq, stream: false }, sdkOpts)
			const beta = transformResponse(completion)
			// OpenAI Chat Completions returns its id; surface it as the
			// adapter request id so audit + correlation downstream work.
			return { kind: 'message', message: beta, requestId: completion.id ?? null }
		},
	}
}

type OAIRawResponse = {
	id: string
	model: string
	choices: Array<{
		index: number
		message: { role: 'assistant'; content: string | null; tool_calls?: OAIMessage['tool_calls'] }
		finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter'
	}>
	usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

function transformRequest(req: BetaMessageStreamParams, config: ProviderConfig) {
	const messages: OAIMessage[] = []
	if (typeof req.system === 'string' && req.system.length > 0) {
		messages.push({ role: 'system', content: req.system })
	} else if (Array.isArray(req.system)) {
		const merged = req.system
			.map((s) => (typeof s === 'string' ? s : (s as { text: string }).text))
			.join('\n')
		if (merged.length > 0) messages.push({ role: 'system', content: merged })
	}
	for (const m of req.messages) {
		for (const oai of transformAnthropicMessage(m as AnthropicMessage)) messages.push(oai)
	}
	const tools: OAITool[] | undefined = req.tools?.map((t) => ({
		type: 'function',
		function: {
			name: (t as { name: string }).name,
			description: (t as { description?: string }).description,
			parameters: (t as { input_schema: unknown }).input_schema,
		},
	}))
	return {
		model: config.modelId,
		max_tokens: req.max_tokens ?? undefined,
		temperature: (req as unknown as { temperature?: number }).temperature,
		messages,
		tools,
	}
}

type AnthropicMessage = {
	role: 'user' | 'assistant'
	content: string | Array<{ type: string; [k: string]: unknown }>
}

/**
 * Convert ONE Anthropic message to ZERO OR MORE OpenAI messages.
 *
 * Multi-turn tool use round-trips by mapping:
 *   - assistant text blocks → OAI assistant.content
 *   - assistant tool_use blocks → OAI assistant.tool_calls[]
 *   - user tool_result blocks → ONE OAI `tool` message PER block (tool_call_id linked)
 *   - user text blocks → trailing OAI user message (after any tool messages)
 *
 * Without this, the second turn after a tool call would arrive as opaque
 * Anthropic-shaped blocks the OpenAI API rejects, breaking the agent loop.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: OAI message format transform covers multiple role/content-block variants — structural complexity is intentional
function transformAnthropicMessage(m: AnthropicMessage): OAIMessage[] {
	if (typeof m.content === 'string') {
		return [{ role: m.role, content: m.content }]
	}
	if (m.role === 'assistant') {
		const text = m.content
			.filter((b) => b.type === 'text')
			.map((b) => (b as unknown as { text: string }).text)
			.join('\n')
		const toolCalls = m.content
			.filter((b) => b.type === 'tool_use')
			.map((b) => {
				const tu = b as unknown as { id: string; name: string; input: unknown }
				return {
					id: tu.id,
					type: 'function' as const,
					function: { name: tu.name, arguments: JSON.stringify(tu.input ?? {}) },
				}
			})
		if (toolCalls.length > 0) {
			// OpenAI: assistant.content may be null when tool_calls present
			return [{ role: 'assistant', content: text.length > 0 ? text : null, tool_calls: toolCalls }]
		}
		return [{ role: 'assistant', content: text }]
	}
	// m.role === 'user'
	const out: OAIMessage[] = []
	const userTextParts: string[] = []
	for (const b of m.content) {
		if (b.type === 'tool_result') {
			const tr = b as unknown as {
				tool_use_id: string
				content: string | Array<{ type: string; text?: string }>
			}
			const content =
				typeof tr.content === 'string'
					? tr.content
					: tr.content
							.filter((x) => x.type === 'text')
							.map((x) => x.text ?? '')
							.join('\n')
			out.push({ role: 'tool', content, tool_call_id: tr.tool_use_id })
		} else if (b.type === 'text') {
			userTextParts.push((b as unknown as { text: string }).text)
		}
	}
	if (userTextParts.length > 0) {
		out.push({ role: 'user', content: userTextParts.join('\n') })
	}
	return out
}

function transformResponse(resp: OAIRawResponse): BetaMessage {
	const choice = resp.choices[0]!
	const blocks: BetaMessage['content'] = []
	if (typeof choice.message.content === 'string' && choice.message.content.length > 0) {
		blocks.push({ type: 'text', text: choice.message.content } as BetaMessage['content'][number])
	}
	for (const tc of choice.message.tool_calls ?? []) {
		blocks.push({
			type: 'tool_use',
			id: tc.id,
			name: tc.function.name,
			input: safeParseJson(tc.function.arguments),
		} as BetaMessage['content'][number])
	}
	const stopReason: BetaMessage['stop_reason'] =
		choice.finish_reason === 'tool_calls'
			? 'tool_use'
			: choice.finish_reason === 'length'
				? 'max_tokens'
				: 'end_turn'
	return {
		id: resp.id,
		type: 'message',
		role: 'assistant',
		model: resp.model,
		content: blocks,
		stop_reason: stopReason,
		stop_sequence: null,
		usage: { input_tokens: resp.usage.prompt_tokens, output_tokens: resp.usage.completion_tokens },
	} as BetaMessage
}

function safeParseJson(s: string): Record<string, unknown> {
	try {
		return JSON.parse(s) as Record<string, unknown>
	} catch {
		return {}
	}
}

// Test exports — underscore-prefixed to signal "internal".
export const __transformRequestForTest = transformRequest
export const __transformResponseForTest = transformResponse
