import type { SessionProviderId } from './ProviderAdapter.js'

const KEYCHAIN_SERVICE = 'aegis'

const ENV_KEY: Record<SessionProviderId, string> = {
	anthropic: 'ANTHROPIC_API_KEY',
	openai: 'OPENAI_API_KEY',
	'openai-compatible': 'OPENAI_COMPATIBLE_API_KEY',
	glm: 'ZHIPUAI_API_KEY',
	minimax: 'MINIMAX_API_KEY',
}

export class MissingCredentialError extends Error {
	constructor(public readonly providerId: SessionProviderId) {
		// Anthropic credentials are owned upstream (OAuth or ANTHROPIC_API_KEY);
		// `renderCreds` rejects `/provider creds anthropic` on purpose, so
		// pointing the user there would be a dead end. Anthropic message keeps
		// the recovery text strictly upstream — no `/provider creds` mention,
		// so the regression test can pin "anthropic message MUST NOT contain
		// /provider creds" as a load-bearing invariant. For all other
		// providers, the masked `/provider creds <id>` paste flow is the right
		// next step.
		const remediation =
			providerId === 'anthropic'
				? 'Set ANTHROPIC_API_KEY or complete the upstream OAuth flow.'
				: `Set ${ENV_KEY[providerId]} or run \`/provider creds ${providerId}\`.`
		super(`No credential for provider "${providerId}". ${remediation}`)
		this.name = 'MissingCredentialError'
	}
}

type KeytarLike = {
	getPassword: (service: string, account: string) => Promise<string | null>
	setPassword: (service: string, account: string, password: string) => Promise<void>
	deletePassword: (service: string, account: string) => Promise<boolean>
}

let injectedKeytar: KeytarLike | null = null
let cachedKeytar: KeytarLike | null | undefined = undefined

async function loadKeytar(): Promise<KeytarLike | null> {
	if (injectedKeytar) return injectedKeytar
	if (cachedKeytar !== undefined) return cachedKeytar
	try {
		const mod = (await import('keytar')) as unknown as { default?: KeytarLike } & KeytarLike
		cachedKeytar = (mod.default ?? mod) as KeytarLike
		return cachedKeytar
	} catch {
		cachedKeytar = null
		return null
	}
}

export async function loadCredential(id: SessionProviderId): Promise<string> {
	const fromEnv = process.env[ENV_KEY[id]]
	if (fromEnv && fromEnv.length > 0) return fromEnv
	const kt = await loadKeytar()
	if (kt) {
		const stored = await kt.getPassword(KEYCHAIN_SERVICE, id)
		if (stored && stored.length > 0) return stored
	}
	throw new MissingCredentialError(id)
}

export async function saveCredential(id: SessionProviderId, password: string): Promise<void> {
	const kt = await loadKeytar()
	if (!kt) {
		throw new Error(
			'Keytar is not installed; cannot persist credentials. Use the env var fallback instead.',
		)
	}
	await kt.setPassword(KEYCHAIN_SERVICE, id, password)
}

export async function clearCredential(id: SessionProviderId): Promise<void> {
	const kt = await loadKeytar()
	if (!kt) return
	await kt.deletePassword(KEYCHAIN_SERVICE, id)
}

// Test injection — never used in production paths.
export function __setKeytarForTest(kt: KeytarLike): void {
	injectedKeytar = kt
}
export function __clearKeytarForTest(): void {
	injectedKeytar = null
	cachedKeytar = undefined
}
