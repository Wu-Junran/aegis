export type TemplateSection = {
	id: string
	title: string
	requiredFields: string[]
	promptGuidance: string
}

export type TemplateKind = 'clinical_note' | 'report'

export type Template = {
	id: string
	name: string
	sections: TemplateSection[]
	source: 'builtin' | 'user'
	/**
	 * Document class. `'clinical_note'` (default) covers SOAP, discharge
	 * summary, progress note; `'report'` covers case report and other
	 * research/operational drafts. Optional on the wire (older callers/
	 * templates omit it); the registry defaults missing values to
	 * `'clinical_note'`.
	 *
	 * **No production consumer yet.** As of v0.9.0 the export gate's
	 * `attestation_kind` decision is a function of `phiMode` only
	 * (`NoteExportGate.ts:109`): strict → clinical attestation, research/off
	 * → research-use acknowledgment. `kind` is plumbed end-to-end (TS
	 * `Template`, Python TypedDict, builtin frontmatter) so a future
	 * change can branch on it (e.g. force research-use attestation for
	 * `kind === 'report'` even in strict mode), but doing so is a policy
	 * change that should land deliberately, not as a side effect of
	 * adding the field. Until then the field is metadata-only.
	 */
	kind?: TemplateKind
}
