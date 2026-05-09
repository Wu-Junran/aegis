import * as React from 'react'
import { useState } from 'react'
import type { LocalJSXCommandCall, LocalJSXCommandOnDone } from '../../types/command.js'
import { useSetAppState } from '../../state/AppState.js'
import { PROVIDER_PRESETS, buildProviderConfigFromPreset, validateProviderConfigForApply, formatProviderCaps } from '../../medical/providers/presets.js'
import { loadAegisrc } from '../../medical/config/aegisrc.js'
import {
	hasConfirmedProvider,
	markProviderConfirmed,
} from '../../services/api/sessionProvider.js'
import { ProviderConfirm } from '../../medical/repl/ProviderConfirm.js'
import { CredsPaste } from '../../medical/repl/CredsPaste.js'
import type { ProviderConfig, SessionProviderId } from '../../medical/providers/ProviderAdapter.js'

type OnDone = LocalJSXCommandOnDone

export const call: LocalJSXCommandCall = async (onDone, _ctx, rawArgs) => {
	const args = rawArgs.trim().split(/\s+/).filter((x) => x.length > 0)
	const sub = args[0] ?? 'list'
	if (sub === 'list') return renderList(onDone)
	if (sub === 'set') return renderSet(onDone, args[1] as SessionProviderId | undefined)
	if (sub === 'clear') return <ApplyClear onDone={onDone} />
	if (sub === 'creds') return renderCreds(onDone, args[1] as SessionProviderId | undefined, args.slice(2))
	onDone(`Usage: /provider [list | set <id> | clear | creds <id>]`, { display: 'system' })
	return null
}

function renderList(onDone: OnDone) {
	const allow = new Set(loadAegisrc().allowlist)
	const lines = PROVIDER_PRESETS.map((p) => {
		const tag = allow.has(p.id) ? '[allow]' : '       '
		return `${tag} ${p.id.padEnd(20)} ${p.displayName.padEnd(40)} (${formatProviderCaps(p)})`
	})
	onDone(['Configured providers:', ...lines].join('\n'), { display: 'system' })
	return null
}

function renderSet(onDone: OnDone, idArg: SessionProviderId | undefined) {
	if (!idArg) {
		onDone('Usage: /provider set <id>', { display: 'system' })
		return null
	}
	const preset = PROVIDER_PRESETS.find((p) => p.id === idArg)
	if (!preset) {
		onDone(`Unknown provider "${idArg}". Run /provider list.`, { display: 'system' })
		return null
	}
	const rc = loadAegisrc()
	const allow = new Set(rc.allowlist)
	const cfg = buildProviderConfigFromPreset(preset, rc) // overlays .aegisrc.providers[id]
	// Config-validity pre-flight (Decision #4 corollary): refuse before any
	// UI mount when the merged cfg cannot reach a real endpoint. This is
	// the openai-compatible-without-`.aegisrc` case — the preset has no
	// defaultBaseURL and `modelId: 'auto'`, so applying it would let
	// dispatch fail later. Block at the entry point instead, so the user
	// gets a remediation message instead of a "switch succeeded" lie.
	const valid = validateProviderConfigForApply(cfg)
	if (!valid.ok) {
		onDone(valid.reason, { display: 'system' })
		return null
	}
	if (allow.has(preset.id) || hasConfirmedProvider(preset.id)) {
		return <ApplyProvider cfg={cfg} onDone={onDone} />
	}
	return <ConfirmAndApply cfg={cfg} onDone={onDone} />
}

function ApplyProvider({ cfg, onDone }: { cfg: ProviderConfig; onDone: OnDone }) {
	const setApp = useSetAppState()
	React.useEffect(() => {
		setApp((s) => ({ ...s, currentProvider: cfg }))
		markProviderConfirmed(cfg.id)
		onDone(`Provider set to "${cfg.id}" (${cfg.displayName}). Model: ${cfg.modelId}.`, { display: 'system' })
	}, [])
	return null
}

function ApplyClear({ onDone }: { onDone: OnDone }) {
	const setApp = useSetAppState()
	React.useEffect(() => {
		setApp((s) => ({ ...s, currentProvider: null }))
		onDone('Provider cleared. Falling back to legacy ANTHROPIC dispatch.', { display: 'system' })
	}, [])
	return null
}

function ConfirmAndApply({ cfg, onDone }: { cfg: ProviderConfig; onDone: OnDone }) {
	const [phase, setPhase] = useState<'asking' | 'done'>('asking')
	const setApp = useSetAppState()
	if (phase === 'done') return null
	return (
		<ProviderConfirm
			cfg={cfg}
			onResolve={({ accepted }) => {
				if (!accepted) {
					onDone(`Provider switch to "${cfg.id}" cancelled.`, { display: 'system' })
				} else {
					setApp((s) => ({ ...s, currentProvider: cfg }))
					markProviderConfirmed(cfg.id)
					onDone(`Provider set to "${cfg.id}" (${cfg.displayName}). Model: ${cfg.modelId}.`, { display: 'system' })
				}
				setPhase('done')
			}}
		/>
	)
}

function renderCreds(onDone: OnDone, idArg: SessionProviderId | undefined, extraArgs: string[]) {
	if (!idArg) {
		onDone('Usage: /provider creds <id>  (you will be prompted to paste the key — it is NOT echoed)', { display: 'system' })
		return null
	}
	// Inline-secret rejection runs FIRST, before any provider-specific
	// branches. Once `extraArgs.length > 0`, the secret has already
	// landed in REPL history / transcript / audit log tokens, regardless
	// of whether `idArg` is `anthropic`, an unknown id, or a real
	// preset. Earlier draft put the `idArg === 'anthropic'` and unknown-
	// id branches first, which let `/provider creds anthropic sk-...`
	// fall through with only the OAuth message — silently swallowing the
	// leak warning. The rejection MUST fire even for invalid ids.
	if (extraArgs.length > 0) {
		// Both `idArg` and `extraArgs` may be the user's pasted secret —
		// e.g. `/provider creds sk-LEAK extra` puts the secret in the id
		// position. Echoing either back would land the secret in REPL
		// history / transcript / audit log. Use a fully generic message.
		onDone(
			`/provider creds does not accept the key as an argument (it would be logged). ` +
				`Run "/provider creds <provider-id>" with no extra args; you will be prompted to paste it.`,
			{ display: 'system' },
		)
		return null
	}
	if (idArg === 'anthropic') {
		onDone('Anthropic credentials are managed via the existing OAuth / ANTHROPIC_API_KEY paths.', { display: 'system' })
		return null
	}
	// Validate against the preset registry BEFORE mounting the masked
	// prompt. Without this, `/provider creds typo` would happily accept
	// a key and write it to keytar under the bogus account, producing a
	// misleading "stored in keychain" success path that no adapter ever
	// reads. **Do NOT echo `idArg` in this message** — `/provider creds sk-...`
	// (one token, the secret in the id position) lands here too, so an
	// echo would leak the secret to REPL history / transcript / audit log.
	// `renderSet`'s unknown-id message can echo because that subcommand
	// rejects extraArgs upstream and doesn't have the "secret in the id
	// position" failure mode; `renderCreds` does.
	if (!PROVIDER_PRESETS.find((p) => p.id === idArg)) {
		onDone(`Unknown provider id. Run /provider list to see valid ids.`, { display: 'system' })
		return null
	}
	return <CredsPaste providerId={idArg} onDone={onDone} />
}
