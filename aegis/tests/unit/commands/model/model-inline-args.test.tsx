import { test, expect } from 'bun:test'
import { render } from 'ink-testing-library'
import * as React from 'react'
import { call } from '../../../../src/commands/model/model.js'
import { AppStateProvider } from '../../../../src/state/AppState.js'
import { getDefaultAppState, type AppState } from '../../../../src/state/AppStateStore.js'
import { __setCheck1mAccessOverridesForTest } from '../../../../src/utils/model/check1mAccess.js'

test('inline /model <id> in provider mode writes ONLY currentProvider.modelId, never mainLoopModel (no legacy poison-pill)', async () => {
	// Regression #1: SetModelAndClose.setModel previously only wrote
	// mainLoopModel. With currentProvider non-null, redactedSend overrode
	// the request with currentProvider.modelId, so the user got a "Set
	// model to ..." confirmation while real calls used the old model.
	// Regression #2: even after the original Step B setModel patch,
	// /model gpt-4o never *reached* setModel because handleModelChange's
	// legacy gates (isModelAllowed → validateModel/sideQuery against
	// Anthropic) ran first and rejected/hung on the non-Anthropic id.
	// The provider-mode short-circuit fixes that.
	// Regression #4 (this assertion): the provider-mode branch must NOT
	// call the legacy `setModel(modelValue)` closure, because that closure
	// writes `mainLoopModel = modelValue`. After `/provider clear`, the
	// legacy Anthropic dispatch path inherits whatever is in
	// `mainLoopModel` — so a stale `mainLoopModel = 'gpt-4o'` would make
	// the next Anthropic request fail with "model not found". The
	// provider-mode branch writes ONLY `currentProvider.modelId`.
	// Using `gpt-4o` here — a non-Anthropic id — exercises the
	// short-circuit; a passing test proves we never called validateModel
	// (which would hit the network).
	const initialState: AppState = {
		...getDefaultAppState(),
		currentProvider: {
			id: 'openai' as const,
			modelId: 'gpt-5',
			capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128000 },
		},
	}
	const initialMainLoopModel = initialState.mainLoopModel // capture pre-call value
	const captured: Array<AppState> = []
	const messages: string[] = []
	const onDone = (m: string) => { messages.push(m) }
	// `/model gpt-4o` — non-empty args, so `call` returns <SetModelAndClose .../>.
	const node = await call(onDone as any, {} as any, 'gpt-4o')
	expect(node).not.toBeNull()
	const { unmount } = render(
		<AppStateProvider
			initialState={initialState}
			onChangeAppState={({ newState }) => captured.push(newState)}
		>
			{node as React.ReactElement}
		</AppStateProvider>,
	)
	await new Promise((r) => setTimeout(r, 10))
	const final = captured[captured.length - 1]
	expect(final).toBeDefined()
	// Load-bearing: only `currentProvider.modelId` changed.
	expect(final.currentProvider?.id).toBe('openai')
	expect(final.currentProvider?.modelId).toBe('gpt-4o')
	expect(final.currentProvider?.capabilities.toolUse).toBe(true)
	// Load-bearing #4: mainLoopModel is the legacy slot. It MUST remain
	// what it was before the call (i.e. the test's initial default value)
	// so that a later /provider clear does not contaminate the legacy
	// Anthropic path with a non-Anthropic id.
	expect(final.mainLoopModel).toBe(initialMainLoopModel)
	// Regression #3: subscribe-to-boolean. The provider-mode branch writes
	// a fresh currentProvider object; if the effect depended on the object
	// reference, it would re-run and call onDone (and setAppState) a
	// second time. Asserting exactly one "Set provider model to ..."
	// message pins the boolean-dep contract.
	expect(messages.length).toBe(1)
	expect(messages[0]).toContain('gpt-4o')
	unmount()
})

test('inline /model default in provider mode is refused with an actionable message (no silent no-op)', async () => {
	// Regression: `/model default` while a session provider is active
	// used to clear `mainLoopModel` (the legacy slot) and silently leave
	// `currentProvider.modelId` untouched, so the user got a "Set model
	// to default" confirmation while real provider dispatch kept using
	// the old `currentProvider.modelId`. The fix: explicit refusal,
	// pointing at /provider clear (return to legacy default) or a
	// concrete provider model id.
	const initialState: AppState = {
		...getDefaultAppState(),
		currentProvider: {
			id: 'openai' as const,
			modelId: 'gpt-5',
			capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128000 },
		},
	}
	const captured: Array<AppState> = []
	const messages: string[] = []
	const onDone = (m: string) => { messages.push(m) }
	// `/model default` (or `/model ` with empty args) — args === 'default'
	// → model = null. The provider-mode branch must reject before any
	// AppState write fires.
	const node = await call(onDone as any, {} as any, 'default')
	expect(node).not.toBeNull()
	const { unmount } = render(
		<AppStateProvider
			initialState={initialState}
			onChangeAppState={({ newState }) => captured.push(newState)}
		>
			{node as React.ReactElement}
		</AppStateProvider>,
	)
	await new Promise((r) => setTimeout(r, 10))
	// No state mutation: captured may be empty, OR (if a no-op render
	// flushed) the last captured state must equal the initial.
	if (captured.length > 0) {
		const final = captured[captured.length - 1]
		expect(final.currentProvider?.modelId).toBe('gpt-5') // unchanged
		expect(final.mainLoopModel).toBe(initialState.mainLoopModel) // unchanged
	}
	// Load-bearing: the actionable remediation message must be visible.
	expect(messages.length).toBe(1)
	expect(messages[0]).toContain('/provider clear')
	expect(messages[0]).toContain('session provider is active')
	unmount()
})

test('after provider-mode /model, simulating /provider clear leaves the legacy mainLoopModel uncontaminated', async () => {
	// End-to-end regression for the poison-pill scenario: a user runs
	// `/model gpt-4o` while in provider mode, then `/provider clear`.
	// The legacy Anthropic dispatch path that takes over after clear
	// reads `mainLoopModel`. If the provider-mode `/model` write had
	// touched `mainLoopModel`, the legacy path would now inherit a
	// non-Anthropic id and the next Anthropic call would fail.
	//
	// IMPORTANT: AppStateProvider builds its store with `useState(initializer)`,
	// so passing a new `initialState` prop on rerender is IGNORED — the
	// store is created exactly once. To drive the simulated `/provider
	// clear` we mount a `<ClearOnSignal />` child INSIDE the same provider
	// that calls `useSetAppState` to flip `currentProvider` to null after
	// the inline-/model effect has finished. This actually exercises the
	// real store, the same way `/provider clear`'s ApplyClear node does.
	const { useSetAppState } = await import('../../../../src/state/AppState.js')
	const initialState: AppState = {
		...getDefaultAppState(),
		currentProvider: {
			id: 'openai' as const,
			modelId: 'gpt-5',
			capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128000 },
		},
	}
	const initialMainLoopModel = initialState.mainLoopModel
	const captured: Array<AppState> = []
	const onDone = (_: string) => {}
	const inlineNode = await call(onDone as any, {} as any, 'gpt-4o')
	expect(inlineNode).not.toBeNull()

	// Child that triggers a `/provider clear`-equivalent write on a
	// signal flip. We control the flip from the test via the wrapper's
	// `signal` ref so the inline-/model effect runs first and the clear
	// runs second, against the SAME store.
	function ClearOnSignal({ trigger }: { trigger: boolean }) {
		const setAppState = useSetAppState()
		React.useEffect(() => {
			if (!trigger) return
			setAppState((prev) => ({ ...prev, currentProvider: null }))
		}, [trigger, setAppState])
		return null
	}

	function Harness() {
		const [doClear, setDoClear] = React.useState(false)
		// On mount, render the inline-/model node; after its effect
		// settles, flip `doClear` to drive the simulated /provider clear.
		React.useEffect(() => {
			const t = setTimeout(() => setDoClear(true), 5)
			return () => clearTimeout(t)
		}, [])
		return (
			<>
				{inlineNode as React.ReactElement}
				<ClearOnSignal trigger={doClear} />
			</>
		)
	}

	const { unmount } = render(
		<AppStateProvider
			initialState={initialState}
			onChangeAppState={({ newState }) => captured.push(newState)}
		>
			<Harness />
		</AppStateProvider>,
	)
	// Wait long enough for both the inline-/model effect AND the
	// clear-on-signal effect to settle.
	await new Promise((r) => setTimeout(r, 30))

	// Find the post-/model state (currentProvider.modelId === 'gpt-4o').
	const afterModel = captured.find(
		(s) => s.currentProvider?.modelId === 'gpt-4o',
	)
	expect(afterModel).toBeDefined()
	expect(afterModel!.mainLoopModel).toBe(initialMainLoopModel)
	// Find the post-clear state (currentProvider === null).
	const afterClear = captured.find((s) => s.currentProvider === null)
	expect(afterClear).toBeDefined()
	// Load-bearing: post-clear, the legacy path's `mainLoopModel` is
	// what it was before any of this — NOT 'gpt-4o'. This is the
	// contract the regression pins.
	expect(afterClear!.mainLoopModel).toBe(initialMainLoopModel)
	expect(afterClear!.mainLoopModel).not.toBe('gpt-4o')
	unmount()
})

test('/model current reports the active provider+model when currentProvider is set (not the stale legacy mainLoopModel)', async () => {
	// Regression: info args route through `ShowModelAndClose`, which
	// previously read ONLY `mainLoopModel`. After `/provider set openai`
	// or a provider-mode `/model gpt-4o`, `/model current` would still
	// print `Current model: claude-opus-4-7` while real dispatch went to
	// gpt-4o — i.e., the user's diagnostic command actively misled them
	// about which model was being called. Fix surfaces the active
	// provider/model explicitly. We also DELIBERATELY do NOT call
	// `renderModelLabel(mainLoopModel)` in the provider branch:
	// `renderModelLabel(null)` cascades through
	// `getDefaultMainLoopModelSetting → isMaxSubscriber →
	// getAnthropicApiKeyWithSource`, which **throws** without
	// `ANTHROPIC_API_KEY`. Eagerly computing the legacy slot would crash
	// `/model current` for any user who switched to a non-Anthropic
	// provider and has no Anthropic creds — exactly the audience for
	// whom provider mode exists. This test runs WITHOUT
	// ANTHROPIC_API_KEY in the env to pin that contract too.
	const savedAnthropicKey = process.env.ANTHROPIC_API_KEY
	const savedAnthropicAuth = process.env.ANTHROPIC_AUTH_TOKEN
	const savedOAuth = process.env.CLAUDE_CODE_OAUTH_TOKEN
	delete process.env.ANTHROPIC_API_KEY
	delete process.env.ANTHROPIC_AUTH_TOKEN
	delete process.env.CLAUDE_CODE_OAUTH_TOKEN
	try {
		const initialState: AppState = {
			...getDefaultAppState(),
			currentProvider: {
				id: 'openai' as const,
				displayName: 'OpenAI',
				modelId: 'gpt-4o',
				capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128000 },
			},
		}
		const captured: Array<AppState> = []
		const messages: string[] = []
		const onDone = (m: string) => {
			messages.push(m)
		}
		// `/model current` — info arg, returns <ShowModelAndClose .../>.
		const node = await call(onDone as any, {} as any, 'current')
		expect(node).not.toBeNull()
		const { unmount } = render(
			<AppStateProvider
				initialState={initialState}
				onChangeAppState={({ newState }) => captured.push(newState)}
			>
				{node as React.ReactElement}
			</AppStateProvider>,
		)
		await new Promise((r) => setTimeout(r, 10))
		// Load-bearing #0: the component MUST NOT crash without Anthropic
		// auth. Pre-fix it would have thrown inside React render.
		expect(messages.length).toBe(1)
		const out = messages[0]
		// Load-bearing #1: the active provider id is in the output.
		expect(out).toContain('openai')
		// Load-bearing #2: the active provider's modelId is in the output.
		expect(out).toContain('gpt-4o')
		// Load-bearing #3: an "Active provider" framing makes the source of
		// truth explicit. Pre-fix the output literally said "Current model"
		// followed by the legacy mainLoopModel — actively misleading.
		expect(out).toContain('Active provider')
		unmount()
	} finally {
		if (savedAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY
		else process.env.ANTHROPIC_API_KEY = savedAnthropicKey
		if (savedAnthropicAuth === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN
		else process.env.ANTHROPIC_AUTH_TOKEN = savedAnthropicAuth
		if (savedOAuth === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN
		else process.env.CLAUDE_CODE_OAUTH_TOKEN = savedOAuth
	}
})

test('inline /model auto in openai-compatible provider mode is refused at the top of handleModelChange (no invalid placeholder write, no validator round-trip)', async () => {
	// Regression for the original M5 bug: a user who switched to
	// `openai-compatible` (with a real baseURL/modelId from `.aegisrc`) and
	// then ran `/model auto` would land back in the placeholder state —
	// `auto` is the preset's "configure me" sentinel, not a real model —
	// and the next dispatch would fail at request time AFTER the user got
	// a "Set provider model to auto" confirmation.
	//
	// The fix evolved through three layers (each with a separate test):
	//   1. The two-level picker calls `validateProviderConfigForApply`
	//      before writing (covered in `model-two-level.test.tsx`).
	//   2. The inline path calls the same validator before writing
	//      (covered indirectly here).
	//   3. The inline path *also* short-circuits `'auto'` at the top of
	//      `handleModelChange`, BEFORE branch selection or validator call,
	//      because `auto` is universally a placeholder regardless of which
	//      provider is active or whether one is active at all. The
	//      universal short-circuit is what fires here — the validator-
	//      reachable path is now defense-in-depth.
	//
	// Load-bearing assertions: the universal-placeholder text mentions
	// `"auto"` and the word "placeholder", and the modelId stays at the
	// original concrete value (no poison-pill write).
	const initialState: AppState = {
		...getDefaultAppState(),
		currentProvider: {
			id: 'openai-compatible' as const,
			baseURL: 'http://localhost:8000/v1',
			modelId: 'Qwen/Qwen2.5-7B-Instruct',
			capabilities: { streaming: true, toolUse: false, promptCache: false, maxContextTokens: 32000 },
		},
	}
	const captured: Array<AppState> = []
	const messages: string[] = []
	const onDone = (m: string) => {
		messages.push(m)
	}
	const node = await call(onDone as any, {} as any, 'auto')
	expect(node).not.toBeNull()
	const { unmount } = render(
		<AppStateProvider
			initialState={initialState}
			onChangeAppState={({ newState }) => captured.push(newState)}
		>
			{node as React.ReactElement}
		</AppStateProvider>,
	)
	await new Promise((r) => setTimeout(r, 20))
	// Load-bearing #1: refusal fires with the universal-placeholder text,
	// not the lying success banner.
	expect(messages.length).toBe(1)
	expect(messages[0]).toContain('"auto"')
	expect(messages[0]).toContain('placeholder')
	expect(messages[0]).not.toContain('Set provider model to')
	// Load-bearing #2: AppState MUST NOT be written. If captured fired,
	// the modelId stays at the original concrete value (the openai-compatible
	// `currentProvider` from the .aegisrc overlay).
	if (captured.length > 0) {
		const final = captured[captured.length - 1]
		expect(final.currentProvider?.modelId).toBe('Qwen/Qwen2.5-7B-Instruct')
	}
	unmount()
})

test('inline /model <alias> with NO session provider only writes mainLoopModel (legacy path unchanged)', async () => {
	// Verifies the guard works the other way: when currentProvider is
	// null, SetModelAndClose must not introduce one, AND the legacy
	// `setModel` closure still writes `mainLoopModel`. We use `sonnet`
	// here (a known alias) so handleModelChange takes the
	// `isKnownAlias(model)` short-circuit at line ~173 and never calls
	// validateModel (which would hit Anthropic's API and make the test
	// flaky/networked). The point of THIS test is that the legacy path
	// is unchanged.
	const captured: Array<AppState> = []
	const onDone = (m: string) => { /* noop */ }
	const node = await call(onDone as any, {} as any, 'sonnet')
	expect(node).not.toBeNull()
	const { unmount } = render(
		<AppStateProvider
			initialState={getDefaultAppState()}
			onChangeAppState={({ newState }) => captured.push(newState)}
		>
			{node as React.ReactElement}
		</AppStateProvider>,
	)
	await new Promise((r) => setTimeout(r, 10))
	const final = captured[captured.length - 1]
	expect(final.mainLoopModel).toBe('sonnet')
	expect(final.currentProvider).toBeNull()
	unmount()
})

test('inline /model auto with NO active provider refuses universally without hitting the legacy Anthropic validateModel path', async () => {
	// Regression for the "Authentication failed" trace: with no provider
	// activated, `/model auto` previously fell through to the legacy
	// Anthropic-only path's `validateModel(modelName)`, which calls
	// `api.anthropic.com` and surfaces an `AuthenticationError` (or, with
	// valid creds, a `Model 'auto' not found` 404). Both responses are
	// confusing — the user picked a placeholder, not a real model, and the
	// remediation has nothing to do with Anthropic creds. The fix refuses
	// `'auto'` at the top of `handleModelChange` BEFORE any branch decision
	// or network validation. This test pins:
	//
	//   1. The refusal message is the universal-placeholder text, not
	//      "Authentication failed" / "not found" / any network-derived text.
	//   2. AppState is NOT mutated (no phantom `currentProvider`, no
	//      `mainLoopModel = 'auto'` poison via the legacy `setModel`).
	//   3. The `validateModel` import is never reached — proven indirectly by
	//      the test passing without any network mocks. If the legacy branch
	//      ran for `'auto'`, the test would either timeout (waiting on the
	//      real network) or crash on missing Anthropic creds.
	const initialState: AppState = {
		...getDefaultAppState(),
		currentProvider: null,
	}
	const captured: Array<AppState> = []
	const messages: string[] = []
	const onDone = (m: string) => {
		messages.push(m)
	}
	const node = await call(onDone as any, {} as any, 'auto')
	expect(node).not.toBeNull()
	const { unmount } = render(
		<AppStateProvider
			initialState={initialState}
			onChangeAppState={({ newState }) => captured.push(newState)}
		>
			{node as React.ReactElement}
		</AppStateProvider>,
	)
	await new Promise((r) => setTimeout(r, 30))
	// Load-bearing #1: universal-placeholder message is the ONLY thing said.
	expect(messages.length).toBe(1)
	expect(messages[0]).toContain('"auto"')
	expect(messages[0]).toContain('placeholder')
	// Load-bearing #2: NOT the legacy-validate auth/network errors.
	expect(messages[0]).not.toContain('Authentication failed')
	expect(messages[0]).not.toContain('not found')
	expect(messages[0]).not.toContain('Network error')
	// Load-bearing #3: no AppState mutation (no provider write, no legacy
	// mainLoopModel poison).
	for (const s of captured) {
		expect(s.currentProvider).toBeNull()
		// `mainLoopModel` defaults to whatever `getDefaultAppState()` gives
		// us; if the legacy `setModel('auto')` ran, it would change. Pin
		// that it didn't.
		expect(s.mainLoopModel).toBe(initialState.mainLoopModel)
	}
	unmount()
})

test('inline /model auto with NO active provider does not lie ("Set provider model to..." must NOT fire when currentProvider is null)', async () => {
	// Companion regression to the universal-refusal test above: this one
	// pins the *absence* of the lying success banner, against an even
	// older bug where `SetModelAndClose` branched on the React-subscribed
	// `hasProvider` boolean (subscribed at render time) while the
	// `setAppState((prev) => prev.currentProvider ? ... : prev)` write-guard
	// silently no-op'd, then the unconditional `onDone(\`Set provider
	// model to ${model}.\`)` fired below. A user who never activated a
	// provider got "succeeded" feedback for a write that didn't happen.
	//
	// Root cause: SetModelAndClose branched on the React-subscribed
	// `hasProvider` boolean (subscribed at render time), and the
	// `setAppState((prev) => prev.currentProvider ? ... : prev)` write-guard
	// silently no-op'd while the unconditional `onDone(\`Set provider model
	// to ${model}.\`)` still fired below. A user who never activated a
	// provider got "succeeded" feedback for a write that didn't happen.
	//
	// Two complementary fixes lock this down:
	//   1. The branch reads the LIVE store snapshot (`store.getState()
	//      .currentProvider`) instead of the subscribed `hasProvider` flag.
	//   2. The success message is gated on a `didWrite` flag set inside the
	//      setAppState updater, so a no-op write produces a remediation
	//      message ("No active provider — /model has no effect…") instead
	//      of a fake confirmation.
	//
	// We deliberately use a model id that ALSO won't make the legacy path
	// happy (`auto` is rejected by the universal validator), so if a future
	// refactor accidentally takes the legacy branch with no provider, the
	// test would still flag because legacy fires its own different message
	// — but the load-bearing assertion is the absence of the "Set provider
	// model" lie.
	const initialState: AppState = {
		...getDefaultAppState(),
		currentProvider: null,
	}
	const captured: Array<AppState> = []
	const messages: string[] = []
	const onDone = (m: string) => {
		messages.push(m)
	}
	const node = await call(onDone as any, {} as any, 'auto')
	expect(node).not.toBeNull()
	const { unmount } = render(
		<AppStateProvider
			initialState={initialState}
			onChangeAppState={({ newState }) => captured.push(newState)}
		>
			{node as React.ReactElement}
		</AppStateProvider>,
	)
	await new Promise((r) => setTimeout(r, 30))
	// Load-bearing #1: the lying success message MUST NOT appear.
	for (const m of messages) {
		expect(m).not.toContain('Set provider model to')
	}
	// Load-bearing #2: currentProvider stays null. No phantom write happened.
	for (const s of captured) {
		expect(s.currentProvider).toBeNull()
	}
	unmount()
})

test('universal-auto refusal: /model auto in non-openai-compatible provider mode is rejected (placeholder is not a real model on ANY provider)', async () => {
	// Companion to Bug B: the validator's openai-compatible-specific gate
	// previously let `'auto'` through for anthropic/openai/glm/minimax.
	// `auto` is exclusively our placeholder shape; no real provider has a
	// model literally named "auto". The new universal check at the top of
	// `validateProviderConfigForApply` refuses it for any preset id, so
	// `/model auto` is consistently a remediation across the board.
	//
	// We pick `openai` here (any non-openai-compatible preset would do)
	// to prove the universal check fires before the preset-specific one.
	const initialState: AppState = {
		...getDefaultAppState(),
		currentProvider: {
			id: 'openai' as const,
			modelId: 'gpt-4o',
			capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128000 },
		},
	}
	const captured: Array<AppState> = []
	const messages: string[] = []
	const onDone = (m: string) => {
		messages.push(m)
	}
	const node = await call(onDone as any, {} as any, 'auto')
	expect(node).not.toBeNull()
	const { unmount } = render(
		<AppStateProvider
			initialState={initialState}
			onChangeAppState={({ newState }) => captured.push(newState)}
		>
			{node as React.ReactElement}
		</AppStateProvider>,
	)
	await new Promise((r) => setTimeout(r, 20))
	// Refusal fires with the universal-placeholder message — provider-
	// agnostic by design, since the early short-circuit at the top of
	// `handleModelChange` runs BEFORE branch selection (so it deliberately
	// doesn't read currentProvider). The validator's preset-id-aware
	// message is now defense-in-depth (covered separately for the picker
	// path).
	expect(messages.length).toBe(1)
	expect(messages[0]).toContain('"auto"')
	expect(messages[0]).toContain('placeholder')
	// Lying-success guard: the legacy "Set provider model to..." MUST NOT fire.
	for (const m of messages) {
		expect(m).not.toContain('Set provider model to')
	}
	// AppState write-guard: modelId stays 'gpt-4o', no `auto` poison.
	if (captured.length > 0) {
		const final = captured[captured.length - 1]
		expect(final.currentProvider?.modelId).toBe('gpt-4o')
	}
	unmount()
})

test('inline /model opus[1m] in NO-ACCESS env: 1M rejection fires; alias NOT set (locks gate ordering vs alias short-circuit)', async () => {
	// Regression for 715f207. The legacy gate ordering MUST keep
	// `isOpus1mUnavailable` BEFORE `isKnownAlias` in handleModelChange.
	// Without that ordering, `opus[1m]` (a first-class MODEL_ALIASES entry)
	// short-circuits via setModel(...) and bypasses the 1M-access check
	// entirely, silently setting the alias for users without 1M access —
	// confusing inference-time failures replace clear refusals.
	//
	// **Bidirectional pinning.** The earlier draft asserted the rejection
	// did NOT appear (`toBe(false)`) under a real-env's default
	// `checkOpus1mAccess() === true`. That assertion passes under BOTH the
	// correct ordering AND the buggy ordering, so it cannot distinguish
	// them. We now drive a true no-access env by:
	//   (1) overriding `checkOpus1mAccess()` → false via the M5 test seam, and
	//   (2) setting `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` so
	//       `is1mContextDisabled()` returns true, which makes
	//       `isOpus1mMergeEnabled()` short-circuit to false. Without this,
	//       `isOpus1mMergeEnabled()` returns true in the firstParty test
	//       env, the `&& !isOpus1mMergeEnabled()` clause flips
	//       `isOpus1mUnavailable()` to false, and the rejection wouldn't
	//       fire even with the access override.
	// The chain `m.includes('opus') && m.includes('[1m]') && !checkOpus1mAccess() && !isOpus1mMergeEnabled()`
	// is then `true && true && true && true === true`, so the rejection
	// MUST fire under the correct ordering. Under the buggy ordering
	// (alias short-circuit first), no rejection appears and `mainLoopModel`
	// is silently set to 'opus[1m]' — both assertions below fail.
	const savedDisable1m = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
	process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
	__setCheck1mAccessOverridesForTest({ opus: false })
	try {
		const captured: Array<AppState> = []
		const messages: string[] = []
		const onDone = (m: string) => { messages.push(m) }
		const node = await call(onDone as any, {} as any, 'opus[1m]')
		expect(node).not.toBeNull()
		const { unmount } = render(
			<AppStateProvider
				initialState={getDefaultAppState()}
				onChangeAppState={({ newState }) => captured.push(newState)}
			>
				{node as React.ReactElement}
			</AppStateProvider>,
		)
		await new Promise((r) => setTimeout(r, 20))
		// Load-bearing #1: the 1M-not-available rejection MUST fire. Under
		// the buggy gate ordering this is silent (alias short-circuit ran
		// first), so this assertion fails for the regression.
		expect(messages.some(m => m.includes('Opus 4.6 with 1M context is not available'))).toBe(true)
		// Load-bearing #2: `mainLoopModel` MUST NOT be set to 'opus[1m]'.
		// Under the buggy ordering it would have been silently stamped. We
		// also accept the no-state-change case (captured may be empty if no
		// useEffect-driven write fired).
		if (captured.length > 0) {
			const final = captured[captured.length - 1]
			expect(final.mainLoopModel).not.toBe('opus[1m]')
		}
		unmount()
	} finally {
		__setCheck1mAccessOverridesForTest({ opus: null })
		if (savedDisable1m === undefined) delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
		else process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = savedDisable1m
	}
})

test('inline /model sonnet[1m] in NO-ACCESS env: 1M rejection fires; alias NOT set (locks gate ordering vs alias short-circuit)', async () => {
	// Same regression as the opus[1m] case, applied to the sonnet[1m]
	// alias (also a first-class MODEL_ALIASES entry). `isSonnet1mUnavailable`'s
	// chain is `(m.includes('sonnet[1m]') || m.includes('sonnet-4-6[1m]')) && !checkSonnet1mAccess()`
	// — there is NO `isSonnet1mMergeEnabled()` clause, so the access
	// override alone is sufficient. We still set
	// `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` defensively to keep the test
	// shape symmetric with the opus[1m] case and to short-circuit
	// `checkSonnet1mAccess`'s real impl (which returns false when 1M
	// context is disabled, matching our override).
	const savedDisable1m = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
	process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
	__setCheck1mAccessOverridesForTest({ sonnet: false })
	try {
		const captured: Array<AppState> = []
		const messages: string[] = []
		const onDone = (m: string) => { messages.push(m) }
		const node = await call(onDone as any, {} as any, 'sonnet[1m]')
		expect(node).not.toBeNull()
		const { unmount } = render(
			<AppStateProvider
				initialState={getDefaultAppState()}
				onChangeAppState={({ newState }) => captured.push(newState)}
			>
				{node as React.ReactElement}
			</AppStateProvider>,
		)
		await new Promise((r) => setTimeout(r, 20))
		// Same bidirectional pinning as the opus[1m] case.
		expect(messages.some(m => m.includes('Sonnet 4.6 with 1M context is not available'))).toBe(true)
		if (captured.length > 0) {
			const final = captured[captured.length - 1]
			expect(final.mainLoopModel).not.toBe('sonnet[1m]')
		}
		unmount()
	} finally {
		__setCheck1mAccessOverridesForTest({ sonnet: null })
		if (savedDisable1m === undefined) delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
		else process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = savedDisable1m
	}
})
