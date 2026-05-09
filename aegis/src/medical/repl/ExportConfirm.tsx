import * as React from 'react'
import { Box, Text, useInput } from '../../ink.js'
import type { PhiMode } from '../audit/AuditLogger.js'
import type { ExportPromptSummary } from '../export/NoteExportGate.js'

export type ExportConfirmKind = 'attestation' | 'phi-extra-confirm'

export type ExportConfirmDisplayProps = {
	kind: ExportConfirmKind
	target: string
	bytes: number
	mode: 'redacted' | 'full'
	phiMode: PhiMode
	phiEntityCounts: Record<string, number>
}

export type ExportConfirmProps = ExportConfirmDisplayProps & {
	onResolve: (result: { accepted: boolean; attestationText: string }) => void
}

/**
 * Tag drives rendering style:
 *   header     → bold (attestation top line)
 *   headerWarn → red bold (phi-extra-confirm top line, the warning headline)
 *   plain      → unformatted text
 *   warn       → red bold (mid-line emphasis, e.g. "About to persist N PHI…")
 *   prompt     → unformatted text, but the renderer prefixes a blank line for
 *                visual breathing room before the y/N question.
 *
 * Keep this taxonomy and the ExportConfirm renderer's tag→style mapping the
 * single source of truth: the lines test asserts on tag *sequences* (not
 * just substring presence), so a future re-order or insert in either kind's
 * line list will fail the test before it can silently mis-render the dialog
 * (e.g., the wrong line getting red-bold in the strict-full prompt).
 */
export type ExportConfirmLineKind = 'header' | 'headerWarn' | 'plain' | 'warn' | 'prompt'

export type ExportConfirmLine = {
	kind: ExportConfirmLineKind
	text: string
}

/**
 * Pure: computes the tagged lines the dialog will render. Extracted so the
 * rendered text + per-line styling intent can be unit-tested without
 * `ink-testing-library` (the in-tree inkRenderShim is null-render only). Keep
 * the React component a thin tag→style mapper so a future "simplify the
 * dialog" change can't silently downgrade the strict-full safety surface
 * (the per-type PHI counts MUST appear in both kinds — this is the
 * regression the lines list pins).
 */
export function getExportConfirmLines(p: ExportConfirmDisplayProps): ExportConfirmLine[] {
	const counts = Object.entries(p.phiEntityCounts)
		.map(([t, n]) => `${t}×${n}`)
		.join(', ')
	const totalEntities = Object.values(p.phiEntityCounts).reduce((a, n) => a + n, 0)
	if (p.kind === 'attestation') {
		const promptText =
			p.phiMode === 'strict'
				? 'Attest accuracy and proceed? (y/N)'
				: 'Acknowledge research/operational draft (not a medical record) and proceed? (y/N)'
		return [
			{ kind: 'header', text: 'Export preview' },
			{ kind: 'plain', text: `Target: ${p.target}` },
			{ kind: 'plain', text: `Size: ${p.bytes} bytes  Mode: ${p.mode}` },
			{
				kind: 'plain',
				text: `PHI entities (will be ${
					p.mode === 'redacted' ? 'REDACTED' : 'WRITTEN'
				}): ${counts || 'none detected'}`,
			},
			{ kind: 'prompt', text: promptText },
		]
	}
	return [
		{
			kind: 'headerWarn',
			text: '⚠ Strict mode + --full — final PHI confirmation',
		},
		{ kind: 'plain', text: `Target: ${p.target}` },
		{ kind: 'plain', text: `Size: ${p.bytes} bytes  Mode: ${p.mode}` },
		{
			kind: 'warn',
			text: `About to persist ${totalEntities} PHI entit${
				totalEntities === 1 ? 'y' : 'ies'
			} un-redacted.`,
		},
		{ kind: 'plain', text: `By type: ${counts || 'none detected'}` },
		{ kind: 'prompt', text: 'Confirm intent to persist PHI? (y/N)' },
	]
}

/**
 * Pure: computes a plain string[] from an ExportPromptSummary, including the
 * validator warnings block (non-blocking). Used by tests that work over raw
 * text rather than tagged ExportConfirmLine objects.
 */
export function buildExportConfirmLines(summary: ExportPromptSummary): string[] {
	const out: string[] = []
	out.push(`Target: ${summary.target}`)
	out.push(`Size: ${summary.bytes} bytes  Mode: ${summary.mode}`)
	out.push(`PHI mode: ${summary.phiMode}`)
	const counts = Object.entries(summary.phiEntityCounts)
		.map(([t, n]) => `${t}×${n}`)
		.join(', ')
	out.push(`PHI entities: ${counts || 'none detected'}`)
	if (summary.validatorWarnings && summary.validatorWarnings.count > 0) {
		out.push(`Validator (non-blocking): ${summary.validatorWarnings.count} warning(s)`)
		for (const w of summary.validatorWarnings.tail) {
			out.push(`  [${w.severity}] ${w.check}: ${w.message}`)
		}
	}
	return out
}

/**
 * Pure helper: returns the attestation/confirmation text returned by the
 * dialog when the clinician accepts. Branches on phiMode so research/off
 * exports never claim "clinical accuracy" — they explicitly disclaim
 * clinical-record use instead. strict-mode wording is unchanged from the
 * §6.9 master spec. Extracted so the useInput branch is unit-testable
 * without ink-testing-library.
 */
export function resolveAttestationText(kind: ExportConfirmKind, phiMode: PhiMode): string {
	if (kind === 'phi-extra-confirm') {
		return 'I confirm I intend to persist un-redacted PHI to the local filesystem.'
	}
	// kind === 'attestation'
	if (phiMode === 'strict') {
		return 'I have reviewed this note and attest it is accurate for this encounter.'
	}
	return "I acknowledge this output is a research/operational draft, not a medical record, and must not be filed in a patient's chart."
}

function renderLine(line: ExportConfirmLine, index: number): React.ReactNode {
	switch (line.kind) {
		case 'header':
			return (
				<Text key={index} bold>
					{line.text}
				</Text>
			)
		case 'headerWarn':
			return (
				<Text key={index} color="red" bold>
					{line.text}
				</Text>
			)
		case 'warn':
			return (
				<Text key={index} color="red" bold>
					{line.text}
				</Text>
			)
		case 'prompt':
			return <Text key={index}>{`\n${line.text}`}</Text>
		default:
			return <Text key={index}>{line.text}</Text>
	}
}

export function ExportConfirm(props: ExportConfirmProps): React.ReactNode {
	const [decided, setDecided] = React.useState(false)
	useInput((input, key) => {
		if (decided) return
		if (input === 'y' || input === 'Y') {
			setDecided(true)
			const text = resolveAttestationText(props.kind, props.phiMode)
			props.onResolve({ accepted: true, attestationText: text })
		} else if (input === 'n' || input === 'N' || key.escape) {
			setDecided(true)
			props.onResolve({ accepted: false, attestationText: '' })
		}
	})
	const lines = getExportConfirmLines(props)
	return (
		<Box flexDirection="column" borderStyle="round" paddingX={1}>
			{lines.map(renderLine)}
		</Box>
	)
}
