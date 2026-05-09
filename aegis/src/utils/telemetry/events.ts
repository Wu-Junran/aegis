import type { Attributes } from '@opentelemetry/api'
import { getEventLogger, getPromptId } from 'src/bootstrap/state.js'
import { logForDebugging } from '../debug.js'
import { isEnvTruthy } from '../envUtils.js'
import { getPhiMode } from '../../medical/runtime/phiMode.js'
import { getTelemetryAttributes } from '../telemetryAttributes.js'

// Monotonically increasing counter for ordering events within a session
let eventSequence = 0

// Track whether we've already warned about a null event logger to avoid spamming
let hasWarnedNoEventLogger = false

function isUserPromptLoggingEnabled() {
  return isEnvTruthy(process.env.OTEL_LOG_USER_PROMPTS)
}

/**
 * Returns either `content` or the literal string `'<REDACTED>'` for OTel
 * event payloads. Raw text only escapes when BOTH:
 *   1. `OTEL_LOG_USER_PROMPTS` is set (the upstream opt-in); AND
 *   2. PHI mode is `off` (the M4 medical safety boundary).
 *
 * Centralized here (vs. gating at every call site) so any new caller of
 * `logOTelEvent('user_prompt', ...)` — known callers today are
 * `processTextPrompt` and the slash-fallback in `processSlashCommand`,
 * but the surface tends to grow — automatically inherits the gate. The
 * fail-closed default (return `<REDACTED>`) means a future caller that
 * forgets the helper at most loses telemetry, not patient privacy.
 */
export function redactIfDisabled(content: string): string {
  if (!isUserPromptLoggingEnabled()) return '<REDACTED>'
  if (getPhiMode() !== 'off') return '<REDACTED>'
  return content
}

export async function logOTelEvent(
  eventName: string,
  metadata: { [key: string]: string | undefined } = {},
): Promise<void> {
  const eventLogger = getEventLogger()
  if (!eventLogger) {
    if (!hasWarnedNoEventLogger) {
      hasWarnedNoEventLogger = true
      logForDebugging(
        `[3P telemetry] Event dropped (no event logger initialized): ${eventName}`,
        { level: 'warn' },
      )
    }
    return
  }

  // Skip logging in test environment
  if (process.env.NODE_ENV === 'test') {
    return
  }

  const attributes: Attributes = {
    ...getTelemetryAttributes(),
    'event.name': eventName,
    'event.timestamp': new Date().toISOString(),
    'event.sequence': eventSequence++,
  }

  // Add prompt ID to events (but not metrics, where it would cause unbounded cardinality)
  const promptId = getPromptId()
  if (promptId) {
    attributes['prompt.id'] = promptId
  }

  // Workspace directory from the desktop app (host path). Events only —
  // filesystem paths are too high-cardinality for metric dimensions, and
  // the BQ metrics pipeline must never see them.
  const workspaceDir = process.env.CLAUDE_CODE_WORKSPACE_HOST_PATHS
  if (workspaceDir) {
    attributes['workspace.host_paths'] = workspaceDir.split('|')
  }

  // Add metadata as attributes - all values are already strings
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) {
      attributes[key] = value
    }
  }

  // Emit log record as an event
  eventLogger.emit({
    body: `claude_code.${eventName}`,
    attributes,
  })
}

