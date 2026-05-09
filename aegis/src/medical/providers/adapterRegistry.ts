import type Anthropic from '@anthropic-ai/sdk'
import { createAnthropicAdapter } from './AnthropicAdapter.js'
import { createGLMAdapter } from './GLMAdapter.js'
import { createMinimaxAdapter } from './MinimaxAdapter.js'
import { createOpenAICompatibleAdapter } from './OpenAICompatibleAdapter.js'
import type { ProviderAdapter, SessionProviderId } from './ProviderAdapter.js'

const cache: Map<SessionProviderId, ProviderAdapter> = new Map()
const overrides: Map<SessionProviderId, ProviderAdapter> = new Map()

type AdapterInterceptor = (
	id: SessionProviderId,
	anthropicClient: Anthropic | undefined,
	resolveReal: () => ProviderAdapter,
) => ProviderAdapter

let _interceptor: AdapterInterceptor | null = null

function buildRealAdapter(id: SessionProviderId, anthropicClient?: Anthropic): ProviderAdapter {
	switch (id) {
		case 'anthropic':
			if (!anthropicClient) throw new Error('AnthropicAdapter requires an Anthropic client')
			return createAnthropicAdapter(anthropicClient)
		case 'openai':
			return createOpenAICompatibleAdapter('openai')
		case 'openai-compatible':
			return createOpenAICompatibleAdapter('openai-compatible')
		case 'glm':
			return createGLMAdapter()
		case 'minimax':
			return createMinimaxAdapter()
		default: {
			const _exhaustive: never = id
			throw new Error(`Unknown provider id: ${String(_exhaustive)}`)
		}
	}
}

export function getAdapter(id: SessionProviderId, anthropicClient?: Anthropic): ProviderAdapter {
	const overridden = overrides.get(id)
	if (overridden) return overridden
	const cached = cache.get(id)
	if (cached) return cached
	if (_interceptor) {
		const resolveReal = (): ProviderAdapter => buildRealAdapter(id, anthropicClient)
		const intercepted = _interceptor(id, anthropicClient, resolveReal)
		cache.set(id, intercepted)
		return intercepted
	}
	const adapter = buildRealAdapter(id, anthropicClient)
	cache.set(id, adapter)
	return adapter
}

export function __clearAdapterCacheForTest(): void {
	cache.clear()
}

/**
 * Test-only override. Inserts `adapter` into a separate overrides map that
 * `getAdapter` checks BEFORE the cache. Production code must never call
 * this; the lint-equivalent test (Decision #1) does not gate it because
 * the underscore prefix is the convention used elsewhere in this codebase
 * (`__markRedactedForTest`, `__setKeytarForTest`, …) for test seams.
 */
export function __setAdapterForTest(id: SessionProviderId, adapter: ProviderAdapter): void {
	overrides.set(id, adapter)
}

export function __clearAdapterOverrideForTest(): void {
	overrides.clear()
}

/**
 * TEST-ONLY. Installs an interceptor that runs INSIDE `getAdapter` for
 * every id. The interceptor receives the call-site `anthropicClient` and
 * a `resolveReal` thunk that constructs the real adapter only if invoked.
 * Pass `null` to clear; also clears the cache.
 */
export function __setAdapterInterceptorForTest(intercept: AdapterInterceptor | null): void {
	_interceptor = intercept
	cache.clear()
}
