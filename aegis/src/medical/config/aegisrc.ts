import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

// Default zod object behavior is `.strip()` — unknown keys are silently
// dropped. We rely on that to defang accidental `apiKey` fields without
// failing the parse (which would lose the legitimate fields too). DO NOT
// add `.strict()` here: zod's strict mode rejects on unknown keys, which
// in our catch-and-default loader would silently discard the entire file.
const ProviderEntry = z.object({
	baseURL: z.string().url().optional(),
	// `modelId` and `knownModels` enable config-driven model selection for
	// `openai-compatible` (default preset has `defaultModelId: 'auto'`,
	// `knownModels: ['auto']` — useless on its own). Other providers may
	// override too if a clinical site pins to a specific model.
	modelId: z.string().optional(),
	knownModels: z.array(z.string()).optional(),
})
const AegisrcSchema = z.object({
	allowlist: z.array(z.string()).default([]),
	providers: z.record(z.string(), ProviderEntry).default({}),
})

export type Aegisrc = z.infer<typeof AegisrcSchema>

let memoized: { cwd: string; home: string; cfg: Aegisrc } | null = null

export function loadAegisrc(cwd: string = process.cwd(), home: string = homedir()): Aegisrc {
	if (memoized && memoized.cwd === cwd && memoized.home === home) return memoized.cfg
	const candidates = [join(cwd, '.aegisrc'), join(home, '.aegisrc')]
	for (const path of candidates) {
		if (!existsSync(path)) continue
		try {
			const raw = readFileSync(path, 'utf8')
			const parsed = JSON.parse(raw) as unknown
			const validated = AegisrcSchema.parse(parsed)
			memoized = { cwd, home, cfg: validated }
			return validated
		} catch {
			// fall through to defaults on any parse/validation error
			break
		}
	}
	const defaults: Aegisrc = { allowlist: [], providers: {} }
	memoized = { cwd, home, cfg: defaults }
	return defaults
}

export function __resetAegisrcCacheForTest(): void {
	memoized = null
}
