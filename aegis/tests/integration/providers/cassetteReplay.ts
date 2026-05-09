import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `response` is either:
 *   - a JSON object — the OpenAI/GLM/Minimax HTTP response body, or
 *   - an array of raw Anthropic stream events (message_start, content_block_*,
 *     message_delta, message_stop) — for the Anthropic adapter pass-through.
 * `providerOverride` lets a cassette pin a specific baseURL/modelId
 * (used by openai-compatible to exercise the configurable path).
 */
export type Cassette = {
	request: unknown
	response: unknown
	providerOverride?: { baseURL?: string; modelId?: string }
}

export function loadCassette(name: string): Cassette {
	const path = join(__dirname, '..', '..', 'fixtures', 'providers', name)
	return JSON.parse(readFileSync(path, 'utf8')) as Cassette
}

export type CapturedCall = {
	url: string
	method: string
	body: unknown // parsed JSON body if Content-Type is JSON, else the raw string
	headers: Headers
}

/**
 * Returns `{ stub, captured }`. `stub` is installable as `globalThis.fetch`;
 * `captured` is the array of every call the adapter under test made — the
 * matrix asserts URL/body/model/tools against `cassette.request` and
 * `cassette.providerOverride` so an adapter that ignores the configured
 * baseURL or drops `tools` is caught. A bare always-returns-cassette stub
 * (the earlier draft) cannot detect any of those failure modes — every
 * request looks the same to it.
 */
export function makeFetchStub(cassette: Cassette): { stub: typeof fetch; captured: CapturedCall[] } {
	const captured: CapturedCall[] = []
	// HTTP-shaped cassettes only — Anthropic uses the SDK Stream path.
	const stub: typeof fetch = async (input, init) => {
		const url = typeof input === 'string' ? input : (input as URL | Request).toString()
		const method = (init?.method ?? 'GET').toUpperCase()
		const headers = new Headers(init?.headers ?? {})
		const rawBody = init?.body
		let body: unknown = rawBody
		if (typeof rawBody === 'string' && headers.get('content-type')?.includes('application/json')) {
			try {
				body = JSON.parse(rawBody)
			} catch {
				/* leave as string */
			}
		}
		captured.push({ url, method, body, headers })
		return new Response(JSON.stringify(cassette.response), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		})
	}
	return { stub, captured }
}

/**
 * For the Anthropic adapter test path: cassettes whose `response` is an
 * array of raw stream events become the async iterable that the SDK's
 * `withResponse().data` would yield. Mints a fresh AbortController so the
 * shape matches the real `Stream<...>` and `redactedSend` can forward it.
 */
export function anthropicStreamFromCassette(
	cassette: Cassette,
): AsyncIterable<unknown> & { controller: AbortController } {
	if (!Array.isArray(cassette.response)) {
		throw new Error('anthropicStreamFromCassette requires response: <array of events>')
	}
	const events = cassette.response
	const controller = new AbortController()
	const iterable: AsyncIterable<unknown> & { controller: AbortController } = {
		controller,
		async *[Symbol.asyncIterator]() {
			for (const e of events) yield e
		},
	}
	return iterable
}
