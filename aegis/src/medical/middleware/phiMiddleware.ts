import type { DeIdentifier, PhiMapping } from '../deid/DeIdentifier.js'

export type MiddlewareContext = {
	requestId: string
	phiMapping: PhiMapping | null
	/**
	 * Snapshot of the request as it entered the outbound chain — taken by
	 * `phi.outbound` BEFORE any redaction mutates `req` in place. Read by
	 * `audit.outbound` in research mode so `fullRequest` reflects the
	 * plaintext payload (the spec contract for research mode), not the
	 * already-redacted version that would otherwise be visible to it because
	 * the chain runs phi → audit. Strict mode does not need this — its
	 * `redactedPayloadHash` correctly hashes the post-redaction payload.
	 * Off mode bypasses the chain entirely.
	 *
	 * Optional so existing test sites that construct a bare context to
	 * exercise audit-only or phi-only middleware don't need a fourth field.
	 * `phi.outbound` always sets it; `audit.outbound` falls back to `req`
	 * when undefined (preserves the audit-only test path).
	 */
	rawRequestSnapshot?: Record<string, unknown>
	/**
	 * Per-request running buffer of restored note text, owned by `notePersist`.
	 * The streaming path emits one assistant message per `content_block_stop`,
	 * so a multi-block response (e.g., text → tool_use → text) calls the
	 * inbound chain three times. Without this buffer, each call would
	 * overwrite `currentNote` with only the latest block's text and earlier
	 * note sections would be lost. Lives on the per-attempt context so a
	 * retry naturally starts fresh (claude.ts allocates a new context object
	 * per `withRetry` callback invocation).
	 * @deprecated Use `noteValue` instead. This field is kept for backward
	 * compatibility and will be removed in Task 6.30.
	 */
	noteBuffer?: string
	/** Per-attempt section-parser state; carried across `content_block_stop` emits. */
	sectionState?: import('../agent/sectionParser.js').SectionParseState
	/** Per-attempt cumulative note value; replaces the legacy `noteBuffer` field. */
	noteValue?: import('../state/currentNote.js').CurrentNoteValue
}

const REDACTED_BRAND = Symbol('aegis.redacted')

export type RedactedAPIRequest = {
	readonly [REDACTED_BRAND]: true
} & Record<string, unknown>

export interface OutboundMiddleware<In = unknown, Out = unknown> {
	name: string
	process(req: In, ctx: MiddlewareContext): Promise<Out>
}

export interface InboundMiddleware<In = unknown, Out = unknown> {
	name: string
	process(res: In, ctx: MiddlewareContext): Promise<Out>
}

function markRedacted<T extends Record<string, unknown>>(payload: T): RedactedAPIRequest {
	Object.defineProperty(payload, REDACTED_BRAND, {
		value: true,
		enumerable: false,
		configurable: false,
		writable: false,
	})
	return payload as RedactedAPIRequest
}

/**
 * Unwrap the brand. ONLY allowed from `services/api/redactedSend.ts`.
 * Production code should never import this directly. (Lint rule + unit test.)
 */
export function unwrapRedacted<T extends Record<string, unknown>>(req: RedactedAPIRequest): T {
	if (typeof req !== 'object' || req === null || !(REDACTED_BRAND in req)) {
		throw new Error('unwrapRedacted: payload is not a branded RedactedAPIRequest')
	}
	return req as unknown as T
}

type TextBlock = { type: 'text'; text: string }
type ToolUseBlock = { type: 'tool_use'; input: unknown; [k: string]: unknown }
type ContentBlock = TextBlock | ToolUseBlock | { type: string; [k: string]: unknown }

/**
 * Visitor pattern over an Anthropic-shaped request. Every `string` field that
 * may carry PHI invokes `visit(text)` with a setter callback so the same
 * traversal handles both `collectStrings` (read) and `applyRedacted` (write).
 *
 * Covered carriers (kept in sync with the Anthropic SDK content-block union):
 *   - request.system: string | Array<{type:'text', text:string}>
 *   - request.messages[*].content: string | Array<ContentBlock>
 *       - {type:'text', text:string}
 *       - {type:'tool_result', content: string | Array<{type:'text', text:string}>}
 *       - {type:'tool_use', input: any}            // input serialized → redacted → reparsed
 *   - tool_use.input is JSON-serialized and treated as one blob
 *
 * **Refused carriers** (NOT silently passed — fail-closed at outbound entry):
 *   - {type:'document', source:{data:string}}        // PDF/clinical docs; base64
 *   - {type:'image',    source:{data:string}}        // screenshots / scanned forms
 *   - {type:'thinking', thinking:string, signature:string}   // extended-thinking trace
 *   - {type:'redacted_thinking', data:string}                // server-side encrypted thinking
 *
 * Presidio is text-only and has no signal on a base64-encoded PDF — but our
 * `FileReadTool` will happily attach a clinical PDF as a `document` block,
 * so a single drag-and-drop of a discharge summary would otherwise route raw
 * PHI to the model in strict/research mode. The two thinking variants are
 * refused for a related reason: when extended-thinking is enabled, the SDK
 * pattern is to replay prior `thinking` blocks back to the model on the next
 * turn (see Anthropic docs on "preserving thinking blocks"). The `thinking`
 * field is a free-form string that can carry PHI; without refusal here, a
 * future replay would ship raw PHI even though the original outbound was
 * redacted. `redacted_thinking` carries an opaque `data` field that we cannot
 * inspect; refuse for safety. M4 cannot add a real binary or thinking de-id
 * path inside this milestone; the safest default is to **refuse** outbound
 * dispatch when these blocks are present and let the clinician paste the
 * relevant text or wait for M5+ handling. The detection + throw lives in
 * `assertNoMediaBlocks` (called from outbound.process) rather than in
 * `visitTextCarriers` so the visitor stays a pure traversal.
 *
 * Anything not explicitly listed above is passed through unchanged. The
 * shape is asserted by `phiMiddleware.test.ts` so additions to the SDK
 * union surface as failing tests rather than silent leakage.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: exhaustive visitor for the full Anthropic SDK content-block union — structural complexity is intentional
function visitTextCarriers(
	req: Record<string, unknown>,
	visit: (text: string, setter: (next: string) => void) => void,
): void {
	// Top-level system
	if (typeof req.system === 'string') {
		visit(req.system, (s) => {
			req.system = s
		})
	} else if (Array.isArray(req.system)) {
		for (const b of req.system as ContentBlock[]) {
			if (b.type === 'text' && typeof (b as TextBlock).text === 'string') {
				const block = b as TextBlock
				visit(block.text, (s) => {
					block.text = s
				})
			}
		}
	}
	if (!Array.isArray(req.messages)) return
	for (const m of req.messages as Array<{ content: unknown }>) {
		if (typeof m.content === 'string') {
			visit(m.content, (s) => {
				m.content = s
			})
		} else if (Array.isArray(m.content)) {
			for (const b of m.content as ContentBlock[]) {
				if (b.type === 'text' && typeof (b as TextBlock).text === 'string') {
					const block = b as TextBlock
					visit(block.text, (s) => {
						block.text = s
					})
				} else if (b.type === 'tool_result') {
					const tr = b as unknown as { content: unknown }
					if (typeof tr.content === 'string') {
						visit(tr.content, (s) => {
							tr.content = s
						})
					} else if (Array.isArray(tr.content)) {
						for (const inner of tr.content as ContentBlock[]) {
							if (inner.type === 'text' && typeof (inner as TextBlock).text === 'string') {
								const ib = inner as TextBlock
								visit(ib.text, (s) => {
									ib.text = s
								})
							}
						}
					}
				} else if (b.type === 'tool_use') {
					const tu = b as ToolUseBlock
					// Serialize tool_use.input as a single JSON blob; downstream re-id
					// happens inbound on the corresponding tool_use the model emits.
					const serialized = JSON.stringify(tu.input ?? null)
					visit(serialized, (s) => {
						try {
							tu.input = JSON.parse(s)
						} catch {
							// If redaction broke the JSON shape (Presidio is text-only and
							// can split a key), fall back to storing the redacted string in
							// a wrapper so the LLM still sees the redaction marker. Unlikely
							// in practice — patient names/dates rarely live verbatim in
							// tool_use input — but the fallback ensures we never send raw.
							tu.input = { __aegis_redacted_string: s }
						}
					})
				}
				// document/image blocks intentionally NOT walked here — they are
				// refused at the outbound chain entry by `assertNoMediaBlocks`.
			}
		}
	}
}

/**
 * Refuse outbound dispatch when the request contains an `image`, `document`,
 * `thinking`, or `redacted_thinking` block. Walks the same carrier set as
 * `visitTextCarriers`. Throws a single Error with the offending block type +
 * message index so the caller (claude.ts outbound chain) can surface it to
 * the clinician. See the visitor doc comment for the full rationale.
 */
export type RefusedBlockType = 'image' | 'document' | 'thinking' | 'redacted_thinking'

const REFUSED_BLOCK_TYPES: ReadonlySet<string> = new Set<RefusedBlockType>([
	'image',
	'document',
	'thinking',
	'redacted_thinking',
])

export class MediaBlockRefusedError extends Error {
	readonly blockType: RefusedBlockType
	readonly messageIndex: number
	constructor(blockType: RefusedBlockType, messageIndex: number) {
		const isThinking = blockType === 'thinking' || blockType === 'redacted_thinking'
		const reason = isThinking
			? 'extended-thinking blocks may carry free-form PHI on replay (Anthropic SDK ' +
				`"preserving thinking blocks" pattern); the M4 text-only pipeline cannot ` +
				'safely re-redact them.'
			: 'binary blocks (PDF/image) cannot be de-identified by the M4 text-only pipeline.'
		const remedy = isThinking
			? 'Disable extended thinking for medical sessions, or set --phi-mode=off ' +
				'(with --allow-phi-off) for non-PHI prompts.'
			: 'Paste the relevant text into the prompt instead, or set --phi-mode=off ' +
				'(with --allow-phi-off) for non-PHI documents.'
		super(
			`phi.outbound: refusing to send a "${blockType}" block (message[${messageIndex}]) — ${reason} ${remedy}`,
		)
		this.name = 'MediaBlockRefusedError'
		this.blockType = blockType
		this.messageIndex = messageIndex
	}
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: mirrors visitTextCarriers descent for refused block detection — structural complexity is intentional
function assertNoMediaBlocks(req: Record<string, unknown>): void {
	if (!Array.isArray(req.messages)) return
	for (let i = 0; i < (req.messages as unknown[]).length; i++) {
		const m = (req.messages as Array<{ content: unknown }>)[i]
		if (!Array.isArray(m?.content)) continue
		for (const b of m.content as ContentBlock[]) {
			if (REFUSED_BLOCK_TYPES.has(b.type)) {
				throw new MediaBlockRefusedError(b.type as RefusedBlockType, i)
			}
			// Nested tool_result.content can also carry refused blocks
			// (some tools return media — uncommon today but allowed by the SDK
			// union). Mirror the visitor's tool_result descent.
			if (b.type === 'tool_result') {
				const tr = b as unknown as { content: unknown }
				if (Array.isArray(tr.content)) {
					for (const inner of tr.content as ContentBlock[]) {
						if (REFUSED_BLOCK_TYPES.has(inner.type)) {
							throw new MediaBlockRefusedError(inner.type as RefusedBlockType, i)
						}
					}
				}
			}
		}
	}
}

function collectStrings(req: Record<string, unknown>): string[] {
	const out: string[] = []
	visitTextCarriers(req, (text) => {
		out.push(text)
	})
	return out
}

function applyRedacted(req: Record<string, unknown>, redacted: readonly string[]): void {
	let i = 0
	visitTextCarriers(req, (_text, set) => {
		set(redacted[i++]!)
	})
	if (i !== redacted.length) {
		throw new Error(
			`phi.outbound: redacted slice length mismatch (got ${redacted.length}, applied ${i})`,
		)
	}
}

function reidentifyContentBlocks(
	blocks: readonly ContentBlock[],
	reidentify: (s: string) => Promise<string>,
): Promise<ContentBlock[]> {
	return Promise.all(
		blocks.map(async (b) => {
			if (b.type === 'text' && typeof (b as TextBlock).text === 'string') {
				return { ...b, text: await reidentify((b as TextBlock).text) }
			}
			if (b.type === 'tool_use') {
				const tu = b as ToolUseBlock
				const restored = JSON.parse(await reidentify(JSON.stringify(tu.input ?? null)))
				return { ...tu, input: restored }
			}
			return b
		}),
	)
}

export function createPhiMiddlewarePair(deid: DeIdentifier): {
	outbound: OutboundMiddleware<Record<string, unknown>, RedactedAPIRequest>
	inbound: InboundMiddleware<{
		message: { content: ContentBlock[] }
		[k: string]: unknown
	}>
} {
	const outbound: OutboundMiddleware<Record<string, unknown>, RedactedAPIRequest> = {
		name: 'phi.outbound',
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: phi.outbound orchestrates the full redaction pipeline — structural complexity is intentional
		async process(req, ctx) {
			// [M4 P1] Refuse PDF/image blocks before any text walk: M4's pipeline
			// is text-only and Presidio can't see PHI in base64. The text-string
			// assertions below would PASS on a request that contains nothing but
			// a clinical PDF — this guard makes the failure mode explicit.
			assertNoMediaBlocks(req)
			// [M4 P1 #4] Operate on a deep clone, NEVER the caller's reference.
			// claude.ts passes `params` from `paramsFromContext`, whose `system`
			// and `messages` arrays alias the queryModel-scoped `messagesForAPI`
			// across retries. Mutating those in place would mean attempt #2 sees
			// already-redacted text → empty mapping → inbound restore is a no-op
			// → the user is shown raw `<PERSON_1>` placeholders. Also: a
			// successful first attempt would corrupt the shared transcript blocks
			// and the next, unrelated turn's `messagesForAPI` would already carry
			// placeholders. structuredClone is deep + cheap for the typical
			// request size; falls back to JSON clone if the global is somehow
			// unavailable (older Node test runners).
			const cloner: (v: unknown) => unknown =
				typeof structuredClone === 'function'
					? (v) => structuredClone(v)
					: (v) => JSON.parse(JSON.stringify(v))
			// [M4 audit] The pre-redaction snapshot is just the (untouched)
			// caller reference — phi.outbound no longer mutates it. We still
			// hand audit a stable, plaintext-shaped object; cloning it again
			// is unnecessary and just doubles the deep-clone cost.
			ctx.rawRequestSnapshot = req
			const wire = cloner(req) as Record<string, unknown>
			const blobs = collectStrings(wire)
			if (blobs.length === 0) {
				ctx.phiMapping = { entries: {}, version: 'no-input' }
				return markRedacted(wire)
			}
			// Use redactBatch when available (McpDeIdentifier); fall back to per-blob.
			const dx = deid as DeIdentifier & {
				redactBatch?: (b: readonly string[]) => Promise<{
					redacted: string[]
					mapping: PhiMapping
				}>
			}
			let redacted: string[]
			let mapping: PhiMapping
			if (typeof dx.redactBatch === 'function') {
				const r = await dx.redactBatch(blobs)
				redacted = r.redacted
				mapping = r.mapping
			} else {
				// Per-blob fallback. Two failure modes a naïve `merged[k] = v` merge
				// exhibits, both fixed here:
				//
				//   (A) Different originals → same key. Blob A: John→<PERSON_1>;
				//       Blob B: Jane→<PERSON_1>. Naïve merge silently overwrites
				//       John with Jane, and inbound re-id substitutes the wrong
				//       identity. Fix: detect key collision with a DIFFERENT original
				//       and renumber the colliding entry into a private <__phi_N>
				//       namespace, rewriting that blob's text accordingly.
				//
				//   (B) Same original → different keys (the "split identity" bug
				//       found in review). Blob A: John→<PERSON_1>; Blob B: Jane→<P1>,
				//       John→<P2>. Without canonicalization John ends up bound to
				//       BOTH <PERSON_1> (from A) and <PERSON_2> (from B) — the LLM
				//       sees John under two placeholders in the same outbound
				//       request, violating the shared-placeholder-pool invariant.
				//       Fix: maintain `byOriginal: original→canonical-placeholder`
				//       and reuse the canonical placeholder when the same original
				//       reappears in a later blob, rewriting that blob's text.
				//
				// Implementation note (swap safety): when a blob requires more than
				// one rewrite (e.g., A: {John→<P1>, Jane→<P2>} + B: {Jane→<P1>,
				// John→<P2>}), naive sequential `replaceAll` collapses both
				// identities onto one placeholder. We therefore PLAN every per-blob
				// rewrite first into `oldKey→finalKey`, then apply via a two-pass
				// unique-marker swap (first pass: oldKey →  -marker; second
				// pass: marker → finalKey) so concurrent renames cannot interfere.
				redacted = []
				const merged: Record<
					string,
					{ type: PhiMapping['entries'][string]['type']; original: string }
				> = {}
				const byOriginal = new Map<string, string>()
				let version = 'unknown'
				let counter = 0
				for (const b of blobs) {
					const r = await deid.redact(b)
					version = r.mapping.version
					// Stable iteration: sort entries by key so renumbering is
					// deterministic across runs.
					const sortedEntries = Object.entries(r.mapping.entries).sort(([a], [c]) =>
						a.localeCompare(c),
					)
					// Plan phase — compute oldKey→finalKey rewrites without applying.
					const remap = new Map<string, string>()
					for (const [k, v] of sortedEntries) {
						const canonical = byOriginal.get(v.original)
						if (canonical !== undefined) {
							if (canonical !== k) remap.set(k, canonical)
							continue
						}
						// First time we've seen this original.
						if (!(k in merged)) {
							merged[k] = v
							byOriginal.set(v.original, k)
							continue
						}
						// Key already bound to a DIFFERENT original — renumber THIS one.
						let renamed: string
						do {
							renamed = `<__phi_${++counter}>`
						} while (renamed in merged)
						remap.set(k, renamed)
						merged[renamed] = v
						byOriginal.set(v.original, renamed)
					}
					// Apply phase — swap-safe two-pass via NUL-wrapped
					// markers. NUL (\u0000) is illegal in user-visible PHI text
					// and Anthropic-API JSON, so it is a safe collision-free sentinel
					// for the in-flight substitution. The marker string is written
					// as the \u0000 escape rather than raw NUL bytes so file(1)
					// and rg continue to classify this safety-critical middleware
					// as text and surface it in code searches.
					let blobText = r.redacted
					if (remap.size > 0) {
						const markers = new Map<string, string>()
						let tmpId = 0
						for (const [oldK] of remap) {
							const marker = `\u0000_phi_swap_${tmpId++}\u0000`
							markers.set(oldK, marker)
							blobText = blobText.replaceAll(oldK, marker)
						}
						for (const [oldK, newK] of remap) {
							blobText = blobText.replaceAll(markers.get(oldK)!, newK)
						}
					}
					redacted.push(blobText)
				}
				mapping = { entries: merged, version }
			}
			ctx.phiMapping = mapping
			applyRedacted(wire, redacted)
			return markRedacted(wire)
		},
	}

	const inbound: InboundMiddleware<{
		message: { content: ContentBlock[] }
		[k: string]: unknown
	}> = {
		name: 'phi.inbound',
		async process(res, ctx) {
			if (!ctx.phiMapping || Object.keys(ctx.phiMapping.entries).length === 0) {
				return res
			}
			const map = ctx.phiMapping
			const reidentify = (s: string) => deid.restore(s, map)
			const restored = await reidentifyContentBlocks(res.message.content, reidentify)
			return { ...res, message: { ...res.message, content: restored } }
		},
	}

	return { outbound, inbound }
}

/**
 * Test-only seam. Wraps `wire` with the same brand `markRedacted` produces
 * inside the outbound chain, so tests can construct a `RedactedAPIRequest`
 * without standing up a phi mapping, audit logger, and middleware chain
 * just to satisfy the brand. Underscore prefix follows the existing
 * convention (`__setKeytarForTest`, `__setAdapterForTest`, …). Production
 * code MUST NOT import this — the lint-equivalent grep test in Task 5.3
 * does not gate it because the prefix is already the project signal.
 */
export const __markRedactedForTest = markRedacted
