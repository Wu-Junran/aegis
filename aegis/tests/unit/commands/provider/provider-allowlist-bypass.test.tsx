import { test, expect, afterEach, beforeEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import * as React from 'react'
import { call } from '../../../../src/commands/provider/provider.js'
import { __resetAegisrcCacheForTest } from '../../../../src/medical/config/aegisrc.js'
import {
	clearConfirmedProviders,
	setSessionProvider,
} from '../../../../src/services/api/sessionProvider.js'
import { AppStateProvider } from '../../../../src/state/AppState.js'
import { getDefaultAppState } from '../../../../src/state/AppStateStore.js'

// `loadAegisrc()` defaults its `cwd` arg to `process.cwd()` and is called
// without arguments by `provider.tsx:renderSet()`. We isolate per-test by
// chdir'ing into a temp dir that contains an `.aegisrc`, then resetting the
// loader's memoized result. This exercises the actual command path —
// previously the test only checked `loadAegisrc(dir, dir)` directly and
// never invoked /provider set, so it could not catch a regression where
// `renderSet` ignored the allowlist.

let originalCwd: string
let tmp: string

beforeEach(() => {
	clearConfirmedProviders()
	setSessionProvider(null)
	originalCwd = process.cwd()
	tmp = mkdtempSync(join(tmpdir(), 'aegisrc-bypass-'))
	process.chdir(tmp)
	__resetAegisrcCacheForTest()
})

afterEach(() => {
	process.chdir(originalCwd)
	rmSync(tmp, { recursive: true, force: true })
	__resetAegisrcCacheForTest()
})

// `AppStateProvider` accepts `onChangeAppState({ newState, oldState })` —
// see aegis/src/state/AppState.tsx. We capture every state transition so
// we can assert the bypass branch actually wrote `currentProvider` to
// AppState (not just printed the success line via onDone). Without this
// check, a regression that called `onDone(...)` without `setApp(...)`
// would silently pass.
type Captured = { newState: import('../../../../src/state/AppStateStore.js').AppState }
function renderCapturing(node: React.ReactElement, captured: Captured[]) {
	return render(
		<AppStateProvider
			initialState={getDefaultAppState()}
			onChangeAppState={({ newState }) => captured.push({ newState })}
		>
			{node}
		</AppStateProvider>,
	)
}

test('allowlisted id bypasses ProviderConfirm and applies synchronously', async () => {
	writeFileSync(join(tmp, '.aegisrc'), JSON.stringify({ allowlist: ['openai'], providers: {} }))
	__resetAegisrcCacheForTest()
	let lastMessage = ''
	const onDone = (m: string) => {
		lastMessage = m
	}
	const node = await call(onDone as any, {} as any, 'set openai')
	expect(node).not.toBeNull()
	const captured: Captured[] = []
	const { lastFrame } = renderCapturing(node as React.ReactElement, captured)
	await new Promise((r) => setTimeout(r, 10))
	const frame = lastFrame() ?? ''
	// (1) No confirm banner.
	expect(frame).not.toContain('Switch active provider')
	// (2) onDone fired the success line.
	expect(lastMessage).toContain('Provider set to "openai"')
	// (3) AppState.currentProvider was actually written — id and modelId
	// must match the openai preset (modelId 'gpt-5'). Without overlay,
	// `buildProviderConfigFromPreset` lands on `preset.defaultModelId`.
	const final = captured[captured.length - 1]?.newState.currentProvider
	expect(final).not.toBeNull()
	expect(final?.id).toBe('openai')
	expect(final?.modelId).toBe('gpt-5')
})

test('non-allowlisted id still mounts ProviderConfirm even with non-empty allowlist', async () => {
	writeFileSync(join(tmp, '.aegisrc'), JSON.stringify({ allowlist: ['openai'], providers: {} }))
	__resetAegisrcCacheForTest()
	let lastMessage = ''
	const onDone = (m: string) => {
		lastMessage = m
	}
	const node = await call(onDone as any, {} as any, 'set glm')
	expect(node).not.toBeNull()
	const captured: Captured[] = []
	const { lastFrame } = renderCapturing(node as React.ReactElement, captured)
	await new Promise((r) => setTimeout(r, 10))
	const frame = lastFrame() ?? ''
	expect(frame).toContain('Switch active provider')
	expect(lastMessage).not.toContain('Provider set to')
	// `currentProvider` MUST stay null until the user accepts the prompt.
	const final = captured[captured.length - 1]?.newState.currentProvider ?? null
	expect(final).toBeNull()
})
