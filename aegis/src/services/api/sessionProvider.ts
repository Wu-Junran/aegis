import type { ProviderConfig, SessionProviderId } from '../../medical/providers/ProviderAdapter.js'

let session: ProviderConfig | null = null
const confirmed: Set<SessionProviderId> = new Set()

export function getSessionProvider(): ProviderConfig | null {
	return session
}

export function setSessionProvider(next: ProviderConfig | null): void {
	session = next
}

export function hasConfirmedProvider(id: SessionProviderId): boolean {
	return confirmed.has(id)
}

export function markProviderConfirmed(id: SessionProviderId): void {
	confirmed.add(id)
}

export function clearConfirmedProviders(): void {
	confirmed.clear()
}
