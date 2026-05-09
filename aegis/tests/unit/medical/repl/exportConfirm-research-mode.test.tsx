import { test, expect } from 'bun:test'
import {
  getExportConfirmLines,
  resolveAttestationText,
  type ExportConfirmDisplayProps,
} from '../../../../src/medical/repl/ExportConfirm.js'

const baseDisplay: Omit<ExportConfirmDisplayProps, 'phiMode' | 'kind'> = {
  target: '/tmp/note.md',
  bytes: 1024,
  mode: 'redacted',
  phiEntityCounts: { PERSON: 2, DATE: 6 },
}

test('attestation prompt line in strict mode asks for clinical attestation', () => {
  const lines = getExportConfirmLines({
    ...baseDisplay,
    kind: 'attestation',
    phiMode: 'strict',
  })
  const promptLine = lines.find(l => l.kind === 'prompt')
  expect(promptLine?.text).toContain('Attest accuracy and proceed?')
})

test('attestation prompt line in research mode asks for non-clinical-use acknowledgment', () => {
  const lines = getExportConfirmLines({
    ...baseDisplay,
    kind: 'attestation',
    phiMode: 'research',
  })
  const promptLine = lines.find(l => l.kind === 'prompt')
  expect(promptLine?.text).toContain('Acknowledge research/operational draft')
  expect(promptLine?.text).not.toContain('Attest accuracy')
})

test('attestation prompt line in off mode mirrors research mode', () => {
  const lines = getExportConfirmLines({
    ...baseDisplay,
    kind: 'attestation',
    phiMode: 'off',
  })
  const promptLine = lines.find(l => l.kind === 'prompt')
  expect(promptLine?.text).toContain('Acknowledge research/operational draft')
})

test('phi-extra-confirm prompt is unchanged regardless of phiMode', () => {
  for (const phiMode of ['strict', 'research', 'off'] as const) {
    const lines = getExportConfirmLines({
      ...baseDisplay,
      kind: 'phi-extra-confirm',
      phiMode,
    })
    const promptLine = lines.find(l => l.kind === 'prompt')
    expect(promptLine?.text).toContain('Confirm intent to persist PHI?')
  }
})

test('resolveAttestationText returns clinical text in strict mode', () => {
  const text = resolveAttestationText('attestation', 'strict')
  expect(text).toContain('reviewed this note')
  expect(text).toContain('attest it is accurate')
})

test('resolveAttestationText returns research-use text in research mode', () => {
  const text = resolveAttestationText('attestation', 'research')
  expect(text).toContain('research/operational draft')
  expect(text).toContain('not a medical record')
})

test('resolveAttestationText returns research-use text in off mode', () => {
  const text = resolveAttestationText('attestation', 'off')
  expect(text).toContain('research/operational draft')
})

test('resolveAttestationText returns phi-confirm text for phi-extra-confirm regardless of mode', () => {
  for (const phiMode of ['strict', 'research', 'off'] as const) {
    const text = resolveAttestationText('phi-extra-confirm', phiMode)
    expect(text).toContain('persist un-redacted PHI')
  }
})
