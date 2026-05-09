import type { Command } from '../../commands.js'

const patient: Command = {
	type: 'local-jsx',
	name: 'patient',
	description: 'Load / show / clear the active FHIR patient bundle',
	load: () => import('./patient.js'),
}

export default patient
