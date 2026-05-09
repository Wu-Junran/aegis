import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { useAppState } from '../../state/AppState.js'
import type { AppState } from '../../state/AppStateStore.js'
import type {
  ExportOpts,
  ExportPromptSummary,
} from '../../medical/export/NoteExportGate.js'
import { getMedicalRuntime } from '../../medical/runtime/medicalRuntime.js'
import { ExportConfirm, type ExportConfirmKind } from '../../medical/repl/ExportConfirm.js'
import { runExportFlow } from './runExportFlow.js'
import type { CurrentNoteValue } from '../../medical/state/currentNote.js'

type Props = {
  args: ExportOpts
  onDone: (result?: string, options?: { display?: 'system' | 'user' }) => void
}

type ConfirmRequest = ExportPromptSummary & {
  kind: ExportConfirmKind
  resolve: (r: { accepted: boolean; attestationText: string }) => void
}

export function ExportNoteCommand({ args, onDone }: Props): React.ReactNode {
  const note = useAppState((s: AppState) => s.currentNote) as CurrentNoteValue
  const auditPath = useAppState((s: AppState) => s.auditLogPath) as string | null
  const [confirm, setConfirm] = React.useState<ConfirmRequest | null>(null)
  const [done, setDone] = React.useState(false)

  React.useEffect(() => {
    if (done) return
    // [M4] getMedicalRuntime() throws when MedicalRuntimeBridge has not yet
    // mounted (e.g., test render with no provider, race during bridge init,
    // or bridge regression). Catch here so the user sees a structured system
    // failure instead of an unhandled promise rejection killing the REPL.
    let runtime: ReturnType<typeof getMedicalRuntime>
    try {
      runtime = getMedicalRuntime()
    } catch (err) {
      onDone(
        `Export failed: medical runtime not initialized (${(err as Error).message}).`,
        { display: 'system' },
      )
      setDone(true)
      return
    }

    const prompt = (kind: ExportConfirmKind, summary: ExportPromptSummary) =>
      new Promise<{ accepted: boolean; attestationText: string }>((resolve) => {
        setConfirm({
          ...summary,
          kind,
          resolve: (r) => {
            setConfirm(null)
            resolve(r)
          },
        })
      })

    runExportFlow({
      note,
      auditPath,
      runtime,
      args,
      prompt,
    }).then((result) => {
      onDone(result.message, { display: 'system' })
      setDone(true)
    })
  }, [args, auditPath, done, note, onDone])

  if (confirm) {
    return (
      <ExportConfirm
        kind={confirm.kind}
        target={confirm.target}
        bytes={confirm.bytes}
        mode={confirm.mode}
        phiMode={confirm.phiMode}
        phiEntityCounts={confirm.phiEntityCounts}
        onResolve={confirm.resolve}
      />
    )
  }
  return (
    <Box>
      <Text dimColor>Exporting…</Text>
    </Box>
  )
}
