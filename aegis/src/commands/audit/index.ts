import type { Command } from '../../commands.js'

const audit: Command = {
  type: 'local-jsx',
  name: 'audit',
  description: 'Inspect the current session audit log (subcommand: show)',
  load: () => import('./audit.js'),
}

export default audit
