import { test, expect, beforeEach, afterEach } from 'bun:test'
import {
  __resetPhiModeForTests,
  getPhiMode,
  isOffAllowed,
  setPhiModeFromCli,
} from '../../../src/medical/runtime/phiMode.js'
import { isEssentialTrafficOnly } from '../../../src/utils/privacyLevel.js'

const ENV_GATE = 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'
let savedEnvGate: string | undefined

beforeEach(() => {
  __resetPhiModeForTests()
  savedEnvGate = process.env[ENV_GATE]
  delete process.env[ENV_GATE]
})

afterEach(() => {
  __resetPhiModeForTests()
  if (savedEnvGate === undefined) delete process.env[ENV_GATE]
  else process.env[ENV_GATE] = savedEnvGate
})

test('default mode is strict before CLI parsing', () => {
  expect(getPhiMode()).toBe('strict')
  expect(isOffAllowed()).toBe(false)
})

test('setPhiModeFromCli accepts strict and research', () => {
  setPhiModeFromCli({ mode: 'research', allowOff: false })
  expect(getPhiMode()).toBe('research')
})

test('off mode requires --allow-phi-off', () => {
  expect(() =>
    setPhiModeFromCli({ mode: 'off', allowOff: false }),
  ).toThrow(/--allow-phi-off/)
})

test('off mode succeeds with --allow-phi-off', () => {
  setPhiModeFromCli({ mode: 'off', allowOff: true })
  expect(getPhiMode()).toBe('off')
  expect(isOffAllowed()).toBe(true)
})

test('setPhiModeFromCli is one-shot (idempotent re-call rejected)', () => {
  setPhiModeFromCli({ mode: 'strict', allowOff: false })
  expect(() =>
    setPhiModeFromCli({ mode: 'research', allowOff: false }),
  ).toThrow(/already set/)
})

// ───────────────────────────────────────────────────────────────────────
// Aegis network policy: medical mode default-disables nonessential
// traffic. Without this gate, startup hangs in offline / non-Anthropic
// deployments (Grove qualifier probe to api.anthropic.com without
// timeout — see src/services/api/grove.ts). The contract is:
//
//  • `strict` and `research` default-set
//    `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` so
//    `isEssentialTrafficOnly()` returns true and every "phone home"
//    callsite short-circuits.
//  • `off` is the explicit upstream-Claude-Code escape hatch and does
//    NOT touch the env var — incoming behavior preserved.
//  • An operator who pre-sets the env var (truthy OR explicit empty
//    "I want nonessential traffic ON in medical mode") wins; aegis
//    does not clobber explicit operator values.
//  • The test reset undoes ONLY env-vars aegis itself set, so a stray
//    test-time mutation can't leak into other tests.
// ───────────────────────────────────────────────────────────────────────

test('strict mode default-sets CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 (medical-mode network policy)', () => {
  expect(process.env[ENV_GATE]).toBeUndefined()
  setPhiModeFromCli({ mode: 'strict', allowOff: false })
  expect(process.env[ENV_GATE]).toBe('1')
  expect(isEssentialTrafficOnly()).toBe(true)
})

test('research mode default-sets the same env gate', () => {
  expect(process.env[ENV_GATE]).toBeUndefined()
  setPhiModeFromCli({ mode: 'research', allowOff: false })
  expect(process.env[ENV_GATE]).toBe('1')
  expect(isEssentialTrafficOnly()).toBe(true)
})

test('off mode does NOT touch the env gate (preserves upstream Claude Code behavior)', () => {
  expect(process.env[ENV_GATE]).toBeUndefined()
  setPhiModeFromCli({ mode: 'off', allowOff: true })
  expect(process.env[ENV_GATE]).toBeUndefined()
  expect(isEssentialTrafficOnly()).toBe(false)
})

test('explicit operator override is preserved (truthy)', () => {
  // Operator deliberately set the gate before launching — aegis must
  // not overwrite. Use a sentinel value so we can prove the value is
  // exactly what the operator put there (not aegis's own '1').
  process.env[ENV_GATE] = 'operator-truthy'
  setPhiModeFromCli({ mode: 'strict', allowOff: false })
  expect(process.env[ENV_GATE]).toBe('operator-truthy')
})

test('explicit operator override is preserved (empty string = "I want traffic ON")', () => {
  // The privacyLevel.ts gate treats `''` as falsy, so this is the
  // documented opt-back-IN to nonessential traffic in medical mode.
  // Aegis must not clobber the empty value with its default '1'.
  process.env[ENV_GATE] = ''
  setPhiModeFromCli({ mode: 'strict', allowOff: false })
  expect(process.env[ENV_GATE]).toBe('')
  expect(isEssentialTrafficOnly()).toBe(false)
})

test('__resetPhiModeForTests undoes ONLY env-vars aegis set', () => {
  // Aegis-set: should be undone.
  setPhiModeFromCli({ mode: 'strict', allowOff: false })
  expect(process.env[ENV_GATE]).toBe('1')
  __resetPhiModeForTests()
  expect(process.env[ENV_GATE]).toBeUndefined()

  // Operator-supplied: should be preserved across reset (otherwise tests
  // could clobber the developer's actual environment).
  process.env[ENV_GATE] = 'operator-set'
  setPhiModeFromCli({ mode: 'strict', allowOff: false })
  expect(process.env[ENV_GATE]).toBe('operator-set')
  __resetPhiModeForTests()
  expect(process.env[ENV_GATE]).toBe('operator-set')
})
