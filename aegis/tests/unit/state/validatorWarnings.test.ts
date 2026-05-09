import { test, expect } from 'bun:test'
import { getDefaultAppState } from '../../../src/state/AppStateStore.js'
import {
  createValidatorWarningsSlice,
  type ValidatorWarning,
} from '../../../src/medical/state/validatorWarnings.js'

test('default validatorWarnings is empty array', () => {
  const s = getDefaultAppState()
  expect(s.validatorWarnings).toEqual([])
})

test('createValidatorWarningsSlice exports the same default', () => {
  expect(createValidatorWarningsSlice().validatorWarnings).toEqual([])
})

test('ValidatorWarning shape matches Python tool', () => {
  const w: ValidatorWarning = {
    check: 'dose',
    severity: 'warn',
    message: 'msg',
    evidence: { drug: 'Lisinopril' },
  }
  expect(w.check).toBe('dose')
})
