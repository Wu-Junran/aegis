import type * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { ValidatorWarning } from '../state/validatorWarnings.js'

export function ValidatorBanner({
	warnings,
}: {
	warnings: readonly ValidatorWarning[]
}): React.ReactNode {
	if (warnings.length === 0) return null
	return (
		<Box flexDirection="column">
			{warnings.map((w) => (
				<Text
					key={`${w.check}:${w.severity}:${w.message}`}
					color={w.severity === 'warn' ? 'yellow' : 'gray'}
				>
					{`⚠ ${w.check}: ${w.message}`}
				</Text>
			))}
		</Box>
	)
}
