import { test, expect, beforeEach } from 'bun:test'
import {
	getAdapter,
	__clearAdapterCacheForTest,
	__setAdapterInterceptorForTest,
} from '../../../../src/medical/providers/adapterRegistry.js'

beforeEach(__clearAdapterCacheForTest)

test('getAdapter returns same instance on repeat calls (memoized)', () => {
	const a = getAdapter('openai')
	const b = getAdapter('openai')
	expect(a).toBe(b)
})

test('unknown id throws', () => {
	expect(() => getAdapter('unknown' as any)).toThrow()
})

test('anthropic adapter requires a client', () => {
	expect(() => getAdapter('anthropic')).toThrow(/Anthropic client/)
})

test('interceptor receives id + client + resolveReal thunk and bypasses real adapter when not invoked (P1#1)', () => {
	let calls = 0
	const stubAdapter = { id: 'anthropic', displayName: 'stub', dispatch: async () => ({ kind: 'message', message: {} as any }) }
	__setAdapterInterceptorForTest((id, client, resolveReal) => {
		calls++
		expect(id).toBe('anthropic')
		expect(client).toBeUndefined()
		return stubAdapter as any
	})
	const out = getAdapter('anthropic')
	expect(out).toBe(stubAdapter)
	expect(calls).toBe(1)
	__setAdapterInterceptorForTest(null)
})
