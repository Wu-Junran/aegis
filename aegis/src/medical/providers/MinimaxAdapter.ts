import type {
	BetaMessage,
	BetaMessageStreamParams,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
	AdapterRequest,
	AdapterRequestOptions,
	AdapterResponse,
	ProviderAdapter,
	ProviderConfig,
} from './ProviderAdapter.js'
import { loadCredential } from './credentials.js'

const MINIMAX_DEFAULT_BASE_URL = 'https://api.minimaxi.chat/v1'

type MinimaxResponse = {
	id: string
	model: string
	choices: Array<{
		messages: Array<{ sender_type: 'BOT' | 'USER' | 'SYSTEM'; sender_name: string; text: string }>
		finish_reason: 'stop' | 'length' | 'tool_calls'
	}>
	usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

export function createMinimaxAdapter(): ProviderAdapter {
	return {
		id: 'minimax',
		displayName: 'MiniMax',
		async dispatch(
			request: AdapterRequest,
			config: ProviderConfig,
			opts?: AdapterRequestOptions,
		): Promise<AdapterResponse> {
			const apiKey = await loadCredential('minimax')
			const baseURL = config.baseURL ?? MINIMAX_DEFAULT_BASE_URL
			const body = transformRequest(request, config)
			// Compose an internal AbortController so we can honor BOTH the
			// caller's `signal` AND the `timeout` from
			// `AdapterRequestOptions` (claude.ts passes `fallbackTimeoutMs`
			// on the non-streaming fallback path). Raw `fetch` doesn't
			// take a `timeout` option, so we install a `setTimeout` that
			// aborts the inner controller; the outer `signal` is forwarded
			// via an `abort` listener that aborts the inner controller too.
			// This keeps caller-cancel and fallback-timeout-cancel behaving
			// as a single linearizable abort path.
			const inner = new AbortController()
			const callerSignal = opts?.signal
			const onCallerAbort = () => inner.abort(callerSignal?.reason)
			if (callerSignal) {
				if (callerSignal.aborted) inner.abort(callerSignal.reason)
				else callerSignal.addEventListener('abort', onCallerAbort, { once: true })
			}
			const timeoutMs = opts?.timeout
			const timer =
				typeof timeoutMs === 'number' && timeoutMs > 0
					? setTimeout(
							() => inner.abort(new Error(`Minimax dispatch timed out after ${timeoutMs}ms`)),
							timeoutMs,
						)
					: null
			try {
				const resp = await fetch(`${baseURL}/text/chatcompletion_pro`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${apiKey}`,
						...(opts?.headers ?? {}),
					},
					body: JSON.stringify(body),
					signal: inner.signal,
				})
				if (!resp.ok)
					throw new Error(`Minimax dispatch failed: ${resp.status} ${await resp.text()}`)
				const json = (await resp.json()) as MinimaxResponse
				return { kind: 'message', message: transformResponse(json), requestId: json.id ?? null }
			} finally {
				if (timer) clearTimeout(timer)
				if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort)
			}
		},
	}
}

// Flatten Anthropic-shape `MessageParam.content` (string | block[]) to a
// plain string for Minimax's text-only message format. Earlier drafts
// did `typeof m.content === 'string' ? m.content : ''` which silently
// dropped block-array content — Claude Code routinely produces
// `[{ type: 'text', text: '...' }]` for structured user messages, so
// that path discarded the actual prompt while inbound-only tests passed.
// Recover text from `text` blocks AND from `tool_result` blocks (whose
// content itself is text-shaped); skip `tool_use` blocks because
// Minimax v1's preset has `toolUse: false` (Decision #11) and the
// adapter does not yet parse Minimax's `function_call` vocabulary.
function flattenContentToText(content: unknown): string {
	if (typeof content === 'string') return content
	if (!Array.isArray(content)) return ''
	const parts: string[] = []
	for (const b of content) {
		const block = b as { type?: string; text?: string; content?: unknown }
		if (block.type === 'text' && typeof block.text === 'string') {
			parts.push(block.text)
		} else if (block.type === 'tool_result') {
			// `content` on a tool_result is `string | block[]` again.
			parts.push(flattenContentToText(block.content))
		}
		// `tool_use` blocks: skip — Minimax v1 cannot round-trip them.
	}
	return parts.join('\n')
}

function transformRequest(req: BetaMessageStreamParams, config: ProviderConfig) {
	const messages: Array<{
		sender_type: 'USER' | 'BOT' | 'SYSTEM'
		sender_name: string
		text: string
	}> = []
	// `req.system` is `string | TextBlockParam[]`. Real agent-loop requests
	// build it via `buildSystemPromptBlocks(...)` which returns the array
	// shape, so the string branch alone would silently drop the actual
	// medical/safety/system instructions and leave Minimax with only the
	// hardcoded `bot_setting` below. Flatten arrays via the same helper
	// used for message content so a `TextBlockParam[]` (each entry
	// `{ type: 'text', text: '...', cache_control?: {...} }`) is
	// concatenated to a single SYSTEM message.
	let systemText = ''
	if (typeof req.system === 'string') {
		systemText = req.system
	} else if (Array.isArray(req.system)) {
		systemText = flattenContentToText(req.system)
	}
	if (systemText.length > 0) {
		messages.push({ sender_type: 'SYSTEM', sender_name: 'system', text: systemText })
	}
	for (const m of req.messages) {
		const text = flattenContentToText(m.content)
		messages.push({
			sender_type: m.role === 'user' ? 'USER' : 'BOT',
			sender_name: m.role === 'user' ? 'user' : 'MiniMax',
			text,
		})
	}
	return {
		model: config.modelId,
		messages,
		tokens_to_generate: req.max_tokens ?? 1024,
		bot_setting: [{ bot_name: 'MiniMax', content: 'You are a helpful clinical assistant.' }],
		reply_constraints: { sender_type: 'BOT', sender_name: 'MiniMax' },
	}
}

function transformResponse(resp: MinimaxResponse): BetaMessage {
	const text = resp.choices[0]?.messages[0]?.text ?? ''
	const finish = resp.choices[0]?.finish_reason ?? 'stop'
	const stopReason: BetaMessage['stop_reason'] =
		finish === 'tool_calls' ? 'tool_use' : finish === 'length' ? 'max_tokens' : 'end_turn'
	return {
		id: resp.id,
		type: 'message',
		role: 'assistant',
		model: resp.model,
		content: [{ type: 'text', text }],
		stop_reason: stopReason,
		stop_sequence: null,
		usage: { input_tokens: resp.usage.prompt_tokens, output_tokens: resp.usage.completion_tokens },
	} as BetaMessage
}

export const __transformRequestForTest = transformRequest
export const __transformResponseForTest = transformResponse
