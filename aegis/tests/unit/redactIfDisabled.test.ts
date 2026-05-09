import { test, expect, beforeEach, afterEach } from 'bun:test'
import { redactIfDisabled } from '../../src/utils/telemetry/events.js'
import {
	__resetPhiModeForTests,
	setPhiModeFromCli,
} from '../../src/medical/runtime/phiMode.js'

// `redactIfDisabled` is the single chokepoint for whether OTel `user_prompt`
// payloads ship raw text or `<REDACTED>`. The contract: raw text only escapes
// when BOTH (a) `OTEL_LOG_USER_PROMPTS` is set AND (b) PHI mode is `off`.
// These tests cover the full 2x2 truth table; a regression in any cell would
// either leak PHI (cells expecting REDACTED that don't) or break upstream
// telemetry (the off+env-set cell that should pass through).

const PROMPT = 'Patient John Doe came in.'
const ENV_KEY = 'OTEL_LOG_USER_PROMPTS'
let savedEnv: string | undefined

beforeEach(() => {
	savedEnv = process.env[ENV_KEY]
	__resetPhiModeForTests()
})

afterEach(() => {
	if (savedEnv === undefined) delete process.env[ENV_KEY]
	else process.env[ENV_KEY] = savedEnv
	__resetPhiModeForTests()
})

test('redacts when env unset, regardless of PHI mode (off)', () => {
	delete process.env[ENV_KEY]
	setPhiModeFromCli({ mode: 'off', allowOff: true })
	expect(redactIfDisabled(PROMPT)).toBe('<REDACTED>')
})

test('redacts when env unset, regardless of PHI mode (strict)', () => {
	delete process.env[ENV_KEY]
	setPhiModeFromCli({ mode: 'strict', allowOff: false })
	expect(redactIfDisabled(PROMPT)).toBe('<REDACTED>')
})

test('redacts when PHI mode is strict, even with env set', () => {
	process.env[ENV_KEY] = '1'
	setPhiModeFromCli({ mode: 'strict', allowOff: false })
	expect(redactIfDisabled(PROMPT)).toBe('<REDACTED>')
})

test('redacts when PHI mode is research, even with env set', () => {
	process.env[ENV_KEY] = '1'
	setPhiModeFromCli({ mode: 'research', allowOff: false })
	expect(redactIfDisabled(PROMPT)).toBe('<REDACTED>')
})

test('passes through ONLY when PHI mode is off AND env is set (the upstream contract)', () => {
	process.env[ENV_KEY] = '1'
	setPhiModeFromCli({ mode: 'off', allowOff: true })
	expect(redactIfDisabled(PROMPT)).toBe(PROMPT)
})
