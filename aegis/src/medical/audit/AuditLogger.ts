import { closeSync, fchmodSync, fsyncSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

export type PhiMode = 'strict' | 'research' | 'off'

export type AuditEntry = {
	ts: string
	type: string
	requestId: string
	mode: PhiMode
	[k: string]: unknown
}

export interface AuditLogger {
	append(entry: AuditEntry): Promise<void>
	close(): Promise<void>
}

export function openAuditLogger(path: string, _mode: PhiMode): AuditLogger {
	// Create parent dir lazily on first append so a never-used logger doesn't
	// litter ~/.aegis. Track whether we've opened the fd yet.
	let fd: number | null = null
	let queue: Promise<void> = Promise.resolve()
	let closed = false

	function ensureOpen(): number {
		if (fd === null) {
			mkdirSync(dirname(path), { recursive: true })
			fd = openSync(path, 'a', 0o600)
			// The mode arg to `openSync` is documented as the permissions applied
			// **only if the file is created**. If a session resumes against a
			// pre-existing audit log that was somehow chmod'd permissive (e.g.,
			// `umask 022` setup, manual edit, snapshot restore from a different
			// user), the open-time mode would be silently ignored and we'd keep
			// appending PHI-bearing entries to a world-readable file. fchmodSync
			// applies 0600 unconditionally — new file or existing — closing the gap.
			fchmodSync(fd, 0o600)
		}
		return fd
	}

	async function append(entry: AuditEntry): Promise<void> {
		if (closed) throw new Error('AuditLogger is closed')
		// Serialize all writes through one tail-promise to preserve ordering even
		// under concurrent callers (per spec §5.3 invariant #4 the entry must be
		// fsynced before the network call returns control).
		const tail = queue.then(async () => {
			const f = ensureOpen()
			const line = `${JSON.stringify(entry)}\n`
			writeSync(f, line)
			fsyncSync(f)
		})
		queue = tail.catch(() => undefined) // don't poison the queue on one bad entry
		await tail
	}

	async function close(): Promise<void> {
		closed = true
		await queue
		if (fd !== null) {
			closeSync(fd)
			fd = null
		}
	}

	return { append, close }
}
