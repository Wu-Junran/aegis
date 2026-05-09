import * as React from 'react'
import { Select } from '../../components/CustomSelect/index.js'
import { Box, Text } from '../../ink.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { PROVIDER_PRESETS, type ProviderPreset } from '../providers/presets.js'

export type ProviderSelectProps = {
	onPick: (preset: ProviderPreset) => void
	onCancel?: () => void
}

/**
 * Shorten an unbounded display string so it fits a fixed column when shown
 * inline in the picker. Trims at the first parenthesis (where presets like
 * "OpenAI-compatible (Together / Groq / OpenRouter / Ollama / vLLM)" pack
 * their >50-char examples list) and falls back to a hard-cut for any other
 * over-budget string.
 *
 * Why we trim instead of relying on Ink's wrapping: the previous picker
 * passed the caps string to `Select`'s `description` prop. Ink/Yoga laid
 * the label and description in a column container, but the row that holds
 * the indicator + label has `flexDirection="row"`; when the label was wide
 * enough to consume the row's available width, the description Box that
 * Ink rendered next to it ended up in a 2-column-wide residual area and
 * wrapped char-by-char into a vertical strip on the right edge of the
 * terminal (the layout regression you saw). Keeping the label to a bounded
 * width sidesteps the constraint propagation entirely.
 */
function bound(s: string, max: number): string {
	const head = s.split(' (')[0]
	const candidate = head ?? s
	if (candidate.length <= max) return candidate
	return `${candidate.slice(0, max - 1)}…`
}

export function ProviderSelect({ onPick, onCancel }: ProviderSelectProps) {
	const options = React.useMemo(
		// Single-line label with hard column widths and no `description`. The
		// caps (streaming/tool/cache/ctx) are still available in `/provider
		// list` where the layout is plain text and there is no constraint
		// propagation; the picker only needs to identify each preset.
		() =>
			PROVIDER_PRESETS.map((p) => ({
				value: p.id,
				label: `${p.id.padEnd(20)} ${bound(p.displayName, 30)}`,
			})),
		[],
	)
	return (
		<Box flexDirection="column">
			<Text dimColor>legacy: {getAPIProvider()} (read-only)</Text>
			<Text bold>Select provider:</Text>
			<Select
				options={options}
				onChange={(value: string) => {
					const preset = PROVIDER_PRESETS.find((p) => p.id === value)
					if (preset) onPick(preset)
				}}
				onCancel={() => onCancel?.()}
				visibleOptionCount={Math.min(PROVIDER_PRESETS.length, 8)}
			/>
			<Text dimColor>(run /provider list for capabilities)</Text>
		</Box>
	)
}
