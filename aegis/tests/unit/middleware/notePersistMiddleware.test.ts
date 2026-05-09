import { test, expect } from 'bun:test'
import { createNotePersist } from '../../../src/medical/middleware/notePersistMiddleware.js'
import type { CurrentNoteValue } from '../../../src/medical/state/currentNote.js'

test('writes currentNote when patient + template are loaded', async () => {
  let saved: CurrentNoteValue | null = null
  const m = createNotePersist({
    setNote: (n) => { saved = n },
    isDraftingContext: () => true,
  })
  const res = {
    message: { content: [{ type: 'text', text: 'Hi John Doe.' }] },
  }
  await m.process(res as any, { requestId: 'r1', phiMapping: null })
  expect(saved).toEqual({ free: 'Hi John Doe.', filled_sections: {} })
})

test('no-ops when not in drafting context', async () => {
  let saved: CurrentNoteValue | null = null
  const m = createNotePersist({
    setNote: (n) => { saved = n },
    isDraftingContext: () => false,
  })
  await m.process(
    { message: { content: [{ type: 'text', text: 'x' }] } } as any,
    { requestId: 'r1', phiMapping: null },
  )
  expect(saved).toBeNull()
})

test('concatenates multiple text blocks with newlines', async () => {
  let saved: CurrentNoteValue | null = null
  const m = createNotePersist({
    setNote: (n) => { saved = n },
    isDraftingContext: () => true,
  })
  await m.process(
    {
      message: {
        content: [
          { type: 'text', text: 'A' },
          { type: 'tool_use', input: {} },
          { type: 'text', text: 'B' },
        ],
      },
    } as any,
    { requestId: 'r1', phiMapping: null },
  )
  expect(saved).toEqual({ free: 'A\nB', filled_sections: {} })
})

// [P2 #5] Streaming emits one AssistantMessage per content_block_stop, not
// one per message_stop. So a 3-block response calls notePersist 3 times,
// each time with a single-block message. Without accumulation, /note show
// would only ever see the latest block. Pin the buffer-via-ctx contract.
test('accumulates across per-content-block emits within the same request ctx', async () => {
  const seen: CurrentNoteValue[] = []
  const m = createNotePersist({
    setNote: (n) => { seen.push(n) },
    isDraftingContext: () => true,
  })
  const ctx = { requestId: 'r-stream', phiMapping: null } as Parameters<
    typeof m.process
  >[1]

  // Simulate three sequential content_block_stop emits on the SAME ctx.
  await m.process(
    { message: { content: [{ type: 'text', text: 'Section 1.' }] } } as any,
    ctx,
  )
  await m.process(
    { message: { content: [{ type: 'tool_use', input: {} }] } } as any,
    ctx,
  )
  await m.process(
    { message: { content: [{ type: 'text', text: 'Section 2.' }] } } as any,
    ctx,
  )

  // setNote was called twice (the tool_use emit had no text → no-op).
  expect(seen).toHaveLength(2)
  // Each call carries the cumulative buffer up to that point.
  expect(seen[0]).toEqual({ free: 'Section 1.', filled_sections: {} })
  expect(seen[1]).toEqual({ free: 'Section 1.\nSection 2.', filled_sections: {} })
  // ctx is the durable state; final value is the full note.
  expect(ctx.noteValue?.free).toBe('Section 1.\nSection 2.')
  expect(ctx.noteValue?.filled_sections).toEqual({})
})

test('clearing ctx mid-request restarts accumulation (fallback contract)', async () => {
  const seen: any[] = []
  const m = createNotePersist({
    setNote: (n: any) => { seen.push(n) },
    isDraftingContext: () => true,
  })
  const ctx = { requestId: 'r-fb', phiMapping: null } as Parameters<
    typeof m.process
  >[1]

  await m.process(
    { message: { content: [{ type: 'text', text: 'partial...' }] } } as any,
    ctx,
  )
  expect(ctx.noteValue?.free).toBe('partial...')
  expect(ctx.noteValue?.filled_sections).toEqual({})

  // claude.ts clears ALL three ctx fields before fallback (production reset
  // mirrored here so a future refactor can't regress the contract).
  ctx.noteBuffer = undefined
  ctx.sectionState = undefined
  ctx.noteValue = undefined

  await m.process(
    {
      message: {
        content: [
          { type: 'text', text: 'fallback line 1' },
          { type: 'text', text: 'fallback line 2' },
        ],
      },
    } as any,
    ctx,
  )

  expect(ctx.noteValue?.free).toBe('fallback line 1\nfallback line 2')
  expect(seen[seen.length - 1].free).toBe('fallback line 1\nfallback line 2')
  expect(ctx.noteValue?.free).not.toContain('partial')
})

test('a fresh ctx (e.g. retry) starts buffer-clean — no bleed across requests', async () => {
  let saved: CurrentNoteValue | null = null
  const m = createNotePersist({
    setNote: (n) => { saved = n },
    isDraftingContext: () => true,
  })

  // First request: writes "First request." into its own ctx.
  const ctx1 = { requestId: 'r1', phiMapping: null } as Parameters<
    typeof m.process
  >[1]
  await m.process(
    { message: { content: [{ type: 'text', text: 'First request.' }] } } as any,
    ctx1,
  )
  expect(saved).toEqual({ free: 'First request.', filled_sections: {} })

  // New request → new ctx. Must not see ctx1's buffer.
  const ctx2 = { requestId: 'r2', phiMapping: null } as Parameters<
    typeof m.process
  >[1]
  await m.process(
    { message: { content: [{ type: 'text', text: 'Second request.' }] } } as any,
    ctx2,
  )
  expect(saved).toEqual({ free: 'Second request.', filled_sections: {} })
  expect(ctx2.noteValue?.free).toBe('Second request.')
  expect(ctx2.noteValue?.filled_sections).toEqual({})
})

test('section fences accumulate into filled_sections', async () => {
  const calls: any[] = []
  const mw = createNotePersist({
    setNote: v => calls.push(v),
    isDraftingContext: () => true,
  })
  const ctx: any = { requestId: 'r1', phiMapping: null }
  await mw.process(
    {
      message: {
        content: [
          {
            type: 'text',
            text:
              `<!-- aegis:section=plan -->\nContinue Lisinopril 10mg.\n<!-- aegis:section=end -->`,
          },
        ],
      },
    } as any,
    ctx,
  )
  expect(calls.at(-1).filled_sections).toEqual({
    plan: 'Continue Lisinopril 10mg.',
  })
})

test('clearing ctx mid-request restarts accumulation (fallback contract — M6 fenced sections)', async () => {
  const seen: any[] = []
  const m = createNotePersist({
    setNote: (n: any) => { seen.push(n) },
    isDraftingContext: () => true,
  })
  const ctx = { requestId: 'r-fb', phiMapping: null } as any

  await m.process(
    {
      message: {
        content: [
          {
            type: 'text',
            text: '<!-- aegis:section=plan -->\nContinue lisinopril 10mg.\n<!-- aegis:section=end -->',
          },
        ],
      },
    } as any,
    ctx,
  )
  expect(ctx.noteValue?.filled_sections).toEqual({
    plan: 'Continue lisinopril 10mg.',
  })

  // claude.ts's fallback sites clear ALL three fields. Mirror exactly.
  ctx.noteBuffer = undefined
  ctx.sectionState = undefined
  ctx.noteValue = undefined

  await m.process(
    {
      message: {
        content: [
          {
            type: 'text',
            text: '<!-- aegis:section=assessment -->\nFresh fallback assessment.\n<!-- aegis:section=end -->',
          },
        ],
      },
    } as any,
    ctx,
  )

  const final = seen[seen.length - 1]
  expect(final.filled_sections).toEqual({
    assessment: 'Fresh fallback assessment.',
  })
  expect(final.filled_sections.plan).toBeUndefined()
})
