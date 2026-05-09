import { test, expect } from 'bun:test'
import { getDefaultAppState } from '../../src/state/AppStateStore.js'

test('default AppState has M4 medical slices', () => {
  const s = getDefaultAppState()
  // currentNote widened from `string | null` to `CurrentNoteValue` in Task 6.9
  expect(s.currentNote).toEqual({ free: null, filled_sections: {} })
  expect(s.phiMode).toBe('strict')
})
