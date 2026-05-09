import { test, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC_ROOT = join(__dirname, '../../../../src')
const ALLOWED_IMPORTERS = new Set([
	'services/api/bootstrap.ts',
	'services/api/sessionProvider.ts', // self-reference
])
const ALLOWED_DEFINER = 'services/api/sessionProvider.ts'

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		const st = statSync(full)
		if (st.isDirectory()) {
			walk(full, out)
		} else if (/\.(ts|tsx)$/.test(entry)) {
			out.push(full)
		}
	}
	return out
}

test('only sessionProvider.ts defines setSessionProvider', () => {
	const definers: string[] = []
	for (const file of walk(SRC_ROOT)) {
		const text = readFileSync(file, 'utf8')
		if (/export\s+function\s+setSessionProvider\b/.test(text)) {
			const rel = file.slice(SRC_ROOT.length + 1)
			definers.push(rel)
		}
	}
	expect(definers).toEqual([ALLOWED_DEFINER])
})

test('only bootstrap.ts imports setSessionProvider from production code', () => {
	const importers: string[] = []
	for (const file of walk(SRC_ROOT)) {
		const text = readFileSync(file, 'utf8')
		const rel = file.slice(SRC_ROOT.length + 1)
		if (rel === ALLOWED_DEFINER) continue
		// Match: import {  ...setSessionProvider...  } from '...sessionProvider.js'
		const importMatch =
			/import\s+\{[^}]*\bsetSessionProvider\b[^}]*\}\s+from\s+['"][^'"]*sessionProvider(\.js)?['"]/m.test(
				text,
			)
		if (importMatch) importers.push(rel)
	}
	expect(importers).toEqual([...ALLOWED_IMPORTERS].filter((p) => p !== ALLOWED_DEFINER))
})
