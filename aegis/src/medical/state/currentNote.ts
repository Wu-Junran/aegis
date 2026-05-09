export type CurrentNoteValue = {
	free: string | null
	filled_sections: Record<string, string>
}

export type CurrentNoteSlice = { currentNote: CurrentNoteValue }

export function emptyNote(): CurrentNoteValue {
	return { free: null, filled_sections: {} }
}

export function createCurrentNoteSlice(): CurrentNoteSlice {
	return { currentNote: emptyNote() }
}

/**
 * Merge two `CurrentNoteValue`s. `free` strings concatenate (`a\nb`); section
 * ids in `b` overwrite section bodies in `a`. Used by the section parser
 * + notePersist middleware to accumulate streaming deltas across multiple
 * `content_block_stop` events in a single turn.
 */
export function mergeNote(a: CurrentNoteValue, b: CurrentNoteValue): CurrentNoteValue {
	const free = a.free && b.free ? `${a.free}\n${b.free}` : (a.free ?? b.free ?? null)
	return {
		free,
		filled_sections: { ...a.filled_sections, ...b.filled_sections },
	}
}

/**
 * (P1#1 fix) Adapter for callers that previously read `currentNote` as
 * `string | null`. Returns the most-useful textual representation of the
 * note for surfaces that don't yet care about per-section structure
 * (`/note show`, the export flow's existence check, REPL banners, etc.).
 *
 * Order: `free` text wins (it's the M3/M4 happy-path payload the model
 * delivered before adopting the section-fence contract). When `free` is
 * absent and there are filled sections, concatenate them in section
 * insertion order — the renderer is responsible for the template-formatted
 * version, but a textual fallback is needed for `/note show` to display
 * something meaningful for section-aware-only sessions.
 */
export function noteToText(value: CurrentNoteValue): string | null {
	if (value.free && value.free.length > 0) return value.free
	const ids = Object.keys(value.filled_sections)
	if (ids.length === 0) return null
	const parts = ids
		.map((id) => {
			const body = value.filled_sections[id] ?? ''
			if (body.length === 0) return null
			return `## ${id}\n${body}`
		})
		.filter((p): p is string => p !== null)
	if (parts.length === 0) return null
	return parts.join('\n\n')
}

/**
 * Reconstruct a fenced-section note for validator input. Used by the
 * export-gate validator path because `render_template` strips fences into
 * `## Heading` markdown — the Python `sections` check would otherwise
 * report every section as missing. The free-text body (if any) precedes
 * the fenced sections so checks 1-4 still see free-form clinical prose.
 */
export function noteToFencedString(value: CurrentNoteValue): string {
	const parts: string[] = []
	if (value.free && value.free.length > 0) parts.push(value.free)
	for (const [id, body] of Object.entries(value.filled_sections)) {
		if (id === 'end') continue
		parts.push(`<!-- aegis:section=${id} -->\n${body}\n<!-- aegis:section=end -->`)
	}
	return parts.join('\n\n')
}

/**
 * (P1#1 fix) Empty predicate — replaces the legacy `note == null` checks
 * after the slice widens. A note is "empty" when neither `free` text nor
 * any populated section body is present.
 */
export function isEmptyNote(value: CurrentNoteValue): boolean {
	if (value.free && value.free.length > 0) return false
	for (const v of Object.values(value.filled_sections)) {
		if (v && v.length > 0) return false
	}
	return true
}
