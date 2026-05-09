import type { PatientContext } from '../adapters/InputAdapter.js'

export type CurrentPatientSlice = { currentPatient: PatientContext | null }

export function createCurrentPatientSlice(): CurrentPatientSlice {
	return { currentPatient: null }
}
