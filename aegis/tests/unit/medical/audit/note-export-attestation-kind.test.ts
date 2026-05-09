import { test, expect } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runNoteExportGate } from '../../../../src/medical/export/NoteExportGate.js'
import { openAuditLogger } from '../../../../src/medical/audit/AuditLogger.js'
import type { DeIdentifier } from '../../../../src/medical/deid/DeIdentifier.js'

function makeStubDeid(): DeIdentifier {
  return {
    redact: async (text: string) => ({
      redacted: text,
      mapping: { entries: {}, version: 'stub-1' },
    }),
    restore: async (text: string) => text,
  }
}

async function runExport(phiMode: 'strict' | 'research' | 'off'): Promise<unknown[]> {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-att-kind-'))
  const auditPath = join(dir, 'audit.jsonl')
  const target = join(dir, 'note.md')
  const logger = openAuditLogger(auditPath, phiMode)
  try {
    await runNoteExportGate(
      'A simple note body without PHI.',
      { target, format: 'md', mode: 'redacted' },
      {
        deid: makeStubDeid(),
        phiMode,
        logger,
        render: async (note) => note,
        prompt: async () => ({ accepted: true, attestationText: 'TEST' }),
      },
    )
  } finally {
    await logger.close()
  }
  return readFileSync(auditPath, 'utf-8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
}

test('strict mode export entries carry attestation_kind: clinical', async () => {
  const entries = await runExport('strict')
  const intent = entries.find((e: any) => e.type === 'note_export_intent') as any
  const completed = entries.find((e: any) => e.type === 'note_export_completed') as any
  expect(intent.attestation_kind).toBe('clinical')
  expect(completed.attestation_kind).toBe('clinical')
})

test('research mode export entries carry attestation_kind: research_use', async () => {
  const entries = await runExport('research')
  const intent = entries.find((e: any) => e.type === 'note_export_intent') as any
  const completed = entries.find((e: any) => e.type === 'note_export_completed') as any
  expect(intent.attestation_kind).toBe('research_use')
  expect(completed.attestation_kind).toBe('research_use')
})

test('off mode export entries carry attestation_kind: research_use', async () => {
  const entries = await runExport('off')
  const intent = entries.find((e: any) => e.type === 'note_export_intent') as any
  const completed = entries.find((e: any) => e.type === 'note_export_completed') as any
  expect(intent.attestation_kind).toBe('research_use')
  expect(completed.attestation_kind).toBe('research_use')
})

test('declined export entry carries attestation_kind matching mode', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-att-kind-decl-'))
  const auditPath = join(dir, 'audit.jsonl')
  const target = join(dir, 'note.md')
  const logger = openAuditLogger(auditPath, 'research')
  try {
    await expect(
      runNoteExportGate(
        'A simple note body.',
        { target, format: 'md', mode: 'redacted' },
        {
          deid: makeStubDeid(),
          phiMode: 'research',
          logger,
          render: async (note) => note,
          prompt: async () => ({ accepted: false, attestationText: '' }),
        },
      ),
    ).rejects.toThrow(/declined/)
  } finally {
    await logger.close()
  }
  const entries = readFileSync(auditPath, 'utf-8').trim().split('\n').map((l) => JSON.parse(l))
  const declined = entries.find((e: any) => e.type === 'note_export_declined') as any
  expect(declined.attestation_kind).toBe('research_use')
})
