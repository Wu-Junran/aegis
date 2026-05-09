import { test, expect } from 'bun:test'
import { parseExportArgs } from '../../../src/commands/note/note.js'

test('parses path + defaults (strict default = redacted)', () => {
  expect(parseExportArgs('export ./out.md')).toEqual({
    target: './out.md', format: 'md', mode: 'redacted',
  })
})

test('parses --format md (explicit)', () => {
  expect(parseExportArgs('export ./out.md --format md')).toEqual({
    target: './out.md', format: 'md', mode: 'redacted',
  })
})

test('--format pdf parses successfully (M6)', () => {
  const out = parseExportArgs('export ./out.pdf --format pdf')
  expect(out.format).toBe('pdf')
})

test('--format md still parses successfully', () => {
  const out = parseExportArgs('export ./out.md --format md')
  expect(out.format).toBe('md')
})

test('--format with no value still rejects', () => {
  expect(() => parseExportArgs('export ./out.pdf --format')).toThrow()
})

test('unknown --format rejects', () => {
  expect(() => parseExportArgs('export ./out.pdf --format docx')).toThrow()
})

test('parses --full', () => {
  expect(parseExportArgs('export ./out.md --full')).toEqual({
    target: './out.md', format: 'md', mode: 'full',
  })
})

test('rejects missing target', () => {
  expect(() => parseExportArgs('export')).toThrow(/path/i)
})

test('rejects unknown flag', () => {
  expect(() => parseExportArgs('export ./x --weird')).toThrow(/unknown/i)
})

// [4.14 review P1] Without the missing-value branch, `--format` with no
// value would emit `Unknown format: undefined` — confusing for a clinician
// who simply forgot to type `md`. The named branch produces a useful error
// that points at the missing arg.
test('rejects --format with no value (was: "Unknown format: undefined")', () => {
  expect(() => parseExportArgs('export ./out.md --format')).toThrow(
    /missing value for --format/i,
  )
})
