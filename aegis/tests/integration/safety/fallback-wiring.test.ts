import { test, expect, beforeEach, afterEach } from 'bun:test'
import {
  __resetMedicalChainForTests,
  __setMedicalChainForTests,
  executeNonStreamingRequest,
} from '../../../src/services/api/claude.js'
import { buildMedicalMiddleware } from '../../../src/medical/runtime/middlewareWiring.js'
import {
  __resetMedicalRuntimeForTests,
  setMedicalRuntime,
} from '../../../src/medical/runtime/medicalRuntime.js'
import {
  __resetPhiModeForTests,
  setPhiModeFromCli,
} from '../../../src/medical/runtime/phiMode.js'
import type { DeIdentifier } from '../../../src/medical/deid/DeIdentifier.js'

const stubDeid: DeIdentifier = {
  redact: async (text: string) => ({
    redacted: text.replaceAll('John Doe', '<PERSON_1>'),
    mapping: {
      entries: { '<PERSON_1>': { type: 'PERSON', original: 'John Doe' } },
      version: 'stub',
    },
  }),
  restore: async (t: string) => t.replaceAll('<PERSON_1>', 'John Doe'),
}

let _savedKey: string | undefined
beforeEach(() => {
  _savedKey = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = 'sk-test-fallback-wiring-do-not-use'
  __resetMedicalRuntimeForTests()
  __resetMedicalChainForTests()
  __resetPhiModeForTests()
})

afterEach(() => {
  if (_savedKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY
  } else {
    process.env.ANTHROPIC_API_KEY = _savedKey
  }
  __resetMedicalRuntimeForTests()
  __resetMedicalChainForTests()
  __resetPhiModeForTests()
})

function makeFetchOverride(captured: string[]) {
  return async (_url: any, init: any) => {
    captured.push(init.body as string)
    return new Response(
      JSON.stringify({
        id: 'msg-fb-test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        model: 'claude-sonnet-4-6',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
}

async function drain<T>(gen: AsyncGenerator<unknown, T>): Promise<T> {
  let last: IteratorResult<unknown, T>
  do {
    last = await gen.next()
  } while (!last.done)
  return last.value
}

test('non-streaming fallback: captureRequest receives REDACTED params (proves old capture line was deleted)', async () => {
  setPhiModeFromCli({ mode: 'strict', allowOff: false })
  setMedicalRuntime({
    getState: () => ({ auditLogPath: '/dev/null' }) as never,
    setState: () => {},
    getMcpClients: () => [],
    sessionId: 't',
  })
  __setMedicalChainForTests(
    buildMedicalMiddleware({
      deid: stubDeid,
      logger: { append: async () => {}, close: async () => {} },
      mode: 'strict',
      setNote: () => {},
      isDraftingContext: () => false,
    }),
  )

  const fetchedBodies: string[] = []
  const captured: any[] = []
  const aegisCtx = { requestId: 'fb-1', phiMapping: null }

  const gen = executeNonStreamingRequest(
    {
      model: 'claude-sonnet-4-6',
      source: 'sdk',
      fetchOverride: makeFetchOverride(fetchedBodies),
    },
    {
      model: 'claude-sonnet-4-6',
      thinkingConfig: { type: 'disabled' },
      signal: new AbortController().signal,
    },
    () => ({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Patient John Doe presented.' }],
      max_tokens: 100,
    }),
    () => {},
    (params) => captured.push(params),
    null,
    aegisCtx,
  )

  await drain(gen as AsyncGenerator<unknown, unknown>)

  expect(captured).toHaveLength(1)
  const capturedJson = JSON.stringify(captured[0])
  expect(capturedJson).not.toContain('John Doe')
  expect(capturedJson).toContain('<PERSON_1>')

  expect(fetchedBodies).toHaveLength(1)
  expect(fetchedBodies[0]).not.toContain('John Doe')
  expect(fetchedBodies[0]).toContain('<PERSON_1>')
})

test('non-streaming fallback: aegisCtx=null preserves original direct-send semantics', async () => {
  const fetchedBodies: string[] = []
  const captured: any[] = []

  const gen = executeNonStreamingRequest(
    {
      model: 'claude-sonnet-4-6',
      source: 'sdk',
      fetchOverride: makeFetchOverride(fetchedBodies),
    },
    {
      model: 'claude-sonnet-4-6',
      thinkingConfig: { type: 'disabled' },
      signal: new AbortController().signal,
    },
    () => ({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Plain text — non-medical.' }],
      max_tokens: 100,
    }),
    () => {},
    (params) => captured.push(params),
    null,
    null,
  )
  await drain(gen as AsyncGenerator<unknown, unknown>)

  expect(JSON.stringify(captured[0])).toContain('Plain text — non-medical.')
  expect(fetchedBodies[0]).toContain('Plain text — non-medical.')
})

test('non-streaming fallback: redacted branch normalizes model alias (regression for hoist-out-of-fork bug)', async () => {
  setPhiModeFromCli({ mode: 'strict', allowOff: false })
  setMedicalRuntime({
    getState: () => ({ auditLogPath: '/dev/null' }) as never,
    setState: () => {},
    getMcpClients: () => [],
    sessionId: 't',
  })
  __setMedicalChainForTests(
    buildMedicalMiddleware({
      deid: stubDeid,
      logger: { append: async () => {}, close: async () => {} },
      mode: 'strict',
      setNote: () => {},
      isDraftingContext: () => false,
    }),
  )

  const fetchedBodies: string[] = []
  const captured: any[] = []
  const aegisCtx = { requestId: 'fb-norm', phiMapping: null }

  const gen = executeNonStreamingRequest(
    {
      model: 'claude-opus-4-7[1m]',
      source: 'sdk',
      fetchOverride: makeFetchOverride(fetchedBodies),
    },
    {
      model: 'claude-opus-4-7[1m]',
      thinkingConfig: { type: 'disabled' },
      signal: new AbortController().signal,
    },
    () => ({
      model: 'claude-opus-4-7[1m]',
      messages: [{ role: 'user', content: 'Patient John Doe presented.' }],
      max_tokens: 100,
    }),
    () => {},
    (params) => captured.push(params),
    null,
    aegisCtx,
  )
  await drain(gen as AsyncGenerator<unknown, unknown>)

  expect(fetchedBodies).toHaveLength(1)
  expect(fetchedBodies[0]).not.toContain('[1m]')
  expect(fetchedBodies[0]).toContain('claude-opus-4-7')
  expect(JSON.stringify(captured[0])).not.toContain('[1m]')
  expect(JSON.stringify(captured[0])).not.toContain('John Doe')
})
