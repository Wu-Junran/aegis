import { test, expect } from 'bun:test'
import {
  entityCountsFromMapping,
  entityHashesFromMapping,
  sha256Hex,
} from '../../../src/medical/audit/redaction.js'

test('sha256Hex matches the spec example shape', () => {
  expect(sha256Hex('hello')).toMatch(/^sha256:[0-9a-f]{64}$/)
})

test('entityCountsFromMapping counts by type', () => {
  const counts = entityCountsFromMapping({
    entries: {
      '<PERSON_1>': { type: 'PERSON', original: 'A' },
      '<PERSON_2>': { type: 'PERSON', original: 'B' },
      '<MRN_1>': { type: 'MRN', original: '12345' },
    },
    version: 'v',
  })
  expect(counts).toEqual({ PERSON: 2, MRN: 1 })
})

test('entityHashesFromMapping returns sha256 of each original', () => {
  const hashes = entityHashesFromMapping({
    entries: {
      '<PERSON_1>': { type: 'PERSON', original: 'A' },
    },
    version: 'v',
  })
  expect(hashes).toHaveLength(1)
  expect(hashes[0]).toMatch(/^sha256:[0-9a-f]{64}$/)
})
