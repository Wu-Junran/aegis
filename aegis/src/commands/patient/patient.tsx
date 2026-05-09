import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { buildAegisMcpCallTool } from '../../medical/adapters/aegisMcpCall.js'
import { loadPatient } from '../../medical/adapters/fhirAdapter.js'
import type { PatientContext } from '../../medical/adapters/InputAdapter.js'
import { useAppStateStore } from '../../state/AppState.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

type Subcommand = 'load' | 'show' | 'clear'

type Props = {
	subcommand: Subcommand
	arg: string
	onDone: (
		result?: string,
		options?: { display?: 'system' | 'user' },
	) => void
}

function PatientCommand({ subcommand, arg, onDone }: Props): React.ReactNode {
	const store = useAppStateStore()

	React.useEffect(() => {
		let cancelled = false
		;(async () => {
			try {
				if (subcommand === 'clear') {
					store.setState(s => ({ ...s, currentPatient: null }))
					onDone('Patient cleared.', { display: 'system' })
					return
				}
				if (subcommand === 'show') {
					const p = store.getState().currentPatient
					onDone(p ? summarize(p) : 'No patient loaded.', {
						display: 'system',
					})
					return
				}
				// load
				if (!arg) {
					onDone('Usage: /patient load <path-to-bundle.json>', {
						display: 'system',
					})
					return
				}
				const clients = store.getState().mcp.clients
				const callTool = buildAegisMcpCallTool({
					clients,
					setAppState: store.setState,
				})
				const ctx = await loadPatient(arg, { callTool })
				if (cancelled) return
				store.setState(s => ({ ...s, currentPatient: ctx }))
				onDone(
					`Loaded patient ${ctx.patientId} from ${arg}.`,
					{ display: 'system' },
				)
			} catch (err) {
				if (!cancelled)
					onDone(`Error: ${(err as Error).message}`, {
						display: 'system',
					})
			}
		})()
		return () => {
			cancelled = true
		}
	}, [subcommand, arg, store, onDone])

	return (
		<Box>
			<Text>{subcommand === 'load' ? 'Loading patient…' : ''}</Text>
		</Box>
	)
}

function summarize(p: PatientContext): string {
	return [
		`Patient ${p.patientId}`,
		`  problems: ${p.problems.length}`,
		`  medications: ${p.medications.length}`,
		`  allergies: ${p.allergies.length}`,
		`  observations: ${p.observations.length}`,
		p.sourceBundlePath ? `  source: ${p.sourceBundlePath}` : '',
	]
		.filter(Boolean)
		.join('\n')
}

export const call: LocalJSXCommandCall = async (onDone, _ctx, rawArgs) => {
	const [sub = 'show', ...rest] = rawArgs.trim().split(/\s+/)
	const subcommand: Subcommand =
		sub === 'load' || sub === 'show' || sub === 'clear' ? sub : 'show'
	return (
		<PatientCommand
			subcommand={subcommand}
			arg={rest.join(' ')}
			onDone={onDone}
		/>
	)
}
