import { createHash } from 'node:crypto'
import type { PhiMapping } from '../deid/DeIdentifier.js'

export function sha256Hex(s: string): string {
	return `sha256:${createHash('sha256').update(s).digest('hex')}`
}

export function entityCountsFromMapping(m: PhiMapping): Record<string, number> {
	const out: Record<string, number> = {}
	for (const e of Object.values(m.entries)) {
		out[e.type] = (out[e.type] ?? 0) + 1
	}
	return out
}

export function entityHashesFromMapping(m: PhiMapping): string[] {
	const seen = new Set<string>()
	for (const e of Object.values(m.entries)) seen.add(sha256Hex(e.original))
	return [...seen]
}
