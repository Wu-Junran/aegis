import { test, expect, beforeEach } from 'bun:test'
import {
	createAuditOutbound,
	createAuditInbound,
} from '../../../../src/medical/middleware/auditMiddleware.js'
import {
	setSessionProvider,
} from '../../../../src/services/api/sessionProvider.js'
import { sha256Hex } from '../../../../src/medical/audit/redaction.js'

class CapturingLogger {
	entries: any[] = []
	async append(e: any) { this.entries.push(e) }
	async close() {}
}

beforeEach(() => setSessionProvider(null))

// Both modes are tested end-to-end. `auditMiddleware.ts` has separate
// object literals for the strict and research branches in BOTH outbound
// and inbound (Step 6 below adds `provider` to all four literals); a
// research-only test would let a worker forget `provider` in any of the
// strict literals and still pass. We loop over both modes and the
// session vs. no-session axis to lock down all six (mode × site)
// combinations.
const MODES: Array<'strict' | 'research'> = ['strict', 'research']

for (const mode of MODES) {
	test(`outbound (${mode}): provider="anthropic-legacy" when no session`, async () => {
		const logger = new CapturingLogger()
		const mw = createAuditOutbound(logger as any, mode)
		await mw.process({ model: 'claude-opus-4-7' } as any, { requestId: 'r1' } as any)
		expect(logger.entries[0].type).toBe('llm_request')
		expect(logger.entries[0].mode).toBe(mode)
		expect(logger.entries[0].provider).toBe('anthropic-legacy')
	})

	test(`outbound (${mode}): provider="<id>" when session is set`, async () => {
		setSessionProvider({
			id: 'openai',
			modelId: 'gpt-5',
			capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128000 },
		})
		const logger = new CapturingLogger()
		const mw = createAuditOutbound(logger as any, mode)
		await mw.process({ model: 'gpt-5' } as any, { requestId: 'r1' } as any)
		expect(logger.entries[0].type).toBe('llm_request')
		expect(logger.entries[0].mode).toBe(mode)
		expect(logger.entries[0].provider).toBe('openai')
	})

	test(`inbound (${mode}): provider stamped on llm_response`, async () => {
		setSessionProvider({
			id: 'glm',
			modelId: 'glm-4',
			capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128000 },
		})
		const logger = new CapturingLogger()
		const mw = createAuditInbound(logger as any, mode)
		await mw.process({ message: { usage: {} }, warnings: [] } as any, { requestId: 'r1' } as any)
		expect(logger.entries[0].type).toBe('llm_response')
		expect(logger.entries[0].mode).toBe(mode)
		expect(logger.entries[0].provider).toBe('glm')
	})
}

// ───────────────────────────────────────────────────────────────────────
// Effective-model audit pinning (P1 fix). `redactedSend.ts` overrides
// `params.model` with `session.modelId` BEFORE dispatch (the single
// canonical override site). Pre-fix, `audit.outbound` ran on the
// pre-override request, so an OpenAI/GLM/Minimax session would log
//
//     provider=openai, model=claude-opus-4-7
//
// with a `redactedPayloadHash` computed over a request that was never
// sent on the wire. These tests pin both the top-level `model` field
// AND the hashed payload to the effective (session) model. Bidirectional:
// without the fix the strict-mode hash assertion fails because the hash
// is over the pre-override JSON, and the model-field assertion fails
// because audit returns the legacy model.
// ───────────────────────────────────────────────────────────────────────

test('outbound (strict): model + hash reflect session.modelId, not pre-override req.model', async () => {
	setSessionProvider({
		id: 'openai',
		modelId: 'gpt-5',
		capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128000 },
	})
	const logger = new CapturingLogger()
	const mw = createAuditOutbound(logger as any, 'strict')
	// The pre-dispatch request still carries the legacy Anthropic model
	// — which is exactly the scenario `redactedSend.ts` overrides for.
	// Audit must record `gpt-5` (the effective wire model), and the
	// hash must be computed over the override-applied payload.
	const req = { model: 'claude-opus-4-7', max_tokens: 256, messages: [] }
	await mw.process(
		req as any,
		{ requestId: 'r1', phiMapping: { entries: {}, version: 'v1' } } as any,
	)
	expect(logger.entries[0].provider).toBe('openai')
	expect(logger.entries[0].model).toBe('gpt-5')
	const expectedHash = sha256Hex(
		JSON.stringify({ model: 'gpt-5', max_tokens: 256, messages: [] }),
	)
	expect(logger.entries[0].redactedPayloadHash).toBe(expectedHash)
	// Defensive: the hash MUST NOT be the pre-override one. If both the
	// effective-model and pre-override hashes happened to match (e.g.
	// future test churn), the next assertion catches the regression.
	const preOverrideHash = sha256Hex(JSON.stringify(req))
	expect(logger.entries[0].redactedPayloadHash).not.toBe(preOverrideHash)
})

test('outbound (research): fullRequest.model reflects session.modelId', async () => {
	setSessionProvider({
		id: 'glm',
		modelId: 'glm-4-air',
		capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128000 },
	})
	const logger = new CapturingLogger()
	const mw = createAuditOutbound(logger as any, 'research')
	const req = { model: 'claude-opus-4-7' }
	const rawSnapshot = { model: 'claude-opus-4-7', messages: [{ role: 'user', content: 'hi' }] }
	await mw.process(
		req as any,
		{ requestId: 'r1', rawRequestSnapshot: rawSnapshot } as any,
	)
	expect(logger.entries[0].model).toBe('glm-4-air')
	expect(logger.entries[0].fullRequest.model).toBe('glm-4-air')
	// Other fields of the snapshot are preserved (only `model` is overridden).
	expect(logger.entries[0].fullRequest.messages).toEqual(rawSnapshot.messages)
})

test('outbound (strict): legacy/no-session path keeps req.model unchanged in record + hash', async () => {
	// No setSessionProvider call here — beforeEach resets to null.
	const logger = new CapturingLogger()
	const mw = createAuditOutbound(logger as any, 'strict')
	const req = { model: 'claude-opus-4-7', max_tokens: 256 }
	await mw.process(
		req as any,
		{ requestId: 'r1', phiMapping: { entries: {}, version: 'v1' } } as any,
	)
	expect(logger.entries[0].provider).toBe('anthropic-legacy')
	expect(logger.entries[0].model).toBe('claude-opus-4-7')
	expect(logger.entries[0].redactedPayloadHash).toBe(sha256Hex(JSON.stringify(req)))
})
