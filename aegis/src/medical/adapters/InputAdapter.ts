export type PatientContext = {
	patientId: string
	demographics: Record<string, unknown>
	problems: unknown[]
	medications: unknown[]
	allergies: unknown[]
	observations: unknown[]
	encounters: unknown[] // NEW (Task 6.3, P2#3 fix)
	priorNotes: unknown[]
	sourceBundlePath?: string
}

export interface InputAdapter {
	readonly name: string
	load(source: string): Promise<PatientContext>
	describe(ctx: PatientContext): string
}
