import { test, expect } from 'bun:test'
import { parseSectionDeltas, emptySectionState } from '../../../src/medical/agent/sectionParser.js'

test('full single-section emit', () => {
  const r = parseSectionDeltas(
    `<!-- aegis:section=subjective -->\nbody\n<!-- aegis:section=end -->`,
    emptySectionState(),
  )
  expect(r.value.filled_sections).toEqual({ subjective: 'body' })
  expect(r.value.free).toBeNull()
  expect(r.state.pending).toBe('')
})

test('multiple sections in one chunk', () => {
  const r = parseSectionDeltas(
    [
      `<!-- aegis:section=subjective -->\nA\n<!-- aegis:section=end -->`,
      `<!-- aegis:section=plan -->\nB\n<!-- aegis:section=end -->`,
    ].join('\n'),
    emptySectionState(),
  )
  expect(r.value.filled_sections).toEqual({ subjective: 'A', plan: 'B' })
})

test('partial open fence is buffered for the next chunk', () => {
  const a = parseSectionDeltas(`<!-- aegis:section=plan -->\npart`, emptySectionState())
  expect(a.value.filled_sections).toEqual({})
  expect(a.state.pending).toContain('aegis:section=plan')
  const b = parseSectionDeltas(`ial\n<!-- aegis:section=end -->`, a.state)
  expect(b.value.filled_sections).toEqual({ plan: 'partial' })
})

test('text outside fences accumulates into free', () => {
  const r = parseSectionDeltas(
    `Free prose here.\n<!-- aegis:section=plan -->\nbody\n<!-- aegis:section=end -->\nAnd more.`,
    emptySectionState(),
  )
  expect(r.value.filled_sections).toEqual({ plan: 'body' })
  expect(r.value.free).toBe('Free prose here.\nAnd more.')
})

test('unmatched end fence is appended to free as inert text', () => {
  const r = parseSectionDeltas(
    `<!-- aegis:section=end -->\nstray`,
    emptySectionState(),
  )
  expect(r.value.filled_sections).toEqual({})
  expect(r.value.free).toContain('stray')
})

test('split fence opener (<, <!, <!-) is buffered for next chunk (P2 fix)', () => {
  // Each three-character prefix of '<!--' should defer to the next chunk.
  const a1 = parseSectionDeltas('prefix text<', emptySectionState())
  expect(a1.state.pending).toBe('<')
  expect(a1.value.filled_sections).toEqual({})

  const a2 = parseSectionDeltas('prefix text<!', emptySectionState())
  expect(a2.state.pending).toBe('<!')

  const a3 = parseSectionDeltas('prefix text<!-', emptySectionState())
  expect(a3.state.pending).toBe('<!-')

  // Complete the fence in the next chunk.
  // a1.state.pending = '<'; prepend '!-- ' to form '<!-- aegis:section=plan -->'.
  const b = parseSectionDeltas(
    '!-- aegis:section=plan -->\nbody\n<!-- aegis:section=end -->',
    a1.state,
  )
  expect(b.value.filled_sections).toEqual({ plan: 'body' })
})
