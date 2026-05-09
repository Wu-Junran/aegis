import { test, expect, beforeEach, afterEach } from 'bun:test'
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

// `call` returns a JSX node for both the confirm and bypass paths, so a bare
// `expect(node).not.toBeNull()` cannot tell them apart. To exercise the real
// behavior we render the returned node inside <AppStateProvider> (required by
// useSetAppState in ConfirmAndApply / ApplyProvider) and inspect lastFrame()
// / `lastMessage` to distinguish: ProviderConfirm prints the literal text
// "Switch active provider"; ApplyProvider prints "Provider set to ..." via
// onDone synchronously inside its useEffect.
//
// `loadAegisrc()` falls back from cwd → homedir AND memoizes the result, so
// "test cwd has no .aegisrc" is NOT enough — a developer with `openai` in
// their personal ~/.aegisrc, or a previous test that cached an allowlist,
// would silently flip this test into the bypass branch. We chdir into a
// temp dir containing an explicit empty-allowlist .aegisrc and reset the
// loader cache around every test, the same way provider-allowlist-bypass
// does.

let originalCwd: string
let tmp: string

beforeEach(() => {
	clearConfirmedProviders()
	setSessionProvider(null)
	originalCwd = process.cwd()
	tmp = mkdtempSync(join(tmpdir(), 'aegisrc-confirm-'))
	writeFileSync(join(tmp, '.aegisrc'), JSON.stringify({ allowlist: [], providers: {} }))
	process.chdir(tmp)
	__resetAegisrcCacheForTest()
})

afterEach(() => {
	process.chdir(originalCwd)
	rmSync(tmp, { recursive: true, force: true })
	__resetAegisrcCacheForTest()
})

function renderWithAppState(node: React.ReactElement) {
	return render(<AppStateProvider initialState={getDefaultAppState()}>{node}</AppStateProvider>)
}

test('first /provider set <id> mounts ProviderConfirm when id not in allowlist', async () => {
	// .aegisrc in this temp cwd has empty allowlist → must confirm.
	let lastMessage = ''
	const onDone = (m: string) => {
		lastMessage = m
	}
	const node = await call(onDone as any, {} as any, 'set openai')
	expect(node).not.toBeNull()
	const { lastFrame } = renderWithAppState(node as React.ReactElement)
	await new Promise((r) => setTimeout(r, 10)) // let useEffect settle
	const frame = lastFrame() ?? ''
	// ProviderConfirm renders this literal banner; ApplyProvider does not.
	expect(frame).toContain('Switch active provider')
	// And the bypass message must NOT have fired.
	expect(lastMessage).not.toContain('Provider set to')
})

test('once confirmed in this session, switching back skips ProviderConfirm and applies synchronously', async () => {
	// markProviderConfirmed is called on accept; simulate that path so the
	// next /provider set takes the bypass branch.
	const { markProviderConfirmed } = await import('../../../../src/services/api/sessionProvider.js')
	markProviderConfirmed('openai')
	let lastMessage = ''
	const onDone = (m: string) => {
		lastMessage = m
	}
	const node = await call(onDone as any, {} as any, 'set openai')
	expect(node).not.toBeNull()
	const { lastFrame } = renderWithAppState(node as React.ReactElement)
	await new Promise((r) => setTimeout(r, 10)) // let useEffect settle
	const frame = lastFrame() ?? ''
	// Bypass branch: NO confirm banner; onDone fired with the success line.
	expect(frame).not.toContain('Switch active provider')
	expect(lastMessage).toContain('Provider set to "openai"')
})
