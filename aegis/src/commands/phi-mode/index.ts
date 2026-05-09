import type { Command } from '../../commands.js'

const phiMode: Command = {
	type: 'local-jsx',
	name: 'phi-mode',
	description: 'Show the current PHI safety mode (strict | research | off)',
	load: () => import('./phi-mode.js'),
}

export default phiMode
