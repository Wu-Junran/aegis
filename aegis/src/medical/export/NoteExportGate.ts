import { randomBytes } from 'node:crypto'
import { closeSync, fsyncSync, linkSync, openSync, unlinkSync, writeSync } from 'node:fs'
import type { AuditLogger, PhiMode } from '../audit/AuditLogger.js'
import { sha256Hex } from '../audit/redaction.js'
import type { DeIdentifier } from '../deid/DeIdentifier.js'

/**
 * M6 widens format to accept 'md' | 'pdf'. The template renderer is now
 * section-aware and delegates to MCP render_template, which handles both
 * markdown and PDF output formats.
 */
export type ExportOpts = {
	target: string
	format: 'md' | 'pdf'
	mode: 'redacted' | 'full'
}

export type ExportResult = {
	path: string
	bytesWritten: number
	mode: 'redacted' | 'full'
}

export type ExportPromptResponse = {
	accepted: boolean
	attestationText: string
}

/**
 * Summary handed to the prompt before sign-off — populated for every mode
 * (decision per P1#4 review). The clinician sees what they are about to
 * persist regardless of redact/full or strict/research/off.
 */
export type ExportPromptSummary = {
	target: string
	bytes: number
	mode: 'redacted' | 'full'
	phiMode: PhiMode
	/** Counts from a Presidio scan over the FINAL payload (post-render, post-mode-transform). */
	phiEntityCounts: Record<string, number>
	/** (M6) Full-check-set validator output for the rendered draft. */
	validatorWarnings: {
		count: number
		/** Up to 5, sorted by (severity, check) per orchestrator. */
		tail: Array<{ check: string; severity: 'info' | 'warn'; message: string }>
	}
}

export type NoteExportGateDeps = {
	deid: DeIdentifier
	phiMode: PhiMode
	logger: AuditLogger
	render: (note: string, format: 'md' | 'pdf') => Promise<string>
	prompt: (
		kind: 'attestation' | 'phi-extra-confirm',
		summary: ExportPromptSummary,
	) => Promise<ExportPromptResponse>
	/**
	 * (M6) Validator callback. Receives the rendered draft (markdown) and the
	 * current template; returns the full check-set warnings. A throw is
	 * tolerated by the gate (logs `note_export_validator_error` and proceeds
	 * with an empty list) so the export path never breaks because validation
	 * tooling failed.
	 */
	validate?: (renderedNote: string) => Promise<
		ReadonlyArray<{
			check: string
			severity: 'info' | 'warn'
			message: string
			evidence?: Record<string, unknown>
		}>
	>
	/**
	 * **TEST-ONLY hook**, fires AFTER the temp file is written + closed and
	 * BEFORE the atomic linkSync that finalizes onto `target`. Tests can use
	 * this to create the target inside the precise race window that `linkSync`
	 * (atomic-no-replace) is supposed to close — proving the implementation
	 * is impl-discriminating, not just precheck-then-rename which would also
	 * pass the cruder "create-during-prompt" race test. Production callers
	 * leave this undefined.
	 */
	__beforeFinalizeForTests?: (tmpPath: string, target: string) => Promise<void>
	/**
	 * **TEST-ONLY hook**, fires AFTER the atomic linkSync succeeds and BEFORE
	 * the post-link `unlinkSync(tmpPath)` cleanup. Sabotaging the tmp path
	 * here (e.g. `unlinkSync(tmpPath)` in the hook so the production cleanup
	 * sees ENOENT) drives the cleanup-failure branch added by the P2 review:
	 * link success is the COMMIT POINT, so a cleanup failure must NOT be
	 * surfaced as a failed export — the gate emits a non-fatal
	 * `note_export_tmp_cleanup_failed` warning entry and returns success.
	 * Production callers leave this undefined; for `node:fs` ESM read-only
	 * bindings this is the only portable way to drive the branch in-process.
	 */
	__afterLinkBeforeCleanupForTests?: (tmpPath: string, target: string) => Promise<void>
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: export gate orchestrates multiple I/O stages, structural complexity is intentional
export async function runNoteExportGate(
	fullNote: string,
	opts: ExportOpts,
	deps: NoteExportGateDeps,
): Promise<ExportResult> {
	// 1. Render: template-section assembly + format polish (M2 renderer).
	let body = await deps.render(fullNote, opts.format)

	// (R.2) Attestation kind tag — computed once and stamped on every export-
	// related audit entry (intent / completed / declined). Strict mode requires
	// a clinical sign-off; research/off modes use a research-use attestation.
	const attestation_kind: 'clinical' | 'research_use' =
		deps.phiMode === 'strict' ? 'clinical' : 'research_use'

	// 2. Mode transform — strict + redacted re-runs deid; other modes pass through.
	if (deps.phiMode === 'strict' && opts.mode === 'redacted') {
		const r = await deps.deid.redact(body)
		if (typeof r.redacted !== 'string') {
			throw new Error('NoteExportGate: redact returned an array for a single-string input')
		}
		body = r.redacted
	}

	// 3. PHI summary over the FINAL payload — for EVERY mode (decision per P1#4
	// review). The clinician needs to see what will be written regardless of
	// mode; the strict + redacted case additionally enforces zero residual.
	const summaryScan = await deps.deid.redact(body)
	const phiEntityCounts: Record<string, number> = {}
	for (const e of Object.values(summaryScan.mapping.entries)) {
		phiEntityCounts[e.type] = (phiEntityCounts[e.type] ?? 0) + 1
	}

	if (deps.phiMode === 'strict' && opts.mode === 'redacted') {
		if (Object.keys(summaryScan.mapping.entries).length > 0) {
			throw new Error(
				`NoteExportGate: residual PHI detected after redaction (${
					Object.keys(summaryScan.mapping.entries).length
				} entities). Refusing to write.`,
			)
		}
	}

	// 3.5 (M6) Full validator check-set — non-blocking. Failure → audit
	// entry + empty list; never break the export path.
	let validatorWarnings: ExportPromptSummary['validatorWarnings'] = { count: 0, tail: [] }
	if (deps.validate) {
		try {
			const ws = await deps.validate(body)
			validatorWarnings = {
				count: ws.length,
				tail: ws.slice(0, 5).map((w) => ({
					check: w.check,
					severity: w.severity,
					message: w.message,
				})),
			}
		} catch (err) {
			await deps.logger.append({
				ts: new Date().toISOString(),
				type: 'note_export_validator_error',
				requestId: 'export-gate',
				mode: deps.phiMode,
				target: opts.target,
				error: (err as Error).message,
			})
		}
	}

	// (M6) PDF post-render: convert rendered markdown to deterministic PDF
	// bytes BEFORE the disk write. The validator + PHI summary still see
	// markdown text (Presidio is text-only); only the bytes hit disk.
	let bytesToWrite: string | Buffer = body
	if (opts.format === 'pdf') {
		const { markdownToPdf } = await import('./pdfRenderer.js')
		bytesToWrite = await markdownToPdf(body)
	}

	const bytes =
		typeof bytesToWrite === 'string'
			? Buffer.byteLength(bytesToWrite, 'utf-8')
			: bytesToWrite.byteLength
	const summary: ExportPromptSummary = {
		target: opts.target,
		bytes,
		mode: opts.mode,
		phiMode: deps.phiMode,
		phiEntityCounts,
		validatorWarnings,
	}

	// 4. Sign-off (clinician sees PHI summary for every mode).
	const att = await deps.prompt('attestation', summary)
	if (!att.accepted) {
		await deps.logger.append({
			ts: new Date().toISOString(),
			type: 'note_export_declined',
			requestId: 'export-gate',
			mode: deps.phiMode,
			target: opts.target,
			phiEntityCounts,
			attestation_kind,
		})
		throw new Error('Clinician declined sign-off; export aborted.')
	}

	// 4b. Strict + --full requires an extra PHI-to-disk confirmation, also
	// showing the same summary so the count of PHI entities about to be
	// persisted is the visible centerpiece of the second prompt.
	if (deps.phiMode === 'strict' && opts.mode === 'full') {
		const extra = await deps.prompt('phi-extra-confirm', summary)
		if (!extra.accepted) {
			await deps.logger.append({
				ts: new Date().toISOString(),
				type: 'note_export_declined',
				requestId: 'export-gate',
				mode: deps.phiMode,
				target: opts.target,
				phiEntityCounts,
				reason: 'phi-extra-confirm rejected',
				attestation_kind,
			})
			throw new Error('Strict-mode --full PHI confirmation declined.')
		}
	}

	// 5. Write-ahead audit (intent BEFORE the disk write).
	await deps.logger.append({
		ts: new Date().toISOString(),
		type: 'note_export_intent',
		requestId: 'export-gate',
		mode: deps.phiMode,
		target: opts.target,
		bytes,
		phiEntityCounts,
		attestation: true,
		attestation_kind,
		finalRedactedHash: sha256Hex(body),
	})

	// 6. Atomic 0600 write via temp file + atomic-no-replace link (spec §6.9
	// safety note). Open with 'wx' so the temp's permissive default never holds
	// PHI even briefly, write + fsync + close, then `linkSync(tmp, target)` to
	// finalize. We DELIBERATELY use linkSync over renameSync because POSIX
	// rename silently REPLACES an existing target — if `opts.target` came
	// into existence between sign-off and finalization (concurrent process,
	// clinician saving from another tool, race with another /note export),
	// a `renameSync(tmp, target)` would happily overwrite it. `linkSync` fails
	// with `EEXIST` when target already exists; that's the atomic "create
	// exclusively" finalization we need.
	//
	// The link succeeds → unlinkSync(tmp) cleans the now-redundant temp. The
	// link fails → catch logs note_export_failed (every intent has a terminal
	// partner) and the temp is unlinked for cleanup.
	//
	// No pre-flight existsSync: that check would only mislead a reader into
	// thinking the refusal is checked "early" when in reality only linkSync's
	// atomic semantics make the refusal safe under concurrency.
	//
	// Portability: linkSync requires source + target on the same filesystem.
	// Both paths are in the same directory by construction (`<target>.tmp.…`),
	// so this is safe on POSIX. On Windows, linkSync creates a hardlink with
	// the same fail-if-exists semantics.
	// Use crypto.randomBytes for the suffix: Math.random() has a non-zero
	// collision probability across concurrent invocations, and on collision
	// openSync('wx') would EEXIST → catch path would mis-attribute the error
	// as `reason: 'target-exists'` (it isn't — the *temp* collided, not the
	// target) AND `unlinkSync(tmpPath)` would silently delete the colliding
	// run's file. crypto-grade entropy reduces collision probability to
	// effectively zero and is the right primitive for PHI-handling code.
	const tmpPath = `${opts.target}.tmp.${process.pid}.${randomBytes(16).toString('hex')}`
	let fd: number | null = null
	let linked = false
	try {
		fd = openSync(tmpPath, 'wx', 0o600)
		if (typeof bytesToWrite === 'string') {
			writeSync(fd, bytesToWrite)
		} else {
			writeSync(fd, bytesToWrite)
		}
		fsyncSync(fd)
		closeSync(fd)
		fd = null
		// [Test-only race-window hook — see NoteExportGateDeps doc.] Fires after
		// the temp is fully durable on disk but before linkSync finalizes. A
		// precheck-then-rename impl could not fail this hook's race; only an
		// atomic-no-replace finalization (linkSync) can.
		if (deps.__beforeFinalizeForTests) {
			await deps.__beforeFinalizeForTests(tmpPath, opts.target)
		}
		linkSync(tmpPath, opts.target) // atomic; fails EEXIST if target appeared
		// [P2 review] linkSync success is the COMMIT POINT — the target is now
		// a durable hardlink to the body bytes. Anything that fails after this
		// line (temp cleanup, post-write audit) must NOT report the export as
		// failed: the file is on disk and the clinician-visible outcome is
		// success. Unlinking the temp is best-effort housekeeping; on POSIX
		// failures here (e.g. parent dir mode flipped read-only between link
		// and unlink, NFS quirks) we leave the temp behind and continue.
		linked = true
		if (deps.__afterLinkBeforeCleanupForTests) {
			await deps.__afterLinkBeforeCleanupForTests(tmpPath, opts.target)
		}
		try {
			unlinkSync(tmpPath) // happy-path cleanup of the temp side
		} catch (cleanupErr) {
			// Do NOT enter the outer catch — the export succeeded. Log a non-
			// fatal warning entry so the audit trail records the orphan tmp
			// file for housekeeping, then fall through to step 7 (completed).
			await deps.logger.append({
				ts: new Date().toISOString(),
				type: 'note_export_tmp_cleanup_failed',
				requestId: 'export-gate',
				mode: deps.phiMode,
				target: opts.target,
				tmpPath,
				error: (cleanupErr as Error).message,
			})
		}
	} catch (err) {
		// Only reachable when the export did NOT commit (openSync, write/fsync,
		// hook, or linkSync threw). The `linked` guard is a belt-and-suspenders
		// assertion: every successful linkSync path sets `linked = true` BEFORE
		// its inner try/catch and never re-enters this block. If we are here,
		// the target was never created and the temp may or may not exist.
		if (linked) {
			// Defensive: would only fire if a future refactor moves the linked-
			// assignment after a throwing call. Treat as a programmer error.
			throw new Error(
				`NoteExportGate: internal invariant violated — outer catch reached after commit. Original error: ${(err as Error).message}`,
			)
		}
		if (fd !== null) {
			try {
				closeSync(fd)
			} catch {
				/* swallow */
			}
		}
		try {
			unlinkSync(tmpPath)
		} catch {
			/* swallow */
		}
		const code = (err as NodeJS.ErrnoException).code
		const msg = (err as Error).message
		await deps.logger.append({
			ts: new Date().toISOString(),
			type: 'note_export_failed',
			requestId: 'export-gate',
			mode: deps.phiMode,
			target: opts.target,
			error: msg,
			reason: code === 'EEXIST' ? 'target-exists' : 'write-error',
		})
		if (code === 'EEXIST') {
			throw new Error(
				`NoteExportGate: target already exists: ${opts.target} (refusing to overwrite)`,
			)
		}
		throw err
	}

	// 7. Post-write audit. Wrapped: if the completed-event append throws
	// (logger fs unavailable, JSON serialization edge), the file is on disk
	// and the intent is in the log — without this guard the "every intent has
	// a partner" invariant would silently break. We emit a terminal
	// `note_export_failed` with `reason: 'completed-audit-failed'` so the log
	// remains balanced, then re-raise the original error so callers know the
	// post-write audit didn't reach disk.
	try {
		await deps.logger.append({
			ts: new Date().toISOString(),
			type: 'note_export_completed',
			requestId: 'export-gate',
			mode: deps.phiMode,
			target: opts.target,
			bytesWritten: bytes,
			finalRedactedHash: sha256Hex(body),
			attestation_kind,
		})
	} catch (err) {
		try {
			await deps.logger.append({
				ts: new Date().toISOString(),
				type: 'note_export_failed',
				requestId: 'export-gate',
				mode: deps.phiMode,
				target: opts.target,
				error: (err as Error).message,
				reason: 'completed-audit-failed',
			})
		} catch {
			// The terminal-partner append also failed. Logger is wedged; the
			// original error below is what the caller cares about. Don't mask it
			// by throwing the second-tier audit failure.
		}
		throw err
	}

	return { path: opts.target, bytesWritten: bytes, mode: opts.mode }
}
