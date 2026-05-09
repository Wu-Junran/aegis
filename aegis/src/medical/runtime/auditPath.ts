import { join } from 'node:path'

const SAFE_SESSION_RE = /^[A-Za-z0-9_-]+$/

export function defaultAuditLogPath(sessionId: string, home: string): string {
	if (!SAFE_SESSION_RE.test(sessionId)) {
		throw new Error(
			`unsafe session id for audit log path: ${sessionId} (must match ${SAFE_SESSION_RE})`,
		)
	}
	return join(home, '.aegis', 'audit', `${sessionId}.jsonl`)
}
