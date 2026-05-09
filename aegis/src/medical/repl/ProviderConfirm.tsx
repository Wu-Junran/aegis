import * as React from 'react'
import { Box, Text, useInput } from '../../ink.js'
import type { ProviderConfig } from '../providers/ProviderAdapter.js'

export type ProviderConfirmProps = {
	cfg: ProviderConfig
	onResolve: (r: { accepted: boolean }) => void
}

export function ProviderConfirm({ cfg, onResolve }: ProviderConfirmProps) {
	// Mirror ExportConfirm exactly (aegis/src/medical/repl/ExportConfirm.tsx
	// lines 124-139): only y/Y accepts; n/N/Escape rejects; Enter is
	// **not** an accept key. Treating Enter as accept would weaken the
	// strict-mode confirmation invariant — a user trained on Enter-to-
	// proceed (the most common reflex) could approve a provider switch
	// without explicitly typing Y. The `decided` guard prevents repeat
	// firings if the dialog stays mounted briefly after onResolve.
	const [decided, setDecided] = React.useState(false)
	useInput((input, key) => {
		if (decided) return
		if (input === 'y' || input === 'Y') {
			setDecided(true)
			onResolve({ accepted: true })
		} else if (input === 'n' || input === 'N' || key.escape) {
			setDecided(true)
			onResolve({ accepted: false })
		}
	})
	const c = cfg.capabilities
	return (
		<Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
			<Text color="yellow" bold>
				Switch active provider?
			</Text>
			<Text>id: {cfg.id}</Text>
			<Text>display: {cfg.displayName ?? cfg.id}</Text>
			<Text>baseURL: {cfg.baseURL ?? '(default)'}</Text>
			<Text>modelId: {cfg.modelId}</Text>
			<Text>
				caps: streaming={String(c.streaming)} toolUse={String(c.toolUse)} promptCache=
				{String(c.promptCache)} ctx={c.maxContextTokens}
			</Text>
			<Text> </Text>
			<Text>
				Add this provider to <Text color="cyan">.aegisrc allowlist</Text> to skip future prompts.
			</Text>
			<Text bold>Confirm switch? [Y]es / [N]o</Text>
		</Box>
	)
}
