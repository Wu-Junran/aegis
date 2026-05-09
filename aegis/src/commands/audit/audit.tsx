import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { runAuditShow } from './runAuditShow.js'

function AuditCommand({
  text,
  onDone,
}: {
  text: string
  onDone: (result?: string, options?: { display?: 'system' | 'user' }) => void
}): React.ReactNode {
  React.useEffect(() => {
    onDone(text, { display: 'system' })
  }, [text, onDone])
  return <Box><Text /></Box>
}

export const call: LocalJSXCommandCall = async (onDone, ctx, rawArgs) => {
  const args = rawArgs.trim() || 'show'
  const sub = args.split(/\s+/)[0]
  if (sub !== 'show') {
    onDone(
      'Usage: /audit show [--full] [--tail N]',
      { display: 'system' },
    )
    return null
  }
  const auditLogPath = ctx.getAppState().auditLogPath
  const result = await runAuditShow({ auditLogPath, args })
  return <AuditCommand text={result.message} onDone={onDone} />
}
