import type { Command } from '../../commands.js'

const template: Command = {
	type: 'local-jsx',
	name: 'template',
	description: 'List / set / show the active clinical-note template',
	load: () => import('./template.js'),
}

export default template
