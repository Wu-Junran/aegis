import type * as React from 'react'
import { Box, Text } from '../../ink.js'
import { getPhiMode } from '../runtime/phiMode.js'

export function PhiModeBanner(): React.ReactNode {
	const mode = getPhiMode()
	if (mode === 'strict') {
		return (
			<Box paddingX={1}>
				<Text dimColor>[strict] PHI middleware enforced</Text>
			</Box>
		)
	}
	if (mode === 'research') {
		return (
			<Box paddingX={1}>
				<Text color="yellow">[research] middleware active; payloads logged in plaintext</Text>
			</Box>
		)
	}
	return (
		<Box paddingX={1}>
			<Text color="red" bold>
				[off ⚠] PHI middleware DISABLED — pure Claude Code behavior
			</Text>
		</Box>
	)
}
