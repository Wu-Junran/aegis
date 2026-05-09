import { type Aegisrc, loadAegisrc } from '../config/aegisrc.js'
import { getPhiMode } from '../runtime/phiMode.js'
import type { ProviderCapabilities, ProviderConfig, SessionProviderId } from './ProviderAdapter.js'

export type ProviderPreset = {
	id: SessionProviderId
	displayName: string
	defaultBaseURL?: string
	defaultModelId: string
	knownModels: string[]
	capabilities: ProviderCapabilities
}

export const PROVIDER_PRESETS: ReadonlyArray<ProviderPreset> = [
	{
		id: 'anthropic',
		displayName: 'Anthropic (claude-*)',
		defaultModelId: 'claude-opus-4-7',
		knownModels: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
		capabilities: {
			streaming: true,
			toolUse: true,
			promptCache: true,
			maxContextTokens: 1_000_000,
		},
	},
	{
		id: 'openai',
		displayName: 'OpenAI',
		defaultBaseURL: 'https://api.openai.com/v1',
		defaultModelId: 'gpt-5',
		knownModels: ['gpt-5', 'gpt-4o', 'gpt-4o-mini'],
		capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128_000 },
	},
	{
		id: 'glm',
		displayName: 'ZhipuAI GLM',
		defaultBaseURL: 'https://open.bigmodel.cn/api/paas/v4',
		defaultModelId: 'glm-4',
		knownModels: ['glm-4', 'glm-4-air', 'glm-4-flash'],
		capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128_000 },
	},
	{
		id: 'minimax',
		displayName: 'MiniMax',
		defaultBaseURL: 'https://api.minimaxi.chat/v1',
		defaultModelId: 'abab6.5-chat',
		knownModels: ['abab6.5-chat', 'abab6.5s-chat'],
		// `toolUse: false` for v1: the Minimax adapter does not yet parse
		// `function_call` (master plan §M5 5.8 left native protocols where
		// they meaningfully differ for follow-up). Honest signaling — the
		// picker shouldn't claim a capability the adapter can't deliver.
		// Flip to `true` when MinimaxAdapter.transformResponse is upgraded
		// (the cassette `cassette-minimax-tool-use.json` is the regression
		// target).
		//
		// **Minimax v1 is the explicit exception to Decision #11's "request
		// still carries tools" rule.** For OpenAI-family adapters
		// (OpenAI / GLM / openai-compatible), `toolUse: false` is purely
		// informative — outbound tool schemas are still translated to
		// `tools` and forwarded. Minimax v1 is different: the adapter has
		// no Anthropic→Minimax `functions` mapping yet, so passing the
		// schema as either `tools` (OAI shape) or `functions` (Minimax
		// shape) would either be silently ignored or rejected by the
		// upstream API. The v1 graceful-degrade contract is therefore
		// stricter — the adapter drops both `tools` AND `functions` from
		// the wire body. The matrix's Minimax tool-use branch pins this
		// with `expect(body.tools).toBeUndefined()` AND
		// `expect(body.functions).toBeUndefined()`. Do NOT widen this
		// preset's comment to "tools are still sent" — that would
		// re-introduce the exact regression `MinimaxAdapter.test.ts`'s
		// "drops the tools schema (v1 graceful-degrade contract)" case
		// is here to catch.
		capabilities: {
			streaming: true,
			toolUse: false,
			promptCache: false,
			maxContextTokens: 245_000,
		},
	},
	{
		id: 'openai-compatible',
		displayName: 'OpenAI-compatible (Together / Groq / OpenRouter / Ollama / vLLM)',
		defaultModelId: 'auto',
		knownModels: ['auto'],
		capabilities: { streaming: true, toolUse: false, promptCache: false, maxContextTokens: 32_000 },
	},
]

// ─────────────────────────────────────────────────────────────────────
// Shared overlay helpers — both `/provider set` and the two-level `/model`
// picker MUST go through these so `.aegisrc.providers[id]` (baseURL,
// modelId, knownModels) reaches the adapter. Without this, an operator
// who sets `~/.aegisrc.providers.openai-compatible.baseURL = "http://..."`
// would see their override silently ignored. (Imports for `ProviderConfig`,
// `loadAegisrc`, `Aegisrc`, and `getPhiMode` are at the top of the file.)
// ─────────────────────────────────────────────────────────────────────

export function buildProviderConfigFromPreset(
	preset: ProviderPreset,
	rc?: Aegisrc,
): ProviderConfig {
	const entry = (rc ?? loadAegisrc()).providers[preset.id] ?? {}
	return {
		id: preset.id,
		displayName: preset.displayName,
		baseURL: entry.baseURL ?? preset.defaultBaseURL,
		modelId: entry.modelId ?? preset.defaultModelId,
		capabilities: preset.capabilities,
	}
}

/**
 * Pre-flight check applied at COMMAND TIME, before any AppState write.
 * Both `/provider set` and the two-level `/model` picker MUST call this
 * before writing `currentProvider`. Two gates currently fire (in order):
 *
 *   (1) Off-mode refusal (Decision #8). When `getPhiMode() === 'off'`,
 *       claude.ts:queryModel bypasses redactedSend.ts (where the M5
 *       dispatch fork lives) and reads `mainLoopModel`, so writes to
 *       `currentProvider` — including its `modelId` — never reach the
 *       SDK. We refuse ALL provider switching in off mode (no anthropic
 *       exception) to prevent a silent dispatch-vs-state mismatch. The
 *       remediation message points at the LAUNCH FLAG (`--phi-mode=…`)
 *       because `/phi-mode` is read-only at runtime. `/provider clear`
 *       remains allowed in off mode (it reverts to the legacy default).
 *
 *   (2) openai-compatible config validity. The generic preset has no
 *       defaultBaseURL and a placeholder `auto` modelId — applying it
 *       un-customized would let dispatch fail at request time, after the
 *       user had already "successfully" switched provider. We require
 *       `.aegisrc.providers."openai-compatible"` to supply both fields.
 *
 * Other presets in non-off modes ship sane defaults and pass through.
 * When extending, add new gates ABOVE the openai-compatible one — the
 * off-mode gate is the broadest scope and should always run first.
 */
export function validateProviderConfigForApply(
	cfg: ProviderConfig,
): { ok: true } | { ok: false; reason: string } {
	// Decision #8: refuse ALL provider switching in `off` mode (no anthropic
	// exception). claude.ts:queryModel short-circuits past redactedSend
	// (where the dispatch fork lives) when getPhiMode() === 'off' and uses
	// `mainLoopModel`, so writes to `currentProvider` — including its
	// `modelId` — never reach the SDK. Letting any `/provider set` succeed
	// would be a silent dispatch-vs-state mismatch. The remediation points
	// at the LAUNCH FLAG, not `/phi-mode set` — phi-mode.tsx is read-only at
	// runtime ("PHI mode is launch-time only. Restart aegis with
	// --phi-mode=<strict|research|off>."), so any "run /phi-mode research"
	// instruction would dead-end the user. `getPhiMode` is the public read
	// seam from `aegis/src/medical/runtime/phiMode.ts`; tests drive it via
	// `setPhiModeFromCli` + `__resetPhiModeForTests`.
	if (getPhiMode() === 'off') {
		return {
			ok: false,
			reason:
				'Provider switching is disabled in `--phi-mode=off`. In off mode, ' +
				'`claude.ts` bypasses `redactedSend.ts` (where the M5 dispatch fork lives) ' +
				'and reads `mainLoopModel` instead of `currentProvider`, so any ' +
				'`/provider set` write would silently fail to take effect. ' +
				'Restart aegis with `--phi-mode=research` or `--phi-mode=strict` ' +
				'(`/phi-mode` is read-only at runtime). `/provider clear` remains ' +
				'allowed in off mode if you want to revert to the legacy default.',
		}
	}
	// Preset-specific gate FIRST for openai-compatible: this case has TWO
	// distinct failure modes (no baseURL, placeholder modelId) that the
	// operator typically hits TOGETHER when activating without a `.aegisrc`
	// overlay. Surfacing both in one message ("requires both `baseURL` and a
	// concrete `modelId`") is the better diagnostic — listing only one would
	// leave the user to discover the other on the next attempt.
	if (cfg.id === 'openai-compatible') {
		const hasBaseURL = typeof cfg.baseURL === 'string' && cfg.baseURL.length > 0
		const hasConcreteModel =
			typeof cfg.modelId === 'string' && cfg.modelId.length > 0 && cfg.modelId !== 'auto'
		if (!hasBaseURL || !hasConcreteModel) {
			return {
				ok: false,
				reason:
					`Preset "openai-compatible" requires both \`baseURL\` and a concrete \`modelId\` ` +
					`(the preset placeholder "auto" is not a real model). ` +
					`Configure them in \`.aegisrc\` under \`providers."openai-compatible"\` before activating, e.g.:\n` +
					`  { "providers": { "openai-compatible": { "baseURL": "http://localhost:8000/v1", "modelId": "Qwen/Qwen2.5-7B-Instruct" } } }`,
			}
		}
	}
	// Universal placeholder refusal for the OTHER presets (anthropic / openai /
	// glm / minimax): `'auto'` is the shape we ship to mean "operator hasn't
	// filled this in yet" and is not a real model on any provider. Without
	// this gate, an operator who activated, say, `anthropic` and then ran
	// `/model auto` would silently set `currentProvider.modelId = 'auto'`
	// after a "Set provider model to auto." confirmation — the exact bug
	// reproduced manually in /tmp/aegis-m5-manual. The openai-compatible
	// branch above already catches the placeholder for that preset (with a
	// more complete message about baseURL too), so this branch only fires
	// for the others.
	if (cfg.modelId === 'auto') {
		return {
			ok: false,
			reason: `"auto" is a preset placeholder for "${cfg.id}", not a real model id. Pick a concrete model id (e.g. \`/model claude-opus-4-7\` or \`/model gpt-4o\`), or set \`providers."${cfg.id}".modelId\` in \`.aegisrc\` before activating.`,
		}
	}
	return { ok: true }
}

export function effectiveKnownModels(preset: ProviderPreset, rc?: Aegisrc): string[] {
	const entry = (rc ?? loadAegisrc()).providers[preset.id] ?? {}
	return entry.knownModels ?? preset.knownModels
}

export function formatProviderCaps(p: ProviderPreset): string {
	const c = p.capabilities
	return `streaming=${c.streaming} tool=${c.toolUse} cache=${c.promptCache} ctx=${c.maxContextTokens}`
}
