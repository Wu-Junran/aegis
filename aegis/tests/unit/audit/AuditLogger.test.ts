import { test, expect, afterEach } from 'bun:test'
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { openAuditLogger } from '../../../src/medical/audit/AuditLogger.js'

const tmps: string[] = []
afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true })
})

function newTmpFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-audit-'))
  tmps.push(dir)
  return join(dir, 'session.jsonl')
}

test('append writes JSONL line-by-line', async () => {
  const path = newTmpFile()
  const log = openAuditLogger(path, 'strict')
  await log.append({
    ts: '2026-04-23T00:00:00Z',
    type: 'llm_request',
    requestId: 'req-1',
    mode: 'strict',
    redactedPayloadHash: 'sha256:abc',
  })
  await log.append({
    ts: '2026-04-23T00:00:01Z',
    type: 'llm_response',
    requestId: 'req-1',
    mode: 'strict',
  })
  await log.close()

  const lines = readFileSync(path, 'utf-8').trim().split('\n')
  expect(lines).toHaveLength(2)
  expect(JSON.parse(lines[0]!).type).toBe('llm_request')
  expect(JSON.parse(lines[1]!).type).toBe('llm_response')
})

test('appends preserve ordering across concurrent calls', async () => {
  const path = newTmpFile()
  const log = openAuditLogger(path, 'strict')
  await Promise.all(
    Array.from({ length: 10 }).map((_, i) =>
      log.append({
        ts: `2026-04-23T00:00:${String(i).padStart(2, '0')}Z`,
        type: 'noise',
        requestId: `r-${i}`,
        mode: 'strict',
        seq: i,
      }),
    ),
  )
  await log.close()
  const lines = readFileSync(path, 'utf-8').trim().split('\n')
  const seqs = lines.map(l => JSON.parse(l).seq)
  expect(seqs).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('newly-created audit file is mode 0600', async () => {
  const path = newTmpFile()
  const log = openAuditLogger(path, 'strict')
  await log.append({
    ts: '2026-04-23T00:00:00Z',
    type: 'llm_request',
    requestId: 'm-1',
    mode: 'strict',
  })
  await log.close()
  expect(statSync(path).mode & 0o777).toBe(0o600)
})

test('pre-existing permissive audit file is forced to 0600 on open (regression: openSync mode is create-only)', async () => {
  // Reproduce a session resuming against an audit log that was chmod'd
  // permissive — e.g., a user snapshot restored under a different umask, or
  // a manual edit that left it 0644. `openSync(path, 'a', 0o600)` would
  // silently keep the existing mode; the logger must `fchmodSync` to fix.
  const path = newTmpFile()
  // Pre-create the file with permissive perms BEFORE the logger opens it.
  mkdirSync(dirname(path), { recursive: true })
  const init = openSync(path, 'a', 0o644)
  writeSync(init, '{"ts":"2026-04-22T00:00:00Z","type":"prior","requestId":"p","mode":"strict"}\n')
  closeSync(init)
  expect(statSync(path).mode & 0o777).toBe(0o644) // pre-condition

  const log = openAuditLogger(path, 'strict')
  await log.append({
    ts: '2026-04-23T00:00:00Z',
    type: 'llm_request',
    requestId: 'r',
    mode: 'strict',
  })
  await log.close()
  // Logger must have tightened the perms on open.
  expect(statSync(path).mode & 0o777).toBe(0o600)
})
