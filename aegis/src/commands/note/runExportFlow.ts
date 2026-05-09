import {
  runNoteExportGate,
  type ExportOpts,
  type ExportPromptResponse,
  type ExportPromptSummary,
} from '../../medical/export/NoteExportGate.js'
import { makeRenderForExport } from '../../medical/export/templateRenderer.js'
import { createMcpDeIdentifier } from '../../medical/deid/mcpDeIdentifier.js'
import {
  openAuditLogger,
  type AuditLogger,
  type PhiMode,
} from '../../medical/audit/AuditLogger.js'
import { buildAegisMcpCallTool } from '../../medical/adapters/aegisMcpCall.js'
import type { DeIdentifier } from '../../medical/deid/DeIdentifier.js'
import type { MedicalRuntime } from '../../medical/runtime/medicalRuntime.js'
import { getPhiMode } from '../../medical/runtime/phiMode.js'
import type { CurrentNoteValue } from '../../medical/state/currentNote.js'
import { isEmptyNote, noteToText, noteToFencedString } from '../../medical/state/currentNote.js'

export type ExportFlowResult =
  | { ok: true; message: string }
  | { ok: false; message: string }

export type ExportFlowDeps = {
  /** Read once at start. Empty note → returns refusal. */
  note: CurrentNoteValue
  /** Read once at start. Null → returns refusal. */
  auditPath: string | null
  /** Runtime holder for MCP-client + AppState getters. */
  runtime: MedicalRuntime
  /** Parsed `/note export` args. */
  args: ExportOpts
  /**
   * UI-driven prompt callback. Receives the gate's PHI summary so the dialog
   * can render real counts. The React shell wires this to `<ExportConfirm>`.
   */
  prompt: (
    kind: 'attestation' | 'phi-extra-confirm',
    summary: ExportPromptSummary,
  ) => Promise<ExportPromptResponse>
  /**
   * Test seam — pass a recording logger instead of opening a real fd.
   * Signature mirrors `openAuditLogger(path, mode)` (the production default)
   * so tests can ignore the second arg without losing typecheck.
   */
  loggerFactory?: (path: string, mode: PhiMode) => AuditLogger
  /** Test seam — bypass MCP deid construction. Production passes undefined. */
  deidOverride?: DeIdentifier
  /**
   * Test seam — bypass `runtime.getMcpClients()` and use a directly-injected
   * CallMcpTool. Workflow integration tests use a shared MCP client that
   * isn't surfaced as an `MCPServerConnection`; this lets them feed the
   * validator + render path without staging a fake connection registry.
   * Production passes undefined so the runtime-derived callTool runs.
   */
  callToolOverride?: import('../../medical/adapters/fhirAdapter.js').CallMcpTool
}

/**
 * Pure async orchestration of the `/note export` flow. Refuses early when
 * `note` or `auditPath` is null (returning `{ok: false, message}` rather
 * than throwing) so the React shell can convert the refusal to an `onDone`
 * system message. Tests drive this directly.
 */
export async function runExportFlow(deps: ExportFlowDeps): Promise<ExportFlowResult> {
  if (isEmptyNote(deps.note)) {
    return {
      ok: false,
      message:
        'No drafted note in AppState.currentNote. Run a drafting prompt first, then re-export.',
    }
  }
  if (!deps.auditPath) {
    return {
      ok: false,
      message:
        'auditLogPath not initialized — cannot export. (Internal: MedicalRuntimeBridge did not run.)',
    }
  }

  const callTool: import('../../medical/adapters/fhirAdapter.js').CallMcpTool =
    deps.callToolOverride ??
    (async (name, args) => {
      const inner = buildAegisMcpCallTool({
        clients: deps.runtime.getMcpClients(),
        setAppState: deps.runtime.setState as never,
      })
      return inner(name, args)
    })
  const deid = deps.deidOverride ?? createMcpDeIdentifier({ callTool })
  const logger = (deps.loggerFactory ?? openAuditLogger)(deps.auditPath, getPhiMode())
  const render = makeRenderForExport({ callTool, getAppState: deps.runtime.getState })

  const validate = async (_renderedNote: string) => {
    // (P1 fix) Use the structured currentNote.filled_sections to rebuild
    // a fenced note for the validator: render_template strips fences into
    // markdown headings (the Python sections check would otherwise report
    // every section missing), and strict-mode redaction would also lose
    // clinical facts before checks 1-4 run. The structured slice is
    // pre-redaction, plaintext, and fence-shaped — the canonical input
    // the validator was designed against.
    const note = deps.runtime.getState().currentNote
    const fencedNote = noteToFencedString(note)
    const args = {
      note: fencedNote,
      patient_context: deps.runtime.getState().currentPatient ?? {},
      template: deps.runtime.getState().currentTemplate ?? null,
    }
    const raw = await callTool('validate_clinical_note', args)
    return JSON.parse(raw) as ReadonlyArray<{
      check: string
      severity: 'info' | 'warn'
      message: string
      evidence?: Record<string, unknown>
    }>
  }

  try {
    const result = await runNoteExportGate(noteToText(deps.note) ?? '', deps.args, {
      deid,
      phiMode: getPhiMode(),
      logger,
      render,
      prompt: deps.prompt,
      validate,
    })
    return {
      ok: true,
      message: `Note exported to ${result.path} (${result.bytesWritten} bytes, ${result.mode}).`,
    }
  } catch (err) {
    return { ok: false, message: `Export failed: ${(err as Error).message}` }
  } finally {
    await logger.close().catch(() => undefined)
  }
}
