import { test, expect, beforeEach } from 'bun:test'
import { call as phiModeCall } from '../../../src/commands/phi-mode/phi-mode.js'
import { __resetPhiModeForTests, setPhiModeFromCli } from '../../../src/medical/runtime/phiMode.js'

beforeEach(() => __resetPhiModeForTests())

test('show prints current mode', async () => {
  setPhiModeFromCli({ mode: 'research', allowOff: false })
  let out: string | undefined
  await phiModeCall(
    (msg) => { out = msg },
    {} as any,
    'show',
  )
  expect(out).toMatch(/research/i)
})

test('rejects set off (must be a launch flag)', async () => {
  let out: string | undefined
  await phiModeCall((msg) => { out = msg }, {} as any, 'set off')
  expect(out).toMatch(/cannot.*off.*REPL|--phi-mode/i)
})
