import {
	type SectionParseState,
	emptySectionState,
	parseSectionDeltas,
} from '../agent/sectionParser.js'
import { type CurrentNoteValue, mergeNote } from '../state/currentNote.js'
import type { InboundMiddleware } from './phiMiddleware.js'

type ContentBlock = { type: string; text?: string; [k: string]: unknown }

export function createNotePersist(deps: {
	setNote: (note: CurrentNoteValue) => void
	isDraftingContext: () => boolean
}): InboundMiddleware<
	{ message: { content: readonly ContentBlock[] }; [k: string]: unknown },
	{ message: { content: readonly ContentBlock[] }; [k: string]: unknown }
> {
	return {
		name: 'notePersist',
		async process(res, ctx) {
			if (!deps.isDraftingContext()) return res
			const text = res.message.content
				.filter((b) => b.type === 'text' && typeof b.text === 'string')
				.map((b) => b.text as string)
				.join('\n')
			if (text.length === 0) return res
			// Per-attempt section-parser state lives on ctx so a multi-block
			// streaming response (text → tool_use → text) doesn't lose the
			// mid-stream pending fence.
			const prevState: SectionParseState = ctx.sectionState ?? emptySectionState()
			const prevValue: CurrentNoteValue = ctx.noteValue ?? { free: null, filled_sections: {} }
			const r = parseSectionDeltas(text, prevState)
			const merged = mergeNote(prevValue, r.value)
			ctx.sectionState = r.state
			ctx.noteValue = merged
			deps.setNote(merged)
			return res
		},
	}
}
