import { test, expect } from 'bun:test'
import { canonicalizeRequest, requestHash } from '../../lib/canonicalRequest.js'

test('hashes equal for same content with reordered keys', () => {
  const a = { model: 'm', system: 's', messages: [{ role: 'user', content: 'hi' }] }
  const b = { messages: [{ content: 'hi', role: 'user' }], system: 's', model: 'm' }
  expect(requestHash(a)).toBe(requestHash(b))
})

test('hashes equal under whitespace normalization in text content', () => {
  const a = { messages: [{ role: 'user', content: 'one  two\nthree' }] }
  const b = { messages: [{ role: 'user', content: 'one two three' }] }
  expect(requestHash(a)).toBe(requestHash(b))
})

test('hashes ignore stripped fields', () => {
  const a = { model: 'm', metadata: { user_id: 'a' }, messages: [] }
  const b = { model: 'm', metadata: { user_id: 'b' }, messages: [] }
  expect(requestHash(a)).toBe(requestHash(b))
})

test('canonicalize preserves message order', () => {
  const a = { messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }] }
  const b = { messages: [{ role: 'user', content: 'b' }, { role: 'user', content: 'a' }] }
  expect(requestHash(a)).not.toBe(requestHash(b))
})
