import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadAegisrc } from '../../../../src/medical/config/aegisrc.js'

function withTempDir(fn: (dir: string) => void) {
	const dir = mkdtempSync(join(tmpdir(), 'aegisrc-'))
	try { fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('returns empty defaults when no .aegisrc exists', () => {
	withTempDir((dir) => {
		const cfg = loadAegisrc(dir, /*homedir*/ dir)
		expect(cfg.allowlist).toEqual([])
		expect(cfg.providers).toEqual({})
	})
})

test('loads repo-relative .aegisrc', () => {
	withTempDir((dir) => {
		copyFileSync(
			join(__dirname, '../../../fixtures/aegisrc/valid.json'),
			join(dir, '.aegisrc'),
		)
		const cfg = loadAegisrc(dir, dir)
		expect(cfg.allowlist).toEqual(['anthropic', 'openai'])
		expect(cfg.providers.openai?.baseURL).toBe('https://api.openai.com/v1')
	})
})

test('repo-relative wins over homedir', () => {
	withTempDir((repo) => {
		withTempDir((home) => {
			writeFileSync(join(repo, '.aegisrc'), JSON.stringify({ allowlist: ['openai'], providers: {} }))
			writeFileSync(join(home, '.aegisrc'), JSON.stringify({ allowlist: ['glm'], providers: {} }))
			const cfg = loadAegisrc(repo, home)
			expect(cfg.allowlist).toEqual(['openai'])
		})
	})
})

test('strips secret-like fields silently (zod default .strip() drops unknown keys, allowlist + baseURL preserved)', () => {
	withTempDir((dir) => {
		copyFileSync(
			join(__dirname, '../../../fixtures/aegisrc/with-secret-leak.json'),
			join(dir, '.aegisrc'),
		)
		const cfg = loadAegisrc(dir, dir)
		// allowlist preserved (would be lost if we used .strict() — that path
		// would throw and fall through to the catch → empty defaults).
		expect(cfg.allowlist).toEqual(['openai'])
		const provider = cfg.providers.openai as Record<string, unknown>
		expect(provider).not.toHaveProperty('apiKey')
		expect(provider.baseURL).toBe('https://api.openai.com/v1')
	})
})

test('returns defaults on malformed JSON (does not throw)', () => {
	withTempDir((dir) => {
		writeFileSync(join(dir, '.aegisrc'), '{ this is not json')
		const cfg = loadAegisrc(dir, dir)
		expect(cfg.allowlist).toEqual([])
	})
})
