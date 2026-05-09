import type {
	BetaMessage,
	BetaMessageStreamParams,
	BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

export type SessionProviderId = 'anthropic' | 'openai' | 'glm' | 'minimax' | 'openai-compatible'

/** String literal used in audit logs when no session provider is set. */
export const ANTHROPIC_LEGACY_PROVIDER_ID = 'anthropic-legacy' as const
export type AuditProviderId = SessionProviderId | typeof ANTHROPIC_LEGACY_PROVIDER_ID

export type ProviderCapabilities = {
	streaming: boolean
	toolUse: boolean
	promptCache: boolean
	maxContextTokens: number
}

export type ProviderConfig = {
	id: SessionProviderId
	displayName?: string
	baseURL?: string
	modelId: string
	capabilities: ProviderCapabilities
}

/**
 * Adapter request: the unwrapped Anthropic-shaped params after the M4 outbound
 * chain. Adapters MUST NOT inspect or mutate this for PHI re-introduction.
 */
export type AdapterRequest = BetaMessageStreamParams

/**
 * Adapter request options. Mirrors the second arg to the Anthropic SDK's
 * `client.beta.messages.create(params, opts)`:
 *  - `signal`: AbortSignal — `claude.ts` passes its query-scoped abort signal,
 *    which our cancellation paths rely on. Adapters that issue HTTP must
 *    forward this signal to their fetch/SDK call.
 *  - `headers`: per-request headers — `claude.ts` sets the
 *    `CLIENT_REQUEST_ID_HEADER` (request correlation across services).
 *    Adapters whose backend honors it should forward; others may ignore.
 *  - `timeout`: per-request timeout in ms — `claude.ts:1019` passes its
 *    `fallbackTimeoutMs` for the non-streaming fallback path. Adapters
 *    MUST honor this so non-Anthropic backends can't hang past the
 *    bounded fallback window. Anthropic SDK accepts it natively
 *    (`RequestOptions.timeout`); the OpenAI SDK accepts it on per-request
 *    `RequestOptions`; raw-`fetch` adapters wrap an internal
 *    `AbortController` + `setTimeout` to enforce it. Streaming callers
 *    typically omit `timeout` and rely on the streaming idle watchdog
 *    (`STREAM_IDLE_TIMEOUT_MS` in `claude.ts:queryModel`); when omitted,
 *    adapters fall through to the SDK/runtime defaults.
 */
export type AdapterRequestOptions = {
	signal?: AbortSignal
	headers?: Record<string, string>
	timeout?: number
}

/**
 * Adapter response. Two shapes:
 *  - `kind: 'events'` — adapter natively streamed; emits raw Anthropic stream
 *    events (`message_start` / `content_block_start` / `content_block_delta` /
 *    `content_block_stop` / `message_delta` / `message_stop`) so
 *    `queryModel`'s switch in claude.ts:2174–2497 consumes them unchanged.
 *    `controller` should be the underlying SDK Stream's AbortController so
 *    `claude.ts:~3118` can abort the upstream cleanly. If omitted,
 *    `redactedSend.ts` constructs a fresh one (the cleanup `.abort()` call
 *    is then a no-op, which is correct for already-completed responses).
 *  - `kind: 'message'` — adapter returned a one-shot response. When the
 *    streaming call site needs an event stream, `redactedSend.ts` synthesizes
 *    one from the BetaMessage. Used by HTTP-one-shot adapters (OpenAI / GLM /
 *    Minimax v1).
 *
 * `requestId` is the upstream provider's request id when the adapter knows
 * one (Anthropic SDK exposes it on `withResponse()`). `claude.ts:2028` reads
 * `result.request_id` for the streaming branch; the adapter wrap must
 * surface it. `null` if not available — that's the SDK's own fallback type.
 *
 * Adapters MUST emit Anthropic-shaped responses (raw events OR BetaMessage).
 */
export type AdapterResponse =
	| {
			kind: 'events'
			events: AsyncIterable<BetaRawMessageStreamEvent>
			controller?: AbortController
			requestId?: string | null
	  }
	| { kind: 'message'; message: BetaMessage; requestId?: string | null }

export interface ProviderAdapter {
	readonly id: SessionProviderId
	readonly displayName: string
	dispatch(
		request: AdapterRequest,
		config: ProviderConfig,
		opts?: AdapterRequestOptions,
	): Promise<AdapterResponse>
	// Note: model discovery is config-driven (`effectiveKnownModels(preset,
	// rc)` in `presets.ts`), not adapter-driven. The picker reads
	// preset.knownModels overlaid by .aegisrc.providers[id].knownModels.
	// We deliberately do not expose a listModels() method here — adding it
	// would split the source of truth for "what models can I pick" between
	// presets.ts and the adapter, and the .aegisrc overlay already lets
	// operators extend the list without touching adapter code.
}
