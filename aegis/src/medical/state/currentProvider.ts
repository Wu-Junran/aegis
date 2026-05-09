import type { ProviderConfig } from '../providers/ProviderAdapter.js'

export type CurrentProviderSlice = { currentProvider: ProviderConfig | null }

export function createCurrentProviderSlice(): CurrentProviderSlice {
	return { currentProvider: null }
}
