import { test, expect } from 'bun:test'
import { getDefaultAppState } from '../../../src/state/AppStateStore.js'
import {
  createCurrentNoteSlice,
  mergeNote,
  emptyNote,
  noteToText,
  isEmptyNote,
  noteToFencedString,
} from '../../../src/medical/state/currentNote.js'

test('default currentNote is empty value (not null)', () => {
  const s = getDefaultAppState()
  expect(s.currentNote).toEqual(emptyNote())
  expect(s.currentNote.free).toBeNull()
  expect(s.currentNote.filled_sections).toEqual({})
})

test('createCurrentNoteSlice returns the same default', () => {
  expect(createCurrentNoteSlice().currentNote).toEqual(emptyNote())
})

test('mergeNote concatenates free text and merges sections', () => {
  const a = { free: 'one', filled_sections: { subjective: 'A' } }
  const b = { free: 'two', filled_sections: { objective: 'B' } }
  const merged = mergeNote(a, b)
  expect(merged.free).toBe('one\ntwo')
  expect(merged.filled_sections).toEqual({ subjective: 'A', objective: 'B' })
})

test('mergeNote replaces existing section body when same id appears', () => {
  const a = { free: null, filled_sections: { subjective: 'A1' } }
  const b = { free: null, filled_sections: { subjective: 'A2' } }
  expect(mergeNote(a, b).filled_sections).toEqual({ subjective: 'A2' })
})

test('noteToText prefers free over filled_sections (P1#1)', () => {
  expect(noteToText({ free: 'plain body', filled_sections: { plan: 'P' } }))
    .toBe('plain body')
})

test('noteToText concatenates filled_sections in insertion order when free is null (P1#1)', () => {
  expect(
    noteToText({ free: null, filled_sections: { subjective: 'S body', plan: 'P body' } }),
  ).toBe('## subjective\nS body\n\n## plan\nP body')
})

test('noteToText returns null when both branches are empty (P1#1)', () => {
  expect(noteToText(emptyNote())).toBeNull()
  expect(noteToText({ free: '', filled_sections: { plan: '' } })).toBeNull()
})

test('isEmptyNote is true for default + false once free or any section is populated (P1#1)', () => {
  expect(isEmptyNote(emptyNote())).toBe(true)
  expect(isEmptyNote({ free: '', filled_sections: { plan: '' } })).toBe(true)
  expect(isEmptyNote({ free: 'x', filled_sections: {} })).toBe(false)
  expect(isEmptyNote({ free: null, filled_sections: { plan: 'P' } })).toBe(false)
})

test('noteToFencedString reconstructs fences for validator input', () => {
  const v = {
    free: 'Patient stable.',
    filled_sections: { subjective: 'A', plan: 'P' },
  }
  const out = noteToFencedString(v)
  expect(out).toContain('Patient stable.')
  expect(out).toContain('<!-- aegis:section=subjective -->\nA\n<!-- aegis:section=end -->')
  expect(out).toContain('<!-- aegis:section=plan -->\nP\n<!-- aegis:section=end -->')
})

test('noteToFencedString handles empty note', () => {
  expect(noteToFencedString({ free: null, filled_sections: {} })).toBe('')
})

test('noteToFencedString handles free-only note', () => {
  expect(noteToFencedString({ free: 'just prose', filled_sections: {} })).toBe('just prose')
})
