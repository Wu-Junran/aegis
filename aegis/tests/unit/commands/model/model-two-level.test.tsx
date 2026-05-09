import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from '../../../setup/inkTestingShim.js'
import * as React from 'react'
import { TwoLevelModelPicker } from '../../../../src/commands/model/model.js'
import { getAPIProvider } from '../../../../src/utils/model/providers.js'
import { __resetAegisrcCacheForTest } from '../../../../src/medical/config/aegisrc.js'
import { AppStateProvider } from '../../../../src/state/AppState.js'
import { getDefaultAppState } from '../../../../src/state/AppStateStore.js'
import {
	clearConfirmedProviders,
	setSessionProvider,
} from '../../../../src/services/api/sessionProvider.js'
import { KeybindingSetup } from '../../../../src/keybindings/KeybindingProviderSetup.js'

// `TwoLevelModelPicker` calls `useSetAppState`, which throws outside of
// `<AppStateProvider>`. The CustomSelect also needs `KeybindingSetup` to
// respond to keyboard input (arrow keys, Enter). Wrap every render with both.
function renderWithAppState(node: React.ReactElement) {
	return render(
		<AppStateProvider initialState={getDefaultAppState()}>
			<KeybindingSetup>{node}</KeybindingSetup>
		</AppStateProvider>,
	)
}

// `loadAegisrc()` falls back from cwd → homedir AND memoizes — same
// hazard as provider-confirm-flow.test.tsx. The "non-allowlisted provider"
// test below relies on `openai` NOT being in the active allowlist; without
// isolation, a developer with `openai` in `~/.aegisrc` would silently
// flip the test path. chdir to a temp dir with an explicit empty
// allowlist .aegisrc and reset the loader cache around every test.
let originalCwd: string
let tmp: string

beforeEach(() => {
	clearConfirmedProviders()
	setSessionProvider(null)
	originalCwd = process.cwd()
	tmp = mkdtempSync(join(tmpdir(), 'aegisrc-model-two-level-'))
	writeFileSync(join(tmp, '.aegisrc'), JSON.stringify({ allowlist: [], providers: {} }))
	process.chdir(tmp)
	__resetAegisrcCacheForTest()
})

afterEach(() => {
	process.chdir(originalCwd)
	rmSync(tmp, { recursive: true, force: true })
	__resetAegisrcCacheForTest()
})

test('header shows legacy getAPIProvider() result, read-only', () => {
	const { lastFrame } = renderWithAppState(<TwoLevelModelPicker onDone={() => {}} />)
	const out = lastFrame() ?? ''
	expect(out).toContain('legacy:')
	expect(out).toContain(getAPIProvider())
})

test('rows are SessionProviderIds, not model names', () => {
	const { lastFrame } = renderWithAppState(<TwoLevelModelPicker onDone={() => {}} />)
	const out = lastFrame() ?? ''
	expect(out).toContain('anthropic')
	expect(out).toContain('openai')
	expect(out).toContain('glm')
})

test('ProviderScopedModelPicker: Enter without arrow keys returns the configured modelId, even when it is not models[0]', async () => {
	// Regression: CustomSelect needs `defaultFocusValue` AND `defaultValue`
	// for Enter to preserve the caller's preselection. The OpenAI preset's
	// knownModels = ['gpt-5', 'gpt-4o', 'gpt-4o-mini'] — passing
	// `defaultModelId='gpt-4o-mini'` (last position) and pressing Enter
	// must return 'gpt-4o-mini', NOT 'gpt-5'.
	const { ProviderScopedModelPicker } = await import('../../../../src/medical/repl/ProviderScopedModelPicker.js')
	const { PROVIDER_PRESETS } = await import('../../../../src/medical/providers/presets.js')
	const openai = PROVIDER_PRESETS.find((p) => p.id === 'openai')!
	let picked: string | null = null
	const { stdin } = render(
		<AppStateProvider initialState={getDefaultAppState()}>
			<KeybindingSetup>
				<ProviderScopedModelPicker
					preset={openai}
					defaultModelId="gpt-4o-mini"
					onSelect={(m) => {
						picked = m
					}}
				/>
			</KeybindingSetup>
		</AppStateProvider>,
	)
	stdin.write('\r') // Enter, no arrow keys
	await new Promise((r) => setTimeout(r, 10))
	expect(picked).toBe('gpt-4o-mini')
})

test('picker model-stage onSelect: re-runs validateProviderConfigForApply (rejects placeholder modelId from preset.knownModels fallback)', async () => {
	// Regression scenario the inline `/model` validation gate alone
	// doesn't cover:
	//   1. Operator configures `.aegisrc.providers."openai-compatible"`
	//      with a real `baseURL` AND a concrete `modelId` — the
	//      provider-stage gate (`buildProviderConfigFromPreset` +
	//      `validateProviderConfigForApply`) PASSES because both
	//      required fields are set.
	//   2. Operator did NOT also override `knownModels`, so
	//      `effectiveKnownModels(preset, rc)` falls back to
	//      `preset.knownModels = ['auto']` (the only default entry on
	//      the openai-compatible preset).
	//   3. `ProviderScopedModelPicker` therefore offers 'auto' as the
	//      sole selectable model. Pre-fix, picking it wrote
	//      `currentProvider.modelId = 'auto'` (the placeholder) — the
	//      next dispatch would fail at request time AFTER the user got
	//      a "Model set to auto on provider openai-compatible." success
	//      message.
	// The fix re-runs `validateProviderConfigForApply` on the proposed
	// `{ ...stage.cfg, modelId }` before writing AppState. This test
	// drives the full picker flow under those exact `.aegisrc` settings
	// and asserts the refusal lands AND no AppState write happened.
	const { TwoLevelModelPicker: Picker } = await import('../../../../src/commands/model/model.js')
	// Set up `.aegisrc` with openai-compatible: real baseURL +
	// concrete modelId, openai-compatible in allowlist (skips the
	// confirm step), but NO `knownModels` override → picker shows
	// the preset default ['auto']. The temp-cwd is already installed
	// in beforeEach; we rewrite its .aegisrc with the scenario config.
	writeFileSync(
		join(tmp, '.aegisrc'),
		JSON.stringify({
			allowlist: ['openai-compatible'],
			providers: {
				'openai-compatible': {
					baseURL: 'http://localhost:8000/v1',
					modelId: 'Qwen/Qwen2.5-7B-Instruct',
				},
			},
		}),
	)
	__resetAegisrcCacheForTest()
	const messages: string[] = []
	const modelIdWriteHistory: Array<string | null> = []
	let lastWrittenProvider: string | null = null
	const { stdin } = render(
		<AppStateProvider
			initialState={getDefaultAppState()}
			onChangeAppState={({ newState }) => {
				const m = newState.currentProvider?.modelId ?? null
				modelIdWriteHistory.push(m)
				lastWrittenProvider = m
			}}
		>
			<KeybindingSetup>
				<Picker
					onDone={(m: string) => {
						messages.push(m)
					}}
				/>
			</KeybindingSetup>
		</AppStateProvider>,
	)
	// PROVIDER_PRESETS order is anthropic, openai, glm, minimax,
	// openai-compatible — so 4 ↓-arrows then Enter selects
	// openai-compatible. Allowlist contains it, validation passes,
	// applyAndAdvance fires → stage 'model' with knownModels=['auto'].
	stdin.write('\x1B[B') // ↓ openai
	stdin.write('\x1B[B') // ↓ glm
	stdin.write('\x1B[B') // ↓ minimax
	stdin.write('\x1B[B') // ↓ openai-compatible
	stdin.write('\r')
	await new Promise((r) => setTimeout(r, 30))
	// applyAndAdvance fired and wrote currentProvider with the configured
	// modelId. Capture pre-model-stage write history as a baseline.
	expect(lastWrittenProvider).toBe('Qwen/Qwen2.5-7B-Instruct')
	// Stage is now 'model'. `ProviderScopedModelPicker` inserts a
	// synthetic "(configured)" first option for the cfg.modelId
	// (`Qwen/...`) when it isn't in `knownModels`, then appends the
	// preset's `['auto']`. Enter without nav would select the
	// configured option (already valid). To exercise the regression,
	// nav DOWN once to focus the placeholder 'auto' row, then Enter.
	stdin.write('\x1B[B')
	stdin.write('\r')
	await new Promise((r) => setTimeout(r, 30))
	// Load-bearing #1: the refusal message MUST appear with the same
	// "auto"-rejection text that `validateProviderConfigForApply` returns.
	const refusal = messages.find((m) => m.includes('"auto"'))
	expect(refusal).toBeDefined()
	expect(refusal!).toContain('"openai-compatible"')
	// Load-bearing #2: `currentProvider.modelId` MUST NOT have been
	// rewritten to the placeholder. We tracked the latest written
	// modelId — if 'auto' had landed on AppState, this would now be
	// 'auto'. Pre-fix it would. Post-fix the rejection short-circuits
	// before any setApp call. (We don't pin `appWriteCount` here:
	// React + AppStateProvider can re-fire onChangeAppState during
	// effect chains for reasons unrelated to currentProvider —
	// asserting on the actual `modelId` value is the right invariant.)
	expect(lastWrittenProvider).toBe('Qwen/Qwen2.5-7B-Instruct')
	// Load-bearing #3: assert it was never even briefly 'auto' across
	// the entire write history. If a fix that wrote-then-rolled-back
	// were proposed in the future, this catches it.
	expect(modelIdWriteHistory).not.toContain('auto')
})

test('non-allowlisted provider: confirm dialog appears before model stage', async () => {
	// Regression: the model stage previously advanced without setting
	// currentProvider, so model selection was discarded. Drive provider
	// selection and assert the ProviderConfirm surface, NOT the model
	// picker, is what we see immediately after.
	const { lastFrame, stdin } = renderWithAppState(<TwoLevelModelPicker onDone={() => {}} />)
	// Drive provider selection — implementation-specific input; assert the
	// confirmation surface appears before the model stage.
	// (Exact key sequence depends on the picker's keybindings; the key
	// invariant under test is: model-stage frame is NEVER reached without
	// currentProvider being set first.)
	// At minimum, after picking a non-allowlisted provider the visible
	// frame must contain "Switch active provider" (from ProviderConfirm),
	// not the model list.
	// For a smoke-level regression, drive arrow + Enter to pick the second
	// row (openai), then assert.
	stdin.write('\x1B[B') // ↓ down arrow (ANSI escape sequence)
	stdin.write('\r')      // Enter
	// `openai` is not in the empty allowlist of the temp-cwd .aegisrc
	// installed by beforeEach → MUST land on the confirm dialog, never
	// the model stage. Wait one tick for the state machine to advance to
	// the `confirming` stage.
	await new Promise((r) => setTimeout(r, 10))
	const finalFrame = lastFrame() ?? ''
	expect(finalFrame).toContain('Switch active provider')
})
