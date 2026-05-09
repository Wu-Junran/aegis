import type { Command } from '../../commands.js'

const note: Command = {
	type: 'local-jsx',
	name: 'note',
	description: 'Show the current drafted note (M3: last assistant message)',
	load: () => import('./note.js'),
}

export default note
