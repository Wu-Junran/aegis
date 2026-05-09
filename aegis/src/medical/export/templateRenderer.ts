import type { AppState } from '../../state/AppStateStore.js'
import type { CallMcpTool } from '../adapters/fhirAdapter.js'

export type RenderForExportDeps = {
	callTool: CallMcpTool
	getAppState: () => AppState
}

/**
 * Build a `render` function for NoteExportGate.
 *
 * **M6 (section-aware).** When `currentNote.filled_sections` is non-empty
 * AND `currentTemplate` is set, calls MCP `render_template` with the section
 * map. Otherwise falls back to the M4 pass-through (returns `currentNote.free
 * ?? note`), preserving the M3/M4 happy path for sessions that never adopted
 * the section-fence contract.
 */
export function makeRenderForExport(deps: RenderForExportDeps) {
	return async (note: string, _format: 'md' | 'pdf'): Promise<string> => {
		const s = deps.getAppState()
		const tpl = s.currentTemplate
		const cn = s.currentNote
		const sections = cn?.filled_sections ?? {}
		const hasSections = tpl != null && Object.keys(sections).length > 0
		if (hasSections) {
			// Normalize against the loaded template's section ids. The MCP
			// renderer uses jinja2.StrictUndefined and SOAP/discharge templates
			// reference every section (`{{ filled_sections.subjective }}` etc.),
			// so a partial draft that only filled `plan` would crash the export
			// instead of producing a non-blocking missing-section warning. Fill
			// every expected id with `''` for whatever the model didn't deliver;
			// validator check 5 (`sections`) surfaces the gaps in the sign-off
			// summary.
			const expected = tpl!.sections.map((sec: any) => sec.id)
			const normalized: Record<string, string> = Object.fromEntries(
				expected.map((id: string) => [id, sections[id] ?? '']),
			)
			const payload = await deps.callTool('render_template', {
				template_id: tpl!.id,
				patient_context: s.currentPatient ?? {},
				filled_sections: normalized,
			})
			return payload
		}
		return cn?.free ?? note
	}
}
