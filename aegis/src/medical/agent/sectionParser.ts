import type { CurrentNoteValue } from '../state/currentNote.js'

export type SectionParseState = {
	/** Buffered prefix that did not yet contain a complete fence. */
	pending: string
}

export function emptySectionState(): SectionParseState {
	return { pending: '' }
}

export type SectionParseResult = {
	value: CurrentNoteValue
	state: SectionParseState
}

const BEGIN_RE = /<!--\s*aegis:section=([a-zA-Z0-9_\-]+)\s*-->/g
const END_TOKEN = '<!-- aegis:section=end -->'
const END_RE = /<!--\s*aegis:section=end\s*-->/g

/**
 * Parse a chunk of streamed assistant text into a `CurrentNoteValue` delta
 * + carry-over `state`. Reads:
 *   - `<!-- aegis:section=<id> -->` … `<!-- aegis:section=end -->` pairs
 *     into `filled_sections[id]` (later occurrences of the same id replace).
 *   - Anything outside fences into `free`.
 *
 * Partial fences at the tail (incomplete begin marker, or open begin without
 * end yet seen) are preserved in `state.pending` for the next chunk.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: streaming state-machine, complexity is structural
export function parseSectionDeltas(chunk: string, state: SectionParseState): SectionParseResult {
	const text = state.pending + chunk
	const filled: Record<string, string> = {}
	const freeParts: string[] = []

	let cursor = 0
	while (cursor < text.length) {
		BEGIN_RE.lastIndex = cursor
		const begin = BEGIN_RE.exec(text)
		if (!begin) {
			// No more begin markers — emit remainder as free, but if the suffix
			// looks like a partial begin marker, defer it to the next chunk.
			const tail = text.slice(cursor)
			const partialIdx = lastPotentialFenceStart(tail)
			if (partialIdx !== -1) {
				if (partialIdx > 0) freeParts.push(tail.slice(0, partialIdx).trim())
				return {
					value: { free: joinFree(freeParts), filled_sections: filled },
					state: { pending: tail.slice(partialIdx) },
				}
			}
			if (tail.length > 0) freeParts.push(tail.trim())
			return {
				value: { free: joinFree(freeParts), filled_sections: filled },
				state: { pending: '' },
			}
		}
		if (begin.index > cursor) {
			freeParts.push(text.slice(cursor, begin.index).trim())
		}
		const id = begin[1]
		if (id === 'end') {
			// Stray end — treat as inert prose so the caller can see it.
			freeParts.push(text.slice(begin.index, begin.index + begin[0].length))
			cursor = begin.index + begin[0].length
			continue
		}
		const bodyStart = begin.index + begin[0].length
		END_RE.lastIndex = bodyStart
		const end = END_RE.exec(text)
		if (!end) {
			// Open begin with no end yet — buffer the whole fragment for next chunk.
			return {
				value: { free: joinFree(freeParts), filled_sections: filled },
				state: { pending: text.slice(begin.index) },
			}
		}
		filled[id!] = text.slice(bodyStart, end.index).trim()
		cursor = end.index + end[0].length
	}
	return {
		value: { free: joinFree(freeParts), filled_sections: filled },
		state: { pending: '' },
	}
}

function joinFree(parts: readonly string[]): string | null {
	const joined = parts.filter(Boolean).join('\n').trim()
	return joined.length > 0 ? joined : null
}

/**
 * If `s` ends with a prefix of "<!-- aegis:section=" or with an open begin
 * that has no matching end, return that prefix's start index; else -1.
 */
function lastPotentialFenceStart(s: string): number {
	// Look for the latest "<!--" that isn't yet a complete comment.
	const idx = s.lastIndexOf('<!--')
	if (idx === -1) {
		// (P2 fix — split fence opener) When no '<!--' is found yet, the tail
		// could still be a partial prefix of one. Buffer the suffix so the
		// next chunk can complete the marker.
		if (s.endsWith('<!-')) return s.length - 3
		if (s.endsWith('<!')) return s.length - 2
		if (s.endsWith('<')) return s.length - 1
		return -1
	}
	const tail = s.slice(idx)
	// If the tail already closed the comment AND it wasn't a section fence,
	// it's not partial — treat it as plain text.
	const closed = tail.indexOf('-->')
	if (closed !== -1 && !/aegis:section=/.test(tail.slice(0, closed))) {
		return -1
	}
	// If it's a complete begin marker but no corresponding end appears later,
	// also defer (the open begin is partial in stream sense).
	if (
		/<!--\s*aegis:section=[a-zA-Z0-9_\-]+\s*-->/.test(tail) &&
		!/<!--\s*aegis:section=end\s*-->/.test(tail)
	) {
		return idx
	}
	if (closed === -1) return idx // incomplete comment marker
	return -1
}

// Re-export the end token in case downstream code wants to assemble fences.
export const SECTION_END_FENCE = END_TOKEN
