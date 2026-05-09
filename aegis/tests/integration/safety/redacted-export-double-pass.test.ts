import { test, expect, afterEach } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runNoteExportGate } from '../../../src/medical/export/NoteExportGate.js'
import type { DeIdentifier } from '../../../src/medical/deid/DeIdentifier.js'

const tmps: string[] = []
afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true })
})

// Minimal regex-Presidio for the test (exact same engine for both passes).
function makeRegexDeid(): DeIdentifier {
  const PATTERNS: Array<{
    type: 'PERSON' | 'DATE' | 'MRN'
    re: RegExp
  }> = [
    { type: 'PERSON', re: /John Doe|Jane Roe/g },
    { type: 'DATE', re: /\d{4}-\d{2}-\d{2}/g },
    { type: 'MRN', re: /\b\d{8}\b/g },
  ]
  return {
    redact: async (text: string) => {
      const entries: Record<
        string,
        { type: 'PERSON' | 'DATE' | 'MRN'; original: string }
      > = {}
      let counter = 1
      let r = typeof text === 'string' ? text : ''
      for (const p of PATTERNS) {
        r = r.replace(p.re, (m) => {
          const k = `<${p.type}_${counter++}>`
          entries[k] = { type: p.type, original: m }
          return k
        })
      }
      return { redacted: r, mapping: { entries, version: 'regex-1' } }
    },
    restore: async (t: string) => t,
  }
}

test('/note export --redacted writes a file with zero PHI on a second pass', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-export-'))
  tmps.push(dir)
  const target = join(dir, 'note.md')
  const deid = makeRegexDeid()
  const note =
    'Subjective: Mr. John Doe (MRN 12345678) presented on 2026-04-22.'
  await runNoteExportGate(
    note,
    { target, format: 'md', mode: 'redacted' },
    {
      deid,
      phiMode: 'strict',
      logger: { append: async () => {}, close: async () => {} },
      render: async (s) => s,
      prompt: async () => ({ accepted: true, attestationText: 'I attest.' }),
    },
  )
  const body = readFileSync(target, 'utf-8')
  const verify = await deid.redact(body)
  expect(Object.keys(verify.mapping.entries)).toHaveLength(0)
})
