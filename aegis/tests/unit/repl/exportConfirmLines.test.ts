import { test, expect } from 'bun:test'
import { getExportConfirmLines, buildExportConfirmLines } from '../../../src/medical/repl/ExportConfirm.js'

function joinText(
  lines: ReturnType<typeof getExportConfirmLines>,
): string {
  return lines.map((l) => l.text).join('\n')
}

test('attestation kind renders target, bytes, mode, and PHI counts', () => {
  const lines = getExportConfirmLines({
    kind: 'attestation',
    target: '/tmp/note.md',
    bytes: 1234,
    mode: 'full',
    phiMode: 'strict',
    phiEntityCounts: { PERSON: 2, DATE: 1 },
  })
  const out = joinText(lines)
  expect(out).toContain('/tmp/note.md')
  expect(out).toContain('1234 bytes')
  expect(out).toContain('Mode: full')
  expect(out).toContain('PERSON×2')
  expect(out).toContain('DATE×1')
})

test('phi-extra-confirm kind ALSO renders target, bytes, mode, and PHI counts (regression: was generic-warning-only)', () => {
  const lines = getExportConfirmLines({
    kind: 'phi-extra-confirm',
    target: '/tmp/strict-full.md',
    bytes: 2048,
    mode: 'full',
    phiMode: 'strict',
    phiEntityCounts: { PERSON: 3, MRN: 1, DATE: 2 },
  })
  const out = joinText(lines)
  expect(out).toContain('/tmp/strict-full.md')
  expect(out).toContain('2048 bytes')
  expect(out).toContain('Mode: full')
  expect(out).toContain('PERSON×3')
  expect(out).toContain('MRN×1')
  expect(out).toContain('DATE×2')
  expect(out).toContain('6 PHI entities un-redacted')
  expect(out.toLowerCase()).toContain('strict mode')
})

test('phi-extra-confirm with single entity uses singular noun', () => {
  const lines = getExportConfirmLines({
    kind: 'phi-extra-confirm',
    target: '/tmp/x.md',
    bytes: 50,
    mode: 'full',
    phiMode: 'strict',
    phiEntityCounts: { PERSON: 1 },
  })
  expect(joinText(lines)).toContain('1 PHI entity un-redacted')
})

test('attestation with empty counts renders "none detected"', () => {
  const lines = getExportConfirmLines({
    kind: 'attestation',
    target: '/tmp/x.md',
    bytes: 1,
    mode: 'redacted',
    phiMode: 'strict',
    phiEntityCounts: {},
  })
  expect(joinText(lines)).toContain('none detected')
})

// [4.14 review P1] These two tests pin the tag *sequence* for each kind. The
// React component renders bold/red-bold/plain by tag, so a future re-order or
// insert in either kind's line list would silently mis-render the dialog
// (e.g., the wrong line getting red-bold in the strict-full prompt) without
// breaking any of the substring-presence tests above. Tag sequence is the
// invariant the renderer relies on; pin it here.
test('attestation tag sequence: header → 3×plain → prompt (regression: brittle index-based render)', () => {
  const lines = getExportConfirmLines({
    kind: 'attestation',
    target: '/tmp/x.md',
    bytes: 1,
    mode: 'redacted',
    phiMode: 'strict',
    phiEntityCounts: {},
  })
  expect(lines.map((l) => l.kind)).toEqual([
    'header',
    'plain',
    'plain',
    'plain',
    'prompt',
  ])
})

test('phi-extra-confirm tag sequence: headerWarn → 2×plain → warn → plain → prompt (the warn tag is the un-redacted-count line)', () => {
  const lines = getExportConfirmLines({
    kind: 'phi-extra-confirm',
    target: '/tmp/x.md',
    bytes: 1,
    mode: 'full',
    phiMode: 'strict',
    phiEntityCounts: { PERSON: 1 },
  })
  expect(lines.map((l) => l.kind)).toEqual([
    'headerWarn',
    'plain',
    'plain',
    'warn',
    'plain',
    'prompt',
  ])
  // The warn-tagged line MUST be the un-redacted-count headline (not, say,
  // the size or by-type line). Pin which line carries the emphasis.
  expect(lines.find((l) => l.kind === 'warn')?.text).toMatch(
    /About to persist .* un-redacted/,
  )
})

test('renders validator block when warnings present', () => {
  const lines = buildExportConfirmLines({
    target: '/tmp/x.md',
    bytes: 100,
    mode: 'redacted',
    phiMode: 'research',
    phiEntityCounts: {},
    validatorWarnings: {
      count: 2,
      tail: [
        { check: 'dose', severity: 'warn', message: 'overdose detected' },
        { check: 'sections', severity: 'warn', message: 'Plan empty' },
      ],
    },
  })
  expect(lines.some(l => l.includes('Validator (non-blocking)'))).toBe(true)
  expect(lines.some(l => l.includes('overdose detected'))).toBe(true)
  expect(lines.some(l => l.includes('2'))).toBe(true)
})

test('omits validator block when warnings empty', () => {
  const lines = buildExportConfirmLines({
    target: '/tmp/x.md',
    bytes: 100,
    mode: 'redacted',
    phiMode: 'research',
    phiEntityCounts: {},
    validatorWarnings: { count: 0, tail: [] },
  })
  expect(lines.some(l => l.toLowerCase().includes('validator'))).toBe(false)
})
