import { getSessionProvider } from '../../services/api/sessionProvider.js'
import type { AuditLogger, PhiMode } from '../audit/AuditLogger.js'
import { entityCountsFromMapping, entityHashesFromMapping, sha256Hex } from '../audit/redaction.js'
import { ANTHROPIC_LEGACY_PROVIDER_ID } from '../providers/ProviderAdapter.js'
import type { InboundMiddleware, OutboundMiddleware } from './phiMiddleware.js'

export function createAuditOutbound(
	logger: AuditLogger,
	mode: PhiMode,
): OutboundMiddleware<Record<string, unknown>, Record<string, unknown>> {
	return {
		name: 'audit.outbound',
		async process(req, ctx) {
			const ts = new Date().toISOString()
			const session = getSessionProvider()
			const provider = session?.id ?? ANTHROPIC_LEGACY_PROVIDER_ID
			// When a session provider is active, `redactedSend.ts` overrides
			// `params.model` with `session.modelId` BEFORE dispatch (the single
			// canonical override site, applied uniformly across adapters). The
			// audit record must reflect that effective wire model — both the
			// top-level `model` field AND, in strict mode, the hashed payload
			// — otherwise an OpenAI/GLM/Minimax session would log
			// `provider=<id>` paired with the pre-override Anthropic model and
			// a hash computed over a request that was never sent. We do NOT
			// mutate `req` itself: the production override stays in
			// `redactedSend.ts` so there remains exactly one override site.
			const effectiveModel: string | null = session
				? session.modelId
				: ((req.model as string | null | undefined) ?? null)
			const effectiveReq = session ? { ...req, model: session.modelId } : req
			if (mode === 'strict') {
				const mapping = ctx.phiMapping ?? { entries: {}, version: 'unknown' }
				await logger.append({
					ts,
					type: 'llm_request',
					requestId: ctx.requestId,
					mode,
					provider,
					model: effectiveModel,
					deidVersion: mapping.version,
					redactedPayloadHash: sha256Hex(JSON.stringify(effectiveReq)),
					phiEntityCounts: entityCountsFromMapping(mapping),
					phiHashes: entityHashesFromMapping(mapping),
				})
			} else {
				// research mode: write the PLAINTEXT request, not the redacted one.
				// The chain runs `phi.outbound` first, mutating `req` in place, so
				// by the time we see it `req` has placeholders. Read the raw
				// snapshot phi.outbound stashed in ctx; fall back to `req` only if
				// somehow unset (off-mode bypass should never reach here, since
				// off mode short-circuits chain construction). Apply the same
				// session-model override to `fullRequest` so the research-mode
				// audit log records the actual wire model, not the legacy model
				// the request was constructed with.
				const rawSnapshot = ctx.rawRequestSnapshot ?? req
				const fullRequest = session ? { ...rawSnapshot, model: session.modelId } : rawSnapshot
				await logger.append({
					ts,
					type: 'llm_request',
					requestId: ctx.requestId,
					mode,
					provider,
					model: effectiveModel,
					fullRequest,
				})
			}
			return req
		},
	}
}

export function createAuditInbound(
	logger: AuditLogger,
	mode: PhiMode,
): InboundMiddleware<Record<string, unknown>, Record<string, unknown>> {
	return {
		name: 'audit.inbound',
		async process(res, ctx) {
			const ts = new Date().toISOString()
			const provider = getSessionProvider()?.id ?? ANTHROPIC_LEGACY_PROVIDER_ID
			const message = (res as { message?: Record<string, unknown> }).message
			const usage = message?.usage ?? null
			const warnings = (res as { warnings?: unknown[] }).warnings ?? []
			if (mode === 'strict') {
				await logger.append({
					ts,
					type: 'llm_response',
					requestId: ctx.requestId,
					mode,
					provider,
					usage,
					warningCount: warnings.length,
				})
			} else {
				await logger.append({
					ts,
					type: 'llm_response',
					requestId: ctx.requestId,
					mode,
					provider,
					usage,
					warningCount: warnings.length,
					fullResponse: res,
				})
			}
			return res
		},
	}
}
