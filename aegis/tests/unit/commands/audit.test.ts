import { test, expect } from 'bun:test'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runAuditShow } from '../../../src/commands/audit/runAuditShow.js'

function fixture(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-audit-'))
  const path = join(dir, 'session.jsonl')
  writeFileSync(path, content)
  return path
}

test('refuses when auditLogPath is null', async () => {
  const r = await runAuditShow({ auditLogPath: null, args: 'show' })
  expect(r.ok).toBe(false)
})

test('formats one line per entry by default; tails last 50', async () => {
  const lines = Array.from({ length: 60 }, (_, i) =>
    JSON.stringify({ ts: '2026-05-06T00:00:00Z', type: 'llm_request', requestId: `r${i}`, mode: 'research' }),
  ).join('\n') + '\n'
  const path = fixture(lines)
  const r = await runAuditShow({ auditLogPath: path, args: 'show' })
  expect(r.ok).toBe(true)
  const out = r.message.split('\n').filter(Boolean)
  expect(out.length).toBe(50)
  expect(out[0]).toContain('r10') // 60 entries → tail of 50 starts at index 10
})

test('--full flag pretty-prints each entry', async () => {
  const lines = JSON.stringify({ ts: '2026-05-06T00:00:00Z', type: 'note_export_completed', requestId: 'r1', mode: 'research', target: '/tmp/x.md' }) + '\n'
  const path = fixture(lines)
  const r = await runAuditShow({ auditLogPath: path, args: 'show --full' })
  expect(r.ok).toBe(true)
  expect(r.message).toContain('"target": "/tmp/x.md"')
})

test('--tail N overrides default', async () => {
  const lines = Array.from({ length: 10 }, (_, i) =>
    JSON.stringify({ ts: '2026-05-06T00:00:00Z', type: 'x', requestId: `r${i}`, mode: 'research' }),
  ).join('\n') + '\n'
  const path = fixture(lines)
  const r = await runAuditShow({ auditLogPath: path, args: 'show --tail 3' })
  expect(r.ok).toBe(true)
  expect(r.message.split('\n').filter(Boolean).length).toBe(3)
})

test('skips malformed JSON lines without throwing', async () => {
  const path = fixture(
    [
      '{not-json',
      JSON.stringify({ ts: '2026-05-06T00:00:00Z', type: 'good', requestId: 'r1', mode: 'research' }),
    ].join('\n') + '\n',
  )
  const r = await runAuditShow({ auditLogPath: path, args: 'show' })
  expect(r.ok).toBe(true)
  expect(r.message).toContain('good')
})
