import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import type { Message } from '../../types/message.js'
import { extractTextContent } from '../../utils/messages.js'
import { ExportNoteCommand } from './ExportNoteCommand.js'
import { noteToText } from '../../medical/state/currentNote.js'

/**
 * M6 widens format to accept 'md' | 'pdf'. The template renderer is now
 * section-aware and delegates to MCP render_template, which handles both
 * markdown and PDF output formats.
 */
export type ExportArgs = {
  target: string
  format: 'md' | 'pdf'
  mode: 'redacted' | 'full'
}

export function parseExportArgs(rawArgs: string): ExportArgs {
  const tokens = rawArgs.trim().split(/\s+/)
  if (tokens[0] !== 'export') throw new Error('not an export command')
  const target = tokens[1]
  if (!target || target.startsWith('--')) {
    throw new Error('Usage: /note export <path> [--format md] [--redacted|--full]')
  }
  let format: 'md' | 'pdf' = 'md'
  let mode: 'redacted' | 'full' = 'redacted'
  for (let i = 2; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '--format') {
      const v = tokens[++i]
      if (v === undefined) {
        throw new Error('Missing value for --format (expected md|pdf)')
      }
      if (v !== 'md' && v !== 'pdf') {
        throw new Error(`Unknown format: ${v} (expected md|pdf)`)
      }
      format = v
    } else if (t === '--redacted') {
      mode = 'redacted'
    } else if (t === '--full') {
      mode = 'full'
    } else {
      throw new Error(`Unknown flag: ${t}`)
    }
  }
  return { target, format, mode }
}

type Props = {
	latestAssistantText: string | null
	onDone: (
		result?: string,
		options?: { display?: 'system' | 'user' },
	) => void
}

function NoteCommand({
	latestAssistantText,
	onDone,
}: Props): React.ReactNode {
	React.useEffect(() => {
		onDone(
			latestAssistantText ??
				'No drafted note yet. Run a drafting prompt first.',
			{ display: 'system' },
		)
	}, [latestAssistantText, onDone])
	return (
		<Box>
			<Text />
		</Box>
	)
}

function lastAssistantText(messages: readonly Message[]): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]
		if (m?.type === 'assistant') {
			const blocks = (m as { message?: { content?: unknown } }).message
				?.content as readonly { type: string }[] | undefined
			if (!blocks) continue
			const text = extractTextContent(blocks, '\n')
			if (text) return text
		}
	}
	return null
}

export const call: LocalJSXCommandCall = async (onDone, ctx, rawArgs) => {
	const sub = rawArgs.trim().split(/\s+/)[0] || 'show'
	if (sub === 'export') {
		let parsed: ExportArgs
		try {
			parsed = parseExportArgs(rawArgs.trim())
		} catch (err) {
			onDone((err as Error).message, { display: 'system' })
			return null
		}
		return <ExportNoteCommand args={parsed} onDone={onDone} />
	}
	if (sub !== 'show') {
		onDone('Usage: /note show', { display: 'system' })
		return null
	}
	// M4: AppState.currentNote is the authoritative source (written by the
	// notePersist inbound middleware after every drafting-context response).
	// Fall back to the M3 transcript scrape only when currentNote is null
	// (e.g., session resumed without an intervening draft turn).
	const stored = noteToText(ctx.getAppState().currentNote)
	if (stored != null) {
		return <NoteCommand latestAssistantText={stored} onDone={onDone} />
	}
	// LocalJSXCommandContext has setMessages(updater) but no getter — use the
	// identity-updater trick to read the current list in-closure.
	let snapshot: Message[] = []
	ctx.setMessages(prev => {
		snapshot = [...prev]
		return prev
	})
	const latest = lastAssistantText(snapshot)
	return <NoteCommand latestAssistantText={latest} onDone={onDone} />
}
