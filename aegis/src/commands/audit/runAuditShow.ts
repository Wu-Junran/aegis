import { readFileSync, existsSync } from 'node:fs'

export type AuditShowResult =
  | { ok: true; message: string }
  | { ok: false; message: string }

export type RunAuditShowDeps = {
  auditLogPath: string | null
  args: string
}

const DEFAULT_TAIL = 50

export async function runAuditShow(deps: RunAuditShowDeps): Promise<AuditShowResult> {
  if (!deps.auditLogPath) {
    return {
      ok: false,
      message:
        'auditLogPath not initialized; no session audit log to show. ' +
        'Run any drafting prompt or `/note export` first.',
    }
  }
  if (!existsSync(deps.auditLogPath)) {
    return { ok: true, message: '(audit log empty)' }
  }
  const tokens = deps.args.trim().split(/\s+/).slice(1) // drop "show"
  let full = false
  let tail = DEFAULT_TAIL
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '--full') full = true
    else if (t === '--tail') {
      const n = Number(tokens[++i])
      if (Number.isFinite(n) && n > 0) tail = Math.floor(n)
      else return { ok: false, message: '--tail requires a positive integer' }
    } else if (t) {
      return { ok: false, message: `Unknown flag: ${t}` }
    }
  }
  const raw = readFileSync(deps.auditLogPath, 'utf-8')
  const entries: Array<Record<string, unknown>> = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    try {
      entries.push(JSON.parse(line))
    } catch {
      // Skip malformed line silently (corrupted-tail tolerance).
    }
  }
  const slice = entries.slice(Math.max(0, entries.length - tail))
  if (full) {
    return { ok: true, message: slice.map(e => JSON.stringify(e, null, 2)).join('\n') }
  }
  return {
    ok: true,
    message: slice.map(formatLine).join('\n'),
  }
}

function formatLine(e: Record<string, unknown>): string {
  const ts = String(e.ts ?? '')
  const type = String(e.type ?? '')
  const rid = String(e.requestId ?? '')
  const summary = oneLineSummary(e)
  return `[${ts}] ${type.padEnd(28)} [${rid}] ${summary}`
}

function oneLineSummary(e: Record<string, unknown>): string {
  const out: string[] = []
  for (const k of ['target', 'bytesWritten', 'bytes', 'mode', 'provider', 'model', 'phiEntityCounts', 'reason']) {
    if (e[k] !== undefined) {
      out.push(`${k}=${typeof e[k] === 'object' ? JSON.stringify(e[k]) : String(e[k])}`)
    }
  }
  return out.join(' ')
}
