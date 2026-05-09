import type Anthropic from '@anthropic-ai/sdk'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
	AdapterRequest,
	AdapterRequestOptions,
	AdapterResponse,
	ProviderAdapter,
	ProviderConfig,
} from './ProviderAdapter.js'

export function createAnthropicAdapter(client: Anthropic): ProviderAdapter {
	return {
		id: 'anthropic',
		displayName: 'Anthropic (claude-*)',
		async dispatch(
			request: AdapterRequest,
			config: ProviderConfig,
			opts?: AdapterRequestOptions,
		): Promise<AdapterResponse> {
			// `request.model` may have been picked by legacy claude.ts code
			// before currentProvider was applied. Override with the
			// session-selected modelId so /provider set + /model selections
			// land on the actual call.
			const params = { ...request, model: config.modelId, stream: true as const }
			// The Anthropic SDK validates `timeout` strictly: the
			// `'timeout' in options` branch in client.mjs:691 fires
			// `validatePositiveInteger` even when the value is `undefined`,
			// which throws "timeout must be an integer". Build the SDK
			// opts so `timeout` is OMITTED unless the caller supplied a
			// real number. (Mirrors the same `typeof === 'number'` guard
			// in OpenAICompatibleAdapter.ts:96.)
			const sdkOpts: { signal?: AbortSignal; headers?: Record<string, string>; timeout?: number } =
				{}
			if (opts?.signal) sdkOpts.signal = opts.signal
			if (opts?.headers) sdkOpts.headers = opts.headers
			if (typeof opts?.timeout === 'number') sdkOpts.timeout = opts.timeout
			const { data, request_id } = await client.beta.messages
				.create(params as Parameters<typeof client.beta.messages.create>[0], sdkOpts)
				.withResponse()
			// data is the SDK's `Stream<BetaRawMessageStreamEvent>`: async
			// iterable + `controller: AbortController`. Forward both, plus
			// the SDK's request_id so claude.ts:2028 receives it.
			const stream = data as AsyncIterable<BetaRawMessageStreamEvent> & {
				controller?: AbortController
			}
			return {
				kind: 'events',
				events: stream,
				controller: stream.controller,
				requestId: request_id,
			}
		},
	}
}
