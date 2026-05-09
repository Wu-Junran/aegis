import { test, expect } from 'bun:test'
import { PROVIDER_PRESETS } from '../../../../src/medical/providers/presets.js'

test('at least 5 presets', () => {
	expect(PROVIDER_PRESETS.length).toBeGreaterThanOrEqual(5)
})

test('every preset has displayName, defaultModelId, capabilities', () => {
	for (const p of PROVIDER_PRESETS) {
		expect(p.displayName.length).toBeGreaterThan(0)
		expect(p.defaultModelId.length).toBeGreaterThan(0)
		expect(typeof p.capabilities.streaming).toBe('boolean')
		expect(typeof p.capabilities.toolUse).toBe('boolean')
		expect(typeof p.capabilities.promptCache).toBe('boolean')
		expect(typeof p.capabilities.maxContextTokens).toBe('number')
	}
})

test('preset ids cover all SessionProviderIds', () => {
	const ids = new Set(PROVIDER_PRESETS.map((p) => p.id))
	expect(ids.has('anthropic')).toBe(true)
	expect(ids.has('openai')).toBe(true)
	expect(ids.has('glm')).toBe(true)
	expect(ids.has('minimax')).toBe(true)
	expect(ids.has('openai-compatible')).toBe(true)
})

test('buildProviderConfigFromPreset overlays .aegisrc.providers[id]', async () => {
	const { buildProviderConfigFromPreset, effectiveKnownModels } = await import(
		'../../../../src/medical/providers/presets.js'
	)
	const preset = PROVIDER_PRESETS.find((p) => p.id === 'openai-compatible')!
	const rc = {
		allowlist: [],
		providers: {
			'openai-compatible': {
				baseURL: 'http://ollama.local:11434/v1',
				modelId: 'llama-3.1-70b',
				knownModels: ['llama-3.1-70b', 'mixtral-8x22b'],
			},
		},
	}
	const cfg = buildProviderConfigFromPreset(preset, rc as any)
	expect(cfg.baseURL).toBe('http://ollama.local:11434/v1')
	expect(cfg.modelId).toBe('llama-3.1-70b')
	expect(effectiveKnownModels(preset, rc as any)).toEqual(['llama-3.1-70b', 'mixtral-8x22b'])
})

test('buildProviderConfigFromPreset falls back to preset defaults when overlay absent', async () => {
	const { buildProviderConfigFromPreset, effectiveKnownModels } = await import(
		'../../../../src/medical/providers/presets.js'
	)
	const preset = PROVIDER_PRESETS.find((p) => p.id === 'openai')!
	const rc = { allowlist: [], providers: {} }
	const cfg = buildProviderConfigFromPreset(preset, rc as any)
	expect(cfg.baseURL).toBe(preset.defaultBaseURL)
	expect(cfg.modelId).toBe(preset.defaultModelId)
	expect(effectiveKnownModels(preset, rc as any)).toEqual(preset.knownModels)
})

test('validateProviderConfigForApply rejects un-customized openai-compatible', async () => {
	// The generic openai-compatible preset ships without a defaultBaseURL
	// and with `modelId: 'auto'` as a placeholder. Applying it
	// un-customized would let dispatch fail at request time, after the
	// user has already "successfully" switched provider — exactly the
	// failure mode the manual DoD warns about. Pin both gates.
	const { buildProviderConfigFromPreset, validateProviderConfigForApply } = await import(
		'../../../../src/medical/providers/presets.js'
	)
	const preset = PROVIDER_PRESETS.find((p) => p.id === 'openai-compatible')!
	const cfg = buildProviderConfigFromPreset(preset, { allowlist: [], providers: {} } as any)
	const result = validateProviderConfigForApply(cfg)
	expect(result.ok).toBe(false)
	if (result.ok) throw new Error('unreachable')
	expect(result.reason).toContain('openai-compatible')
	expect(result.reason).toContain('.aegisrc')
})

test('validateProviderConfigForApply accepts customized openai-compatible', async () => {
	const { buildProviderConfigFromPreset, validateProviderConfigForApply } = await import(
		'../../../../src/medical/providers/presets.js'
	)
	const preset = PROVIDER_PRESETS.find((p) => p.id === 'openai-compatible')!
	const rc = {
		allowlist: [],
		providers: {
			'openai-compatible': { baseURL: 'http://localhost:8000/v1', modelId: 'Qwen/Qwen2.5-7B-Instruct' },
		},
	}
	const cfg = buildProviderConfigFromPreset(preset, rc as any)
	expect(validateProviderConfigForApply(cfg).ok).toBe(true)
})

test('validateProviderConfigForApply passes through every other preset (preset defaults are sane)', async () => {
	const { buildProviderConfigFromPreset, validateProviderConfigForApply } = await import(
		'../../../../src/medical/providers/presets.js'
	)
	for (const preset of PROVIDER_PRESETS) {
		if (preset.id === 'openai-compatible') continue
		const cfg = buildProviderConfigFromPreset(preset, { allowlist: [], providers: {} } as any)
		expect(validateProviderConfigForApply(cfg).ok).toBe(true)
	}
})

test('validateProviderConfigForApply refuses non-Anthropic switch in off mode (Decision #8)', async () => {
	// Regression: claude.ts:queryModel short-circuits past redactedSend
	// (where the M5 dispatch fork lives) when getPhiMode() === 'off'. So
	// `/provider set openai` in off mode would update AppState and confirm
	// to the user, while the next request still goes to Anthropic via the
	// off-mode passthrough — a silent dispatch-vs-state mismatch. The
	// pre-flight gate refuses the switch instead.
	const { setPhiModeFromCli, __resetPhiModeForTests } = await import(
		'../../../../src/medical/runtime/phiMode.js'
	)
	const { buildProviderConfigFromPreset, validateProviderConfigForApply } = await import(
		'../../../../src/medical/providers/presets.js'
	)
	__resetPhiModeForTests()
	setPhiModeFromCli({ mode: 'off', allowOff: true })
	try {
		const openai = PROVIDER_PRESETS.find((p) => p.id === 'openai')!
		const cfg = buildProviderConfigFromPreset(
			openai,
			{ allowlist: [], providers: {} } as any,
		)
		const result = validateProviderConfigForApply(cfg)
		expect(result.ok).toBe(false)
		if (result.ok) throw new Error('unreachable')
		expect(result.reason).toContain('off')
		// Load-bearing: remediation must point at the LAUNCH FLAG, not at a
		// runtime `/phi-mode set` (which is rejected by phi-mode.tsx).
		expect(result.reason).toContain('Restart aegis')
		expect(result.reason).toContain('--phi-mode=research')
		expect(result.reason).not.toMatch(/\/phi-mode\s+(?:research|strict|set)/)
	} finally {
		__resetPhiModeForTests()
	}
})

test('validateProviderConfigForApply ALSO refuses /provider set anthropic in off mode (no anthropic exception)', async () => {
	// Regression for the silent-mismatch-on-anthropic case: in off mode,
	// claude.ts uses `mainLoopModel` and ignores `currentProvider` entirely.
	// `/provider set anthropic` would land on the preset's
	// `claude-opus-4-7` default, but the next request would still use the
	// previous `mainLoopModel`. There is no anthropic exception in the
	// off-mode gate — the refusal is unconditional.
	const { setPhiModeFromCli, __resetPhiModeForTests } = await import(
		'../../../../src/medical/runtime/phiMode.js'
	)
	const { buildProviderConfigFromPreset, validateProviderConfigForApply } = await import(
		'../../../../src/medical/providers/presets.js'
	)
	__resetPhiModeForTests()
	setPhiModeFromCli({ mode: 'off', allowOff: true })
	try {
		const anthropic = PROVIDER_PRESETS.find((p) => p.id === 'anthropic')!
		const cfg = buildProviderConfigFromPreset(
			anthropic,
			{ allowlist: [], providers: {} } as any,
		)
		const result = validateProviderConfigForApply(cfg)
		expect(result.ok).toBe(false)
		if (result.ok) throw new Error('unreachable')
		expect(result.reason).toContain('Restart aegis')
		expect(result.reason).toContain('mainLoopModel')
	} finally {
		__resetPhiModeForTests()
	}
})

test('validateProviderConfigForApply allows non-Anthropic switch in research mode', async () => {
	// Counter-test: the off-mode refusal is gated on `getPhiMode() === 'off'`,
	// not on `cfg.id !== 'anthropic'` alone. Research/strict must still pass.
	const { setPhiModeFromCli, __resetPhiModeForTests } = await import(
		'../../../../src/medical/runtime/phiMode.js'
	)
	const { buildProviderConfigFromPreset, validateProviderConfigForApply } = await import(
		'../../../../src/medical/providers/presets.js'
	)
	__resetPhiModeForTests()
	setPhiModeFromCli({ mode: 'research', allowOff: false })
	try {
		const openai = PROVIDER_PRESETS.find((p) => p.id === 'openai')!
		const cfg = buildProviderConfigFromPreset(
			openai,
			{ allowlist: [], providers: {} } as any,
		)
		expect(validateProviderConfigForApply(cfg).ok).toBe(true)
	} finally {
		__resetPhiModeForTests()
	}
})
