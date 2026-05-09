import { test, expect, mock } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  installCassetteAdapter,
  uninstallCassetteAdapter,
} from '../../lib/cassetteAdapter.js'
import { canonicalizeRequest, requestHash } from '../../lib/canonicalRequest.js'

test('replay miss raises with a re-record hint (no client required, P1#1)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-cassette-'))
  installCassetteAdapter({ workflow: 'unit-miss', cassetteDir: dir, mode: 'replay' })
  const { getAdapter } = await import('../../../src/medical/providers/adapterRegistry.js')
  const adapter = getAdapter('anthropic')
  await expect(
    adapter.dispatch({ model: 'm', messages: [] } as any, { id: 'anthropic', modelId: 'm', capabilities: {} as any }, {}),
  ).rejects.toThrow(/cassette miss/i)
  uninstallCassetteAdapter()
})

test('record mode resolves the real adapter exactly once and writes one JSONL line', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-cassette-rec-'))
  const cassettePath = join(dir, 'unit-record.jsonl')
  let fetchCalls = 0
  const realFetch = globalThis.fetch
  const realZhipuKey = process.env.ZHIPUAI_API_KEY
  process.env.ZHIPUAI_API_KEY = 'test-record-key'
  globalThis.fetch = (async (_url: string, _init?: RequestInit) => {
    fetchCalls++
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-rec',
        object: 'chat.completion',
        choices: [{
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'recorded body' },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as any
  installCassetteAdapter({ workflow: 'unit-record', cassetteDir: dir, mode: 'record' })

  try {
    const { getAdapter, __clearAdapterCacheForTest } = await import(
      '../../../src/medical/providers/adapterRegistry.js'
    )
    __clearAdapterCacheForTest()
    const adapter = getAdapter('glm')
    const out = await adapter.dispatch(
      { model: 'glm-4-plus', messages: [{ role: 'user', content: 'hi' }] } as any,
      {
        id: 'glm',
        modelId: 'glm-4-plus',
        baseURL: 'https://example-glm.test/api/paas/v4',
        capabilities: { streaming: false, toolUse: true, promptCache: false, maxContextTokens: 128_000 },
      },
      {},
    )
    expect(fetchCalls).toBe(1)
    expect(out.kind).toBe('message')
    expect((out as any).message.content[0].text).toBe('recorded body')

    const lines = readFileSync(cassettePath, 'utf-8').trim().split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)
    const line = JSON.parse(lines[0]!)
    expect(typeof line.requestHash).toBe('string')
    expect(line.requestHash.length).toBeGreaterThan(0)
    expect(line.response.kind).toBe('message')
    expect(line.response.message.content[0].text).toBe('recorded body')
  } finally {
    uninstallCassetteAdapter()
    globalThis.fetch = realFetch
    if (realZhipuKey === undefined) delete process.env.ZHIPUAI_API_KEY
    else process.env.ZHIPUAI_API_KEY = realZhipuKey
  }
})

test('record mode replaces a pre-existing same-hash line (P1#5: re-record overrides)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-cassette-replace-'))
  const cassettePath = join(dir, 'unit-replace.jsonl')
  // Seed a stale synthetic cassette line for the same request shape the
  // record run will produce.
  const reqShape = {
    model: 'glm-4-plus',
    messages: [{ role: 'user', content: 'hi' }],
  }
  const staleHash = requestHash(reqShape)
  const staleLine = JSON.stringify({
    requestHash: staleHash,
    request: canonicalizeRequest(reqShape),
    response: {
      kind: 'message',
      message: {
        id: 'msg_stale',
        role: 'assistant',
        type: 'message',
        model: 'glm-4-plus',
        content: [{ type: 'text', text: 'STALE BODY' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    },
  })
  // Two stale lines for the same hash so we also exercise dedup.
  writeFileSync(cassettePath, staleLine + '\n' + staleLine + '\n')

  const realFetch = globalThis.fetch
  const realZhipuKey = process.env.ZHIPUAI_API_KEY
  process.env.ZHIPUAI_API_KEY = 'test-record-key'
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        id: 'chatcmpl-fresh',
        object: 'chat.completion',
        choices: [{
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'FRESH BODY' },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as any
  installCassetteAdapter({ workflow: 'unit-replace', cassetteDir: dir, mode: 'record' })

  try {
    const { getAdapter, __clearAdapterCacheForTest } = await import(
      '../../../src/medical/providers/adapterRegistry.js'
    )
    __clearAdapterCacheForTest()
    const adapter = getAdapter('glm')
    await adapter.dispatch(
      reqShape as any,
      {
        id: 'glm',
        modelId: 'glm-4-plus',
        baseURL: 'https://example-glm.test/api/paas/v4',
        capabilities: { streaming: false, toolUse: true, promptCache: false, maxContextTokens: 128_000 },
      },
      {},
    )

    const lines = readFileSync(cassettePath, 'utf-8').trim().split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)
    const line = JSON.parse(lines[0]!)
    expect(line.requestHash).toBe(staleHash)
    expect(line.response.message.content[0].text).toBe('FRESH BODY')
  } finally {
    uninstallCassetteAdapter()
    globalThis.fetch = realFetch
    if (realZhipuKey === undefined) delete process.env.ZHIPUAI_API_KEY
    else process.env.ZHIPUAI_API_KEY = realZhipuKey
  }
})

test('replay returns the LAST same-hash line if a hand-edited cassette has duplicates (P1#5)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-cassette-lastwins-'))
  const cassettePath = join(dir, 'unit-lastwins.jsonl')
  const reqShape = { model: 'm', messages: [{ role: 'user', content: 'q' }] }
  const hash = requestHash(reqShape)
  const mkLine = (tag: string) =>
    JSON.stringify({
      requestHash: hash,
      request: canonicalizeRequest(reqShape),
      response: {
        kind: 'message',
        message: {
          id: `msg_${tag}`,
          role: 'assistant',
          type: 'message',
          model: 'm',
          content: [{ type: 'text', text: tag }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      },
    })
  writeFileSync(cassettePath, mkLine('OLD') + '\n' + mkLine('NEW') + '\n')

  installCassetteAdapter({ workflow: 'unit-lastwins', cassetteDir: dir, mode: 'replay' })
  try {
    const { getAdapter, __clearAdapterCacheForTest } = await import(
      '../../../src/medical/providers/adapterRegistry.js'
    )
    __clearAdapterCacheForTest()
    const adapter = getAdapter('anthropic')
    const out = await adapter.dispatch(
      reqShape as any,
      { id: 'anthropic', modelId: 'm', capabilities: {} as any },
      {},
    )
    expect(out.kind).toBe('message')
    expect((out as any).message.content[0].text).toBe('NEW')
  } finally {
    uninstallCassetteAdapter()
  }
})
