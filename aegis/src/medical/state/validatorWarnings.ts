export type ValidatorSeverity = 'info' | 'warn'

export type ValidatorWarning = {
	check: 'dose' | 'dates' | 'labs' | 'allergies' | 'sections'
	severity: ValidatorSeverity
	message: string
	evidence?: Record<string, unknown>
}

export type ValidatorWarningsSlice = { validatorWarnings: ValidatorWarning[] }

export function createValidatorWarningsSlice(): ValidatorWarningsSlice {
	return { validatorWarnings: [] }
}
