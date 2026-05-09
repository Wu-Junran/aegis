import { test, expect, afterEach } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runExportFlow } from '../../../src/commands/note/runExportFlow.js'
import {
  __resetMedicalRuntimeForTests,
  type MedicalRuntime,
} from '../../../src/medical/runtime/medicalRuntime.js'
import {
  __resetPhiModeForTests,
  setPhiModeFromCli,
} from '../../../src/medical/runtime/phiMode.js'
import type {
  AuditLogger,
  PhiMode,
} from '../../../src/medical/audit/AuditLogger.js'
import type { DeIdentifier } from '../../../src/medical/deid/DeIdentifier.js'
import type { PhiMapping } from '../../../src/medical/deid/DeIdentifier.js'
import { emptyNote } from '../../../src/medical/state/currentNote.js'

const tmps: string[] = []
afterEach(() => {
  __resetMedicalRuntimeForTests()
  __resetPhiModeForTests()
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true })
})

function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'aegis-flow-'))
  tmps.push(d)
  return d
}

function fakeRuntime(): MedicalRuntime {
  return {
    getState: () => ({
      currentPatient: null,
      currentTemplate: null,
      auditLogPath: '/dev/null',
    }) as never,
    setState: (_u) => {},
    getMcpClients: () => [],
    sessionId: 'test-session',
  }
}

function recordingLogger() {
  const entries: any[] = []
  return {
    entries,
    factory: (_p: string, _mode: PhiMode): AuditLogger => ({
      append: async (e) => { entries.push(e) },
      close: async () => {},
    }),
  }
}

const passDeid: DeIdentifier = {
  redact: async (text: string) => {
    if (!text.includes('John Doe')) {
      return { redacted: text, mapping: { entries: {}, version: 'v' } }
    }
    return {
      redacted: text.replaceAll('John Doe', '<PERSON_1>'),
      mapping: {
        entries: { '<PERSON_1>': { type: 'PERSON', original: 'John Doe' } },
        version: 'v',
      },
    }
  },
  restore: async (t: string, _mapping: PhiMapping) => t.replaceAll('<PERSON_1>', 'John Doe'),
}

test('refuses when currentNote is null (does not crash, returns refusal message)', async () => {
  setPhiModeFromCli({ mode: 'research', allowOff: false })
  const r = await runExportFlow({
    note: emptyNote(),
    auditPath: '/tmp/x.jsonl',
    runtime: fakeRuntime(),
    args: { target: '/tmp/x.md', format: 'md', mode: 'full' },
    prompt: async () => { throw new Error('prompt should not be called') },
  })
  expect(r.ok).toBe(false)
  expect(r.message).toMatch(/no drafted note/i)
})

test('refuses when auditLogPath is null', async () => {
  setPhiModeFromCli({ mode: 'research', allowOff: false })
  const r = await runExportFlow({
    note: { free: 'hello', filled_sections: {} },
    auditPath: null,
    runtime: fakeRuntime(),
    args: { target: '/tmp/x.md', format: 'md', mode: 'full' },
    prompt: async () => { throw new Error('prompt should not be called') },
  })
  expect(r.ok).toBe(false)
  expect(r.message).toMatch(/auditLogPath/i)
})

test('happy path (research+full, deidOverride): writes file, returns success, prompt receives summary', async () => {
  setPhiModeFromCli({ mode: 'research', allowOff: false })
  const dir = tmpDir()
  const target = join(dir, 'out.md')
  const audit = join(dir, 'audit.jsonl')
  const log = recordingLogger()
  let summarySeen: any = null

  const r = await runExportFlow({
    note: { free: 'Patient John Doe seen.', filled_sections: {} },
    auditPath: audit,
    runtime: fakeRuntime(),
    args: { target, format: 'md', mode: 'full' },
    prompt: async (_kind, summary) => {
      summarySeen = summary
      return { accepted: true, attestationText: 'ok' }
    },
    loggerFactory: log.factory,
    deidOverride: passDeid,
  })

  expect(r.ok).toBe(true)
  expect(r.message).toMatch(new RegExp(`exported to ${target.replaceAll('/', '\\/')}`))
  expect(readFileSync(target, 'utf-8')).toBe('Patient John Doe seen.')
  expect(summarySeen.target).toBe(target)
  expect(summarySeen.mode).toBe('full')
  expect(summarySeen.phiMode).toBe('research')
  expect(summarySeen.phiEntityCounts.PERSON).toBe(1)
  expect(log.entries.find((e) => e.type === 'note_export_intent')).toBeDefined()
  expect(log.entries.find((e) => e.type === 'note_export_completed')).toBeDefined()
})

test('strict + --redacted (deidOverride): verification scan succeeds, body has placeholder', async () => {
  setPhiModeFromCli({ mode: 'strict', allowOff: false })
  const dir = tmpDir()
  const target = join(dir, 'out.md')
  const audit = join(dir, 'audit.jsonl')
  const log = recordingLogger()

  const r = await runExportFlow({
    note: { free: 'Patient John Doe seen.', filled_sections: {} },
    auditPath: audit,
    runtime: fakeRuntime(),
    args: { target, format: 'md', mode: 'redacted' },
    prompt: async () => ({ accepted: true, attestationText: 'I attest.' }),
    loggerFactory: log.factory,
    deidOverride: passDeid,
  })

  expect(r.ok).toBe(true)
  const body = readFileSync(target, 'utf-8')
  expect(body).not.toContain('John Doe')
  expect(body).toContain('<PERSON_1>')
})

test('declined sign-off: returns failure, no file written, declined entry logged', async () => {
  setPhiModeFromCli({ mode: 'research', allowOff: false })
  const dir = tmpDir()
  const target = join(dir, 'out.md')
  const audit = join(dir, 'audit.jsonl')
  const log = recordingLogger()

  const r = await runExportFlow({
    note: { free: 'Patient.', filled_sections: {} },
    auditPath: audit,
    runtime: fakeRuntime(),
    args: { target, format: 'md', mode: 'full' },
    prompt: async () => ({ accepted: false, attestationText: '' }),
    loggerFactory: log.factory,
    deidOverride: passDeid,
  })

  expect(r.ok).toBe(false)
  expect(r.message).toMatch(/declined/i)
  expect(() => readFileSync(target, 'utf-8')).toThrow()
  expect(log.entries.find((e) => e.type === 'note_export_declined')).toBeDefined()
  expect(log.entries.find((e) => e.type === 'note_export_completed')).toBeUndefined()
})
