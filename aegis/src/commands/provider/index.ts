import type { Command } from '../../commands.js'

const provider: Command = {
	type: 'local-jsx',
	name: 'provider',
	description: 'Manage the active LLM provider (list / set / clear / creds)',
	load: () => import('./provider.js'),
}

export default provider
