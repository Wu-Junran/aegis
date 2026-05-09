import { test, expect } from 'bun:test'
import {
	createPhiMiddlewarePair,
	unwrapRedacted,
} from '../../../src/medical/middleware/phiMiddleware.js'
import type { DeIdentifier } from '../../../src/medical/deid/DeIdentifier.js'

function fakeDeid(): DeIdentifier {
	return {
		redact: async (text: string) => ({
			redacted: text.replaceAll('John Doe', '<PERSON_1>'),
			mapping: {
				entries: { '<PERSON_1>': { type: 'PERSON', original: 'John Doe' } },
				version: 'fake-1',
			},
		}),
		restore: async (text: string) =>
			text.replaceAll('<PERSON_1>', 'John Doe'),
	}
}

test('outbound redacts text content blocks across messages', async () => {
	const { outbound } = createPhiMiddlewarePair(fakeDeid())
	const ctx = { requestId: 'r1', phiMapping: null }
	const req = {
		model: 'claude-sonnet-4-6',
		system: 'You are helping draft a note for John Doe.',
		messages: [
			{ role: 'user', content: 'Patient John Doe came in.' },
			{
				role: 'assistant',
				content: [{ type: 'text', text: 'Reviewing John Doe.' }],
			},
		],
	}
	const redacted = await outbound.process(req, ctx)
	const unwrapped = unwrapRedacted(redacted)
	expect(unwrapped.system).not.toContain('John Doe')
	expect(JSON.stringify(unwrapped.messages)).not.toContain('John Doe')
	expect(ctx.phiMapping?.entries['<PERSON_1>']?.original).toBe('John Doe')
})

test('inbound re-identifies content blocks using ctx.phiMapping', async () => {
	const { outbound, inbound } = createPhiMiddlewarePair(fakeDeid())
	const ctx = { requestId: 'r1', phiMapping: null }
	await outbound.process(
		{ messages: [{ role: 'user', content: 'John Doe' }] },
		ctx,
	)
	const restored = await inbound.process(
		{
			type: 'assistant',
			message: {
				content: [
					{ type: 'text', text: 'Hi <PERSON_1>.' },
					{ type: 'tool_use', name: 't', input: { note: 'about <PERSON_1>' } },
				],
			},
		},
		ctx,
	)
	expect(restored.message.content[0].text).toBe('Hi John Doe.')
	expect(restored.message.content[1].input.note).toBe('about John Doe')
})

test('unwrapRedacted rejects unbranded objects', () => {
	expect(() => unwrapRedacted({ messages: [] } as never)).toThrow(/branded/i)
})

test('outbound redacts NESTED tool_result content (string + array shapes)', async () => {
	const { outbound } = createPhiMiddlewarePair(fakeDeid())
	const ctx = { requestId: 'r1', phiMapping: null }
	const req = {
		messages: [
			{
				role: 'user',
				content: [
					{
						type: 'tool_result',
						tool_use_id: 'a',
						content: 'string-shape result mentions John Doe',
					},
					{
						type: 'tool_result',
						tool_use_id: 'b',
						content: [
							{ type: 'text', text: 'array-shape result mentions John Doe too' },
							{ type: 'text', text: 'second block also John Doe' },
						],
					},
				],
			},
		],
	}
	const wire = JSON.stringify(unwrapRedacted(await outbound.process(req, ctx)))
	expect(wire).not.toContain('John Doe')
	expect(wire).toContain('<PERSON_1>')
})

test('outbound redacts tool_use.input (PHI in tool args)', async () => {
	const { outbound } = createPhiMiddlewarePair(fakeDeid())
	const ctx = { requestId: 'r1', phiMapping: null }
	const req = {
		messages: [
			{
				role: 'assistant',
				content: [
					{
						type: 'tool_use',
						id: 't1',
						name: 'render_template',
						input: { patientName: 'John Doe', section: 'subjective' },
					},
				],
			},
		],
	}
	const wire = JSON.stringify(unwrapRedacted(await outbound.process(req, ctx)))
	expect(wire).not.toContain('John Doe')
})

test('outbound REFUSES a request that contains a document block (PDF cannot be de-identified by text-only pipeline)', async () => {
	const { outbound } = createPhiMiddlewarePair(fakeDeid())
	const ctx = { requestId: 'r-doc', phiMapping: null }
	const req = {
		messages: [
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'Summarize this discharge summary.' },
					{
						type: 'document',
						source: {
							type: 'base64',
							media_type: 'application/pdf',
							// base64 of the literal text "RAW PHI (e.g., John Doe MRN 12345678)" — what a real
							// PDF would carry, not redactable by Presidio.
							data: 'UkFXIFBISSAoZS5nLiwgSm9obiBEb2UgTVJOIDEyMzQ1Njc4KQ==',
						},
					},
				],
			},
		],
	}
	await expect(outbound.process(req, ctx)).rejects.toThrow(/document/i)
	// ctx.phiMapping must NOT be set (we refused before redaction would have run).
	expect(ctx.phiMapping).toBeNull()
})

test('outbound REFUSES a request that contains an image block', async () => {
	const { outbound } = createPhiMiddlewarePair(fakeDeid())
	const ctx = { requestId: 'r-img', phiMapping: null }
	const req = {
		messages: [
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'What does this scanned form say?' },
					{
						type: 'image',
						source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0K' },
					},
				],
			},
		],
	}
	await expect(outbound.process(req, ctx)).rejects.toThrow(/image/i)
})

test('outbound REFUSES a document block nested inside a tool_result (uncommon, but allowed by SDK union)', async () => {
	const { outbound } = createPhiMiddlewarePair(fakeDeid())
	const ctx = { requestId: 'r-nested-doc', phiMapping: null }
	const req = {
		messages: [
			{
				role: 'user',
				content: [
					{
						type: 'tool_result',
						tool_use_id: 'a',
						content: [
							{ type: 'text', text: 'tool returned a doc:' },
							{
								type: 'document',
								source: { type: 'base64', media_type: 'application/pdf', data: 'PDF==' },
							},
						],
					},
				],
			},
		],
	}
	await expect(outbound.process(req, ctx)).rejects.toThrow(/document/i)
})

test('outbound passes through a text-only request (control: media refusal does not affect normal traffic)', async () => {
	const { outbound } = createPhiMiddlewarePair(fakeDeid())
	const ctx = { requestId: 'r-control', phiMapping: null }
	const req = {
		messages: [{ role: 'user', content: 'No media here.' }],
	}
	const wrapped = await outbound.process(req, ctx)
	expect(unwrapRedacted(wrapped).messages).toBeDefined()
})

test('outbound REFUSES a thinking block (extended-thinking replay carries free-form PHI in the thinking field)', async () => {
	// Anthropic SDK pattern: when extended thinking is enabled, the model
	// returns a `thinking` block alongside `text` and `tool_use`. The recommended
	// pattern is to replay prior thinking blocks back to the model on the next
	// turn so the chain-of-thought is preserved. The `thinking` field is a
	// free-form string that can carry PHI; without refusal here, a future
	// replay would ship raw PHI even if the original outbound was redacted.
	const { outbound } = createPhiMiddlewarePair(fakeDeid())
	const ctx = { requestId: 'r-thinking', phiMapping: null }
	const req = {
		messages: [
			{
				role: 'assistant',
				content: [
					{
						type: 'thinking',
						thinking: 'Let me consider John Doe\'s case more carefully.',
						signature: 'opaque-server-token',
					},
					{ type: 'text', text: 'Reviewing now.' },
				],
			},
		],
	}
	await expect(outbound.process(req, ctx)).rejects.toThrow(/thinking/i)
	expect(ctx.phiMapping).toBeNull()
})

test('outbound REFUSES a redacted_thinking block (opaque encrypted thinking we cannot inspect)', async () => {
	const { outbound } = createPhiMiddlewarePair(fakeDeid())
	const ctx = { requestId: 'r-redacted-thinking', phiMapping: null }
	const req = {
		messages: [
			{
				role: 'assistant',
				content: [
					{
						type: 'redacted_thinking',
						data: 'opaque-encrypted-blob',
					},
				],
			},
		],
	}
	await expect(outbound.process(req, ctx)).rejects.toThrow(/redacted_thinking/i)
	expect(ctx.phiMapping).toBeNull()
})

test('per-blob fallback: same identity across blobs uses ONE canonical placeholder (no split-identity)', async () => {
	// Reviewer P2#4 regression: with only key-collision detection, the
	// fallback would let one identity end up bound to TWO placeholders in
	// the merged mapping. Scenario: blob A maps John → <PERSON_1>; blob B
	// maps Jane → <PERSON_1> AND John → <PERSON_2>. Without original-based
	// canonicalization, John appears in merged at BOTH <PERSON_1> (from A)
	// and <PERSON_2> (from B), violating the shared-placeholder-pool
	// invariant. The fix tracks `byOriginal` and reuses the canonical
	// placeholder.
	const splitIdentityDeid: DeIdentifier = {
		redact: async (text: string) => {
			const present = ['John Doe', 'Jane Roe'].filter((n) => text.includes(n))
			if (present.length === 0) {
				return { redacted: text, mapping: { entries: {}, version: 'split-1' } }
			}
			let r = text
			const entries: Record<string, { type: string; original: string }> = {}
			// Blob B's deidentification ordering: Jane gets <PERSON_1>, John gets
			// <PERSON_2>. Stub mimics a real per-blob deid that restarts numbering.
			// Sort so the assignment is deterministic.
			const sorted = present.sort((a, c) => text.indexOf(a) - text.indexOf(c))
			let i = 1
			for (const name of sorted) {
				const k = `<PERSON_${i++}>`
				entries[k] = { type: 'PERSON', original: name }
				r = r.replaceAll(name, k)
			}
			return { redacted: r, mapping: { entries, version: 'split-1' } }
		},
		restore: async (text, mapping) => {
			let r = text
			for (const [k, v] of Object.entries(mapping.entries)) {
				r = r.replaceAll(k, v.original)
			}
			return r
		},
	}
	const { outbound, inbound } = createPhiMiddlewarePair(splitIdentityDeid)
	const ctx = { requestId: 'r-split', phiMapping: null }
	const req = {
		// Blob 1 (system): only John appears.
		system: 'You are drafting for John Doe.',
		messages: [
			// Blob 2 (user message): Jane appears first (gets <PERSON_1> in stub),
			// then John (gets <PERSON_2> in stub). Without canonicalization, John
			// would end up in merged twice.
			{ role: 'user', content: 'Met Jane Roe at clinic with John Doe.' },
		],
	}
	await outbound.process(req, ctx)

	// The merged mapping must have exactly ONE entry per distinct original.
	const entries = Object.entries(ctx.phiMapping!.entries)
	const originalsCount = new Map<string, number>()
	for (const [, v] of entries) {
		originalsCount.set(v.original, (originalsCount.get(v.original) ?? 0) + 1)
	}
	expect(originalsCount.get('John Doe')).toBe(1)
	expect(originalsCount.get('Jane Roe')).toBe(1)

	// Inbound: round-tripping each canonical placeholder must restore the
	// RIGHT identity. Using both placeholders in the same response.
	const johnKey = entries.find(([, v]) => v.original === 'John Doe')![0]
	const janeKey = entries.find(([, v]) => v.original === 'Jane Roe')![0]
	const restored = await inbound.process(
		{
			type: 'assistant',
			message: {
				content: [
					{ type: 'text', text: `Note for ${johnKey} mentioning ${janeKey}.` },
				],
			},
		},
		ctx,
	)
	expect(restored.message.content[0].text).toBe(
		'Note for John Doe mentioning Jane Roe.',
	)
})

test('per-blob fallback: two distinct identities in two blobs do NOT collide on <PERSON_1>', async () => {
	// Regression: a typical per-blob deid restarts placeholder numbering on
	// each call, so without renumbering the system + message blobs would each
	// emit <PERSON_1> for a different person. The naïve merge `merged[k] = v`
	// would overwrite Alice with Bob and inbound re-id would replace BOTH
	// <PERSON_1> tokens with "Bob" — silent identity swap.
	//
	// This stub deliberately does NOT implement redactBatch (production uses
	// McpDeIdentifier which does); the middleware's renumbering fallback is
	// what's under test. The stub redacts whichever known name appears in the
	// blob and always emits <PERSON_1>, so the two blobs WILL collide.
	const collidingDeid: DeIdentifier = {
		redact: async (text: string) => {
			for (const name of ['Alice Adams', 'Bob Brown']) {
				if (text.includes(name)) {
					return {
						redacted: text.replaceAll(name, '<PERSON_1>'),
						mapping: {
							entries: { '<PERSON_1>': { type: 'PERSON', original: name } },
							version: 'colliding-1',
						},
					}
				}
			}
			return { redacted: text, mapping: { entries: {}, version: 'colliding-1' } }
		},
		restore: async (text, mapping) => {
			let r = text
			for (const [k, v] of Object.entries(mapping.entries)) {
				r = r.replaceAll(k, v.original)
			}
			return r
		},
	}
	const { outbound, inbound } = createPhiMiddlewarePair(collidingDeid)
	const ctx = { requestId: 'r-collide', phiMapping: null }
	const req = {
		system: 'You are drafting for Alice Adams.',
		messages: [
			{ role: 'user', content: 'Cross-reference with Bob Brown.' },
		],
	}
	const redacted = await outbound.process(req, ctx)
	const unwrapped = unwrapRedacted(redacted)

	// Both originals must be absent from the wire payload.
	const wire = JSON.stringify(unwrapped)
	expect(wire).not.toContain('Alice Adams')
	expect(wire).not.toContain('Bob Brown')

	// The merged mapping must contain TWO entries for the two distinct people.
	const entries = Object.entries(ctx.phiMapping!.entries)
	const originals = entries.map(([, v]) => v.original).sort()
	expect(originals).toEqual(['Alice Adams', 'Bob Brown'])

	// Inbound must restore the correct identity to each token. Echo BOTH the
	// original placeholder (still bound to Alice in the merged map) AND the
	// renumbered placeholder (bound to Bob). If the merge had silently
	// overwritten, both would restore to "Bob".
	const aliceKey = entries.find(([, v]) => v.original === 'Alice Adams')![0]
	const bobKey = entries.find(([, v]) => v.original === 'Bob Brown')![0]
	expect(aliceKey).not.toBe(bobKey) // distinct keys post-renumber
	const restored = await inbound.process(
		{
			type: 'assistant',
			message: {
				content: [
					{ type: 'text', text: `Hi ${aliceKey} and ${bobKey}.` },
				],
			},
		},
		ctx,
	)
	expect(restored.message.content[0].text).toBe('Hi Alice Adams and Bob Brown.')
})

test('per-blob fallback: SWAP-SAFE rewrite when blobs cross-rename identities (no collapse onto one placeholder)', async () => {
	// Edge case behind the two-pass rewrite: blob A has {John→<PERSON_1>,
	// Jane→<PERSON_2>}; blob B has {Jane→<PERSON_1>, John→<PERSON_2>}. With a
	// sequential `replaceAll`, step 1 (rewrite <PERSON_1>→<PERSON_2> for
	// canonical-Jane) would also unintentionally affect step 2's input
	// (rewrite <PERSON_2>→<PERSON_1> for canonical-John), collapsing BOTH
	// identities onto <PERSON_1>. The two-pass unique-marker rewrite must
	// preserve them distinct.
	const swappingDeid: DeIdentifier = {
		redact: async (text: string) => {
			const present = ['John Doe', 'Jane Roe'].filter((n) => text.includes(n))
			if (present.length === 0) {
				return { redacted: text, mapping: { entries: {}, version: 'swap-1' } }
			}
			// Assign placeholders by FIRST-APPEARANCE order in this blob — a
			// realistic per-blob deid behavior.
			const sorted = present.sort((a, c) => text.indexOf(a) - text.indexOf(c))
			let r = text
			const entries: Record<string, { type: string; original: string }> = {}
			let i = 1
			for (const name of sorted) {
				const k = `<PERSON_${i++}>`
				entries[k] = { type: 'PERSON', original: name }
				r = r.replaceAll(name, k)
			}
			return { redacted: r, mapping: { entries, version: 'swap-1' } }
		},
		restore: async (text, mapping) => {
			let r = text
			for (const [k, v] of Object.entries(mapping.entries)) {
				r = r.replaceAll(k, v.original)
			}
			return r
		},
	}
	const { outbound, inbound } = createPhiMiddlewarePair(swappingDeid)
	const ctx = { requestId: 'r-swap', phiMapping: null }
	const req = {
		// Blob 1: John appears first, Jane second → John=<P1>, Jane=<P2>.
		system: 'Drafting for John Doe and Jane Roe.',
		messages: [
			// Blob 2: Jane appears first, John second → Jane=<P1>, John=<P2>.
			// The swap relative to blob 1 is what stresses the two-pass rewrite.
			{
				role: 'user',
				content: 'Spoke with Jane Roe; later met John Doe at imaging.',
			},
		],
	}
	await outbound.process(req, ctx)

	// Each original is bound to exactly one canonical placeholder.
	const entries = Object.entries(ctx.phiMapping!.entries)
	const johnEntries = entries.filter(([, v]) => v.original === 'John Doe')
	const janeEntries = entries.filter(([, v]) => v.original === 'Jane Roe')
	expect(johnEntries).toHaveLength(1)
	expect(janeEntries).toHaveLength(1)
	// The two canonical keys are DIFFERENT (no collapse onto one).
	expect(johnEntries[0]![0]).not.toBe(janeEntries[0]![0])

	// Inbound restoration of the canonical keys must yield the right names.
	const restored = await inbound.process(
		{
			type: 'assistant',
			message: {
				content: [
					{
						type: 'text',
						text: `${johnEntries[0]![0]} and ${janeEntries[0]![0]}.`,
					},
				],
			},
		},
		ctx,
	)
	expect(restored.message.content[0].text).toBe('John Doe and Jane Roe.')
})

// [P1 #4] phi.outbound must NOT mutate the caller's request object.
//
// Failure mode the fix prevents: claude.ts's `paramsFromContext` shares the
// queryModel-scoped `system` and `messagesForAPI` references across retries.
// If outbound mutated those in place, attempt #2 would see already-redacted
// text → empty mapping → inbound restore is a no-op → user sees raw
// `<PERSON_1>` placeholders instead of "John Doe". The fix deep-clones at
// outbound entry; these tests pin the contract.
test('outbound does not mutate caller request: top-level system + messages refs preserved', async () => {
	const { outbound } = createPhiMiddlewarePair(fakeDeid())
	const ctx = { requestId: 'r1', phiMapping: null }
	const sharedSystem = [{ type: 'text', text: 'Drafting a note for John Doe.' }]
	const sharedMessage = {
		role: 'user',
		content: [{ type: 'text', text: 'Patient John Doe came in.' }],
	}
	const req = {
		model: 'claude-sonnet-4-6',
		system: sharedSystem,
		messages: [sharedMessage],
	}

	// Capture references AND content before redaction.
	const systemRefBefore = req.system
	const messagesRefBefore = req.messages
	const messageBlockRefBefore = sharedMessage.content[0]
	const systemTextBefore = sharedSystem[0]!.text
	const messageTextBefore = (sharedMessage.content[0] as { text: string }).text

	const redacted = await outbound.process(req, ctx)
	const unwrapped = unwrapRedacted(redacted)

	// Caller's references must be untouched.
	expect(req.system).toBe(systemRefBefore)
	expect(req.messages).toBe(messagesRefBefore)
	expect(sharedMessage.content[0]).toBe(messageBlockRefBefore)

	// Caller's text content must be the original plaintext (no in-place edit).
	expect(sharedSystem[0]!.text).toBe(systemTextBefore)
	expect((sharedMessage.content[0] as { text: string }).text).toBe(
		messageTextBefore,
	)
	expect(sharedSystem[0]!.text).toContain('John Doe')
	expect((sharedMessage.content[0] as { text: string }).text).toContain('John Doe')

	// The wire payload IS redacted.
	expect(JSON.stringify(unwrapped.system)).toContain('<PERSON_1>')
	expect(JSON.stringify(unwrapped.messages)).toContain('<PERSON_1>')
	expect(JSON.stringify(unwrapped.system)).not.toContain('John Doe')
	expect(JSON.stringify(unwrapped.messages)).not.toContain('John Doe')

	// And the wire payload's nested objects are NOT the caller's nested objects.
	expect(unwrapped.system).not.toBe(systemRefBefore)
	expect(unwrapped.messages).not.toBe(messagesRefBefore)
})

test('outbound is idempotent across retries: two runs on same input produce identical mappings', async () => {
	const { outbound } = createPhiMiddlewarePair(fakeDeid())
	const ctx1 = { requestId: 'r1', phiMapping: null }
	const ctx2 = { requestId: 'r2', phiMapping: null }
	const req = {
		model: 'claude-sonnet-4-6',
		system: 'Drafting a note for John Doe.',
		messages: [{ role: 'user', content: 'Patient John Doe came in.' }],
	}

	const r1 = await outbound.process(req, ctx1)
	// Simulate withRetry calling paramsFromContext again with the SAME
	// underlying messages/system refs (this is exactly the production shape).
	const r2 = await outbound.process(req, ctx2)

	const u1 = unwrapRedacted(r1)
	const u2 = unwrapRedacted(r2)

	// Both wire payloads must be redacted (the bug would have ctx2.phiMapping
	// be empty because the second pass would see already-placeholder text).
	expect(JSON.stringify(u1)).toContain('<PERSON_1>')
	expect(JSON.stringify(u2)).toContain('<PERSON_1>')
	expect(ctx1.phiMapping?.entries['<PERSON_1>']?.original).toBe('John Doe')
	expect(ctx2.phiMapping?.entries['<PERSON_1>']?.original).toBe('John Doe')

	// Both mappings must be byte-identical (same input → same redaction).
	expect(JSON.stringify(ctx1.phiMapping)).toBe(JSON.stringify(ctx2.phiMapping))
})

test('outbound rawRequestSnapshot is plaintext after the call (not redacted)', async () => {
	// Research-mode contract: audit.outbound reads ctx.rawRequestSnapshot to
	// log the plaintext request. If phi.outbound's clone discipline regresses,
	// the snapshot would point at the mutated payload and research-mode logs
	// would silently switch to placeholders.
	const { outbound } = createPhiMiddlewarePair(fakeDeid())
	const ctx: { requestId: string; phiMapping: null; rawRequestSnapshot?: Record<string, unknown> } = {
		requestId: 'r1',
		phiMapping: null,
	}
	const req = {
		model: 'claude-sonnet-4-6',
		system: 'Drafting for John Doe.',
		messages: [{ role: 'user', content: 'John Doe.' }],
	}
	await outbound.process(req, ctx)
	expect(JSON.stringify(ctx.rawRequestSnapshot)).toContain('John Doe')
	expect(JSON.stringify(ctx.rawRequestSnapshot)).not.toContain('<PERSON_1>')
})
