import type { LocalJSXCommandCall } from '../../types/command.js'
import { getPhiMode } from '../../medical/runtime/phiMode.js'

export const call: LocalJSXCommandCall = async (onDone, _ctx, rawArgs) => {
  const args = rawArgs.trim()
  if (args === '' || args === 'show') {
    onDone(`Current PHI mode: ${getPhiMode()} (set at launch via --phi-mode)`, {
      display: 'system',
    })
    return null
  }
  if (args.startsWith('set ')) {
    const target = args.slice(4).trim()
    if (target === 'off') {
      onDone(
        'PHI-off mode cannot be enabled from inside the REPL (spec §6.4). ' +
          'Restart aegis with --phi-mode=off --allow-phi-off.',
        { display: 'system' },
      )
      return null
    }
    onDone(
      'PHI mode is launch-time only. Restart aegis with --phi-mode=<strict|research|off>.',
      { display: 'system' },
    )
    return null
  }
  onDone('Usage: /phi-mode [show]', { display: 'system' })
  return null
}
