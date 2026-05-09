import * as React from 'react'
import { test, expect } from 'bun:test'
import { ValidatorBanner } from '../../../src/medical/repl/ValidatorBanner.js'
import { render } from '../../setup/inkTestingShim.js'

test('renders one line per warning when slice is non-empty', () => {
  const r = render(
    <ValidatorBanner
      warnings={[
        { check: 'dose', severity: 'warn', message: 'overdose' },
        { check: 'labs', severity: 'warn', message: 'fabricated' },
      ]}
    />,
  )
  const text = (r.lastFrame() ?? '')
  expect(text).toContain('dose')
  expect(text).toContain('overdose')
  expect(text).toContain('labs')
})

test('renders nothing when slice is empty', () => {
  const r = render(<ValidatorBanner warnings={[]} />)
  const text = (r.lastFrame() ?? '')
  expect(text.trim()).toBe('')
})
