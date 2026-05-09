import * as React from 'react'
import { Select } from '../../components/CustomSelect/index.js'
import { Box, Text } from '../../ink.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { type ProviderPreset, effectiveKnownModels } from '../providers/presets.js'

export type ProviderScopedModelPickerProps = {
	preset: ProviderPreset
	/**
	 * Pre-selected model. Caller should pass the configured cfg.modelId
	 * (which already has `.aegisrc.providers[id].modelId` overlaid by
	 * `buildProviderConfigFromPreset`) so pressing Enter without arrow
	 * keys keeps the configured choice. Falls back to the first known
	 * model, then the preset default.
	 */
	defaultModelId?: string
	onSelect: (modelId: string) => void
	onCancel?: () => void
}

export function ProviderScopedModelPicker({
	preset,
	defaultModelId,
	onSelect,
	onCancel,
}: ProviderScopedModelPickerProps) {
	// Honor `.aegisrc.providers[id].knownModels` overlay so a self-hosted
	// vLLM/Ollama operator with `knownModels: ['llama-3-70b', ...]` sees
	// their models in the picker, not the preset's `['auto']` placeholder.
	const models = React.useMemo(() => effectiveKnownModels(preset), [preset])
	// If the caller's defaultModelId isn't in `knownModels` (e.g. user set
	// `.aegisrc.providers.openai-compatible.modelId = 'mixtral-8x22b'` but
	// didn't list it in `knownModels`), surface it as a synthetic first
	// option so Enter still preserves it instead of silently rewriting.
	const options = React.useMemo(() => {
		const base = models.map((m) => ({ value: m, label: m }))
		if (defaultModelId && !models.includes(defaultModelId)) {
			return [{ value: defaultModelId, label: `${defaultModelId} (configured)` }, ...base]
		}
		return base
	}, [models, defaultModelId])
	const initial = defaultModelId ?? models[0] ?? preset.defaultModelId
	return (
		<Box flexDirection="column">
			<Text dimColor>
				legacy: {getAPIProvider()} provider: {preset.id}
			</Text>
			<Text bold>Select model for {preset.displayName}:</Text>
			{/*
				CustomSelect (`aegis/src/components/CustomSelect/select.tsx`)
				splits "what is selected on Enter" from "what option is
				focused on render": `defaultValue` only seeds internal `value`
				state, while `defaultFocusValue` drives which row is
				highlighted at startup. On Enter the picker calls
				`selectFocusedOption()`, which OVERWRITES `value` with
				`focusedValue` — so omitting `defaultFocusValue` makes Enter
				return `options[0]` regardless of `defaultValue`. Both props
				MUST point at `initial` so a user pressing Enter without
				navigating keeps the configured model (the case the
				`(configured)` synthetic option exists to serve).
			*/}
			<Select
				options={options}
				defaultValue={initial}
				defaultFocusValue={initial}
				onChange={(value: string) => onSelect(value)}
				onCancel={() => onCancel?.()}
				visibleOptionCount={Math.min(options.length, 8)}
			/>
		</Box>
	)
}
