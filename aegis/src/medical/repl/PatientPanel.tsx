import type * as React from 'react'
import { Box, Text } from '../../ink.js'
import { useAppState } from '../../state/AppState.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { PatientContext } from '../adapters/InputAdapter.js'
import type { Template } from '../templates/Template.js'

// useAppState in this fork is a loosely-typed selector hook (Babel-compiled
// from AppState.tsx) that returns `{}` by default; cast locally to keep
// the overlay call-site strongly typed without touching the framework hook.
export function PatientPanel(): React.ReactNode {
	const patient = useAppState((s: AppState) => s.currentPatient) as PatientContext | null
	const template = useAppState((s: AppState) => s.currentTemplate) as Template | null

	if (!patient && !template) return null

	return (
		<Box flexDirection="row" gap={2} paddingX={1}>
			<Text dimColor>Patient:</Text>
			<Text>{patient ? patient.patientId : '—'}</Text>
			<Text dimColor>Template:</Text>
			<Text>{template ? template.id : '—'}</Text>
		</Box>
	)
}
