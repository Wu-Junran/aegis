import { useState } from 'react'
import { Box, Text, useInput } from '../../ink.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import type { SessionProviderId } from '../providers/ProviderAdapter.js'
import { saveCredential } from '../providers/credentials.js'

type Props = {
	providerId: SessionProviderId
	onDone: LocalJSXCommandOnDone
}

/**
 * Masked-input dialog for /provider creds <id>. The buffer is held in local
 * state and never echoed; we render `*` chars to confirm typing without
 * exposing the secret. Enter submits → saveCredential. Esc aborts.
 *
 * Why not accept the key as a CLI arg: the REPL history, transcript, and
 * the M4 audit log all see command tokens. Inline secrets would leak.
 */
export function CredsPaste({ providerId, onDone }: Props) {
	const [buffer, setBuffer] = useState('')
	const [phase, setPhase] = useState<'typing' | 'saving' | 'done'>('typing')
	useInput((input, key) => {
		if (phase !== 'typing') return
		if (key.escape) {
			setPhase('done')
			onDone(`Credential entry for "${providerId}" cancelled.`, { display: 'system' })
			return
		}
		if (key.return) {
			if (buffer.length < 8) {
				onDone(`Credential rejected: too short (${buffer.length} chars). Aborted.`, {
					display: 'system',
				})
				setPhase('done')
				return
			}
			setPhase('saving')
			saveCredential(providerId, buffer)
				.then(() =>
					onDone(`Credential for "${providerId}" stored in keychain.`, { display: 'system' }),
				)
				.catch((e) =>
					onDone(`Failed to store credential: ${(e as Error).message}`, { display: 'system' }),
				)
				.finally(() => setPhase('done'))
			return
		}
		if (key.backspace || key.delete) {
			setBuffer((b) => b.slice(0, -1))
			return
		}
		if (input && input.length > 0 && !key.ctrl && !key.meta) {
			setBuffer((b) => b + input)
		}
	})
	if (phase === 'done') return null
	const masked = '*'.repeat(buffer.length)
	return (
		<Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
			<Text color="cyan" bold>
				Paste credential for: {providerId}
			</Text>
			<Text dimColor>Input is masked; nothing is logged. Enter to save, Esc to cancel.</Text>
			<Text>key: {masked || '(empty)'}</Text>
			<Text dimColor>{phase === 'saving' ? 'saving...' : ' '}</Text>
		</Box>
	)
}
