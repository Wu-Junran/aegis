import { test, expect } from 'bun:test'
import { defaultAuditLogPath } from '../../../src/medical/runtime/auditPath.js'

test('builds <home>/.aegis/audit/<session>.jsonl', () => {
  expect(defaultAuditLogPath('abc-123', '/Users/me')).toBe(
    '/Users/me/.aegis/audit/abc-123.jsonl',
  )
})

test('rejects session ids that contain path separators', () => {
  expect(() => defaultAuditLogPath('a/b', '/Users/me')).toThrow(/session id/i)
})
