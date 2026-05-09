import { test, expect } from 'bun:test'
import { getDefaultAppState } from '../../src/state/AppStateStore.js'

test('default AppState has medical slices zeroed', () => {
  const s = getDefaultAppState()
  expect(s.currentPatient).toBeNull()
  expect(s.currentTemplate).toBeNull()
  expect(s.auditLogPath).toBeNull()
})
