import { test, expect } from 'bun:test'
import { call } from '../../../../src/commands/provider/provider.js'

test('list lists ≥ 5 presets', async () => {
	const lines: string[] = []
	const onDone = (msg: string) => { lines.push(msg) }
	await call(onDone as any, {} as any, 'list')
	const all = lines.join('\n')
	expect(all).toContain('anthropic')
	expect(all).toContain('openai')
	expect(all).toContain('glm')
	expect(all).toContain('minimax')
	expect(all).toContain('openai-compatible')
})

test('set without id prints usage', async () => {
	let msg = ''
	await call(((m: string) => { msg = m }) as any, {} as any, 'set')
	expect(msg).toContain('Usage')
})

test('clear renders ApplyClear which sets currentProvider to null and emits system message', async () => {
	// `clear` returns <ApplyClear />, whose useEffect only fires when the
	// node is rendered inside <AppStateProvider> (useSetAppState requires
	// the context). Drive the full lifecycle AND capture state changes
	// via `onChangeAppState` so we assert the actual write — a regression
	// that called onDone without `setApp(s => ({ ...s, currentProvider:
	// null }))` would silently pass otherwise.
	const { render } = await import('../../../setup/inkTestingShim.js')
	const { AppStateProvider } = await import('../../../../src/state/AppState.js')
	const { getDefaultAppState } = await import('../../../../src/state/AppStateStore.js')
	const messages: string[] = []
	const onDone = (m: string) => { messages.push(m) }
	const node = await call(onDone as any, {} as any, 'clear')
	expect(node).not.toBeNull()
	const initialState = {
		...getDefaultAppState(),
		currentProvider: {
			id: 'openai' as const,
			modelId: 'gpt-5',
			capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128000 },
		},
	}
	const captured: Array<{ currentProvider: unknown }> = []
	const { unmount } = render(
		<AppStateProvider
			initialState={initialState}
			onChangeAppState={({ newState }) => captured.push({ currentProvider: newState.currentProvider })}
		>
			{node}
		</AppStateProvider>,
	)
	await new Promise((r) => setTimeout(r, 0)) // let useEffect tick
	expect(messages.join('\n').toLowerCase()).toContain('cleared')
	// Load-bearing assertion: AppState.currentProvider was actually
	// written to null by ApplyClear's useEffect.
	expect(captured.length).toBeGreaterThan(0)
	expect(captured[captured.length - 1]?.currentProvider).toBeNull()
	unmount()
})

test('creds without args prints usage', async () => {
	let msg = ''
	await call(((m: string) => { msg = m }) as any, {} as any, 'creds')
	expect(msg).toContain('Usage')
})

test('creds rejects inline secrets (would leak to REPL history)', async () => {
	let msg = ''
	await call(((m: string) => { msg = m }) as any, {} as any, 'creds openai sk-LEAK-NEVER')
	expect(msg).toContain('does not accept the key as an argument')
	expect(msg).not.toContain('sk-LEAK-NEVER')
})

test('creds rejects inline secrets even for anthropic (early OAuth-message return must not bypass the warning)', async () => {
	// Regression: earlier draft put `idArg === 'anthropic'` ahead of the
	// `extraArgs.length` guard. `/provider creds anthropic sk-LEAK` then
	// only printed the OAuth/ANTHROPIC_API_KEY message and never warned
	// the user that the secret had already landed in the command tokens.
	// The inline-secret rejection MUST fire first, regardless of id.
	let msg = ''
	await call(((m: string) => { msg = m }) as any, {} as any, 'creds anthropic sk-LEAK-NEVER')
	expect(msg).toContain('does not accept the key as an argument')
	expect(msg).not.toContain('sk-LEAK-NEVER')
	expect(msg).not.toContain('OAuth') // OAuth message MUST NOT pre-empt the warning
})

test('creds rejects inline secrets even for unknown ids (warning must fire before unknown-id path)', async () => {
	// Same pattern: `/provider creds typo sk-LEAK` must surface the
	// inline-secret warning, not the "Unknown provider" message that
	// would otherwise let the leak slip by uncommented-on.
	let msg = ''
	await call(((m: string) => { msg = m }) as any, {} as any, 'creds typo-provider sk-LEAK-NEVER')
	expect(msg).toContain('does not accept the key as an argument')
	expect(msg).not.toContain('sk-LEAK-NEVER')
	expect(msg).not.toContain('Unknown provider')
})

test('creds with unknown provider id is rejected before the masked prompt mounts (and the typo is NOT echoed)', async () => {
	// Regression: earlier draft trusted `args[1] as SessionProviderId` and
	// would mount <CredsPaste providerId="typo" />, accept a paste, and
	// write the key to keytar under a bogus account that no adapter ever
	// reads. The check must happen in renderCreds itself, not inside
	// CredsPaste, so no React tree mounts for the bogus id.
	// Additional regression (creds-specific): the unknown-id message must
	// NOT echo `idArg` because `/provider creds <secret>` (one token, the
	// secret pasted in the id position) reaches this branch — echoing
	// would leak the secret to REPL history / transcript / audit log.
	// renderSet's unknown-id message CAN echo because that subcommand
	// has no "secret in the id position" failure mode; renderCreds does.
	const messages: string[] = []
	const onDone = (m: string) => { messages.push(m) }
	const node = await call(onDone as any, {} as any, 'creds typo-provider')
	// Same shape as the `set` command's unknown-id rejection: returns
	// null, posts a system message, does NOT return a JSX node.
	expect(node).toBeNull()
	const out = messages.join('\n')
	expect(out).toContain('Unknown provider id')
	expect(out).toContain('/provider list')
	// Load-bearing: the typo (which could be a pasted secret in real
	// usage) must NOT appear in the message.
	expect(out).not.toContain('typo-provider')
})

test('creds with a secret-shaped single token in the id position does NOT echo the secret', async () => {
	// Regression for the "secret in id position" leak: a user who types
	// `/provider creds sk-LEAK-NEVER` (one token, pasted secret as the
	// provider id, no `<id>` argument at all) used to get the message
	// `Unknown provider "sk-LEAK-NEVER". Run /provider list.` — landing
	// the secret in REPL history. The unknown-id branch must surface a
	// fully generic message that contains neither `sk-` nor the literal
	// pasted token.
	const messages: string[] = []
	const onDone = (m: string) => { messages.push(m) }
	const node = await call(onDone as any, {} as any, 'creds sk-LEAK-NEVER')
	expect(node).toBeNull()
	const out = messages.join('\n')
	expect(out).toContain('Unknown provider id')
	expect(out).not.toContain('sk-LEAK-NEVER')
	expect(out).not.toContain('sk-')
})

test('creds with a secret-shaped token in the id position AND extraArgs does NOT echo the secret', async () => {
	// Regression for the same leak via the extraArgs path: with two or
	// more tokens, the inline-secret guard fires first. Its message used
	// to interpolate `idArg` ("Run \"/provider creds ${idArg}\" with no
	// extra args"), which would echo `sk-LEAK-NEVER` if the user had put
	// the secret in the id position. The guard message must be fully
	// generic — `<provider-id>` placeholder, no interpolation.
	const messages: string[] = []
	const onDone = (m: string) => { messages.push(m) }
	await call(((m: string) => { messages.push(m) }) as any, {} as any, 'creds sk-LEAK-NEVER trailing')
	const out = messages.join('\n')
	expect(out).toContain('does not accept the key as an argument')
	expect(out).not.toContain('sk-LEAK-NEVER')
	expect(out).not.toContain('sk-')
})

test('set openai-compatible without `.aegisrc` overlay is refused before mount (no JSX, actionable message)', async () => {
	// Regression: the `openai-compatible` preset has no `defaultBaseURL`
	// and ships `modelId: 'auto'` as a placeholder. Without `.aegisrc`
	// supplying a real `baseURL` and `modelId`, applying it would let
	// dispatch fail at request time, after the user had "successfully"
	// switched provider. renderSet must run validateProviderConfigForApply
	// FIRST and refuse with a remediation message — no JSX node, no
	// confirm dialog, no AppState write.
	//
	// IMPORTANT: this test must drive a DETERMINISTIC empty config —
	// `loadAegisrc()`'s lookup is repo-cwd → homedir, first hit wins. Just
	// chdir-ing to a temp dir is NOT enough: if a developer has
	// `~/.aegisrc` with `providers."openai-compatible"` configured (which
	// is exactly what the manual REPL DoD instructs them to do for live
	// testing!), the home-fallback would supply baseURL+modelId, the
	// validator would PASS, and the test would route to the confirm
	// dialog instead of the refusal path — passing for the wrong reason
	// or failing because `node` is non-null. Write an explicit empty
	// `.aegisrc` in the temp cwd so the repo-cwd hit wins and the home
	// fallback is never consulted.
	const fs = await import('node:fs')
	const os = await import('node:os')
	const path = await import('node:path')
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-no-aegisrc-'))
	fs.writeFileSync(
		path.join(tmp, '.aegisrc'),
		JSON.stringify({ allowlist: [], providers: {} }),
		'utf8',
	)
	const origCwd = process.cwd()
	process.chdir(tmp)
	const { __resetAegisrcCacheForTest } = await import('../../../../src/medical/config/aegisrc.js')
	__resetAegisrcCacheForTest()
	try {
		const messages: string[] = []
		const onDone = (m: string) => { messages.push(m) }
		const node = await call(onDone as any, {} as any, 'set openai-compatible')
		expect(node).toBeNull() // no JSX = no React-tree side effect = no AppState write
		const all = messages.join('\n')
		expect(all).toContain('openai-compatible')
		expect(all).toContain('.aegisrc')
		expect(all).toContain('baseURL')
	} finally {
		process.chdir(origCwd)
		__resetAegisrcCacheForTest()
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})
