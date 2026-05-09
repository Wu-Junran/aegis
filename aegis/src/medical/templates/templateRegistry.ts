import type { CallMcpTool } from '../adapters/fhirAdapter.js'
import type { Template, TemplateKind } from './Template.js'

export type TemplateRegistry = {
	listTemplates(): Promise<Template[]>
	getTemplate(id: string): Promise<Template>
	invalidate(): void
}

function normalizeKind(raw: unknown): TemplateKind {
	if (raw === 'report') return 'report'
	// Default to clinical_note for missing/unknown values. The Python loader
	// rejects invalid strings at parse time, so the unknown branch only
	// triggers for older MCP servers that omit `kind` entirely.
	return 'clinical_note'
}

export function createTemplateRegistry(ctx: {
	callTool: CallMcpTool
}): TemplateRegistry {
	let cache: Template[] | null = null

	async function listTemplates(): Promise<Template[]> {
		if (cache) return cache
		const raw = await ctx.callTool('list_templates', {})
		const decoded = JSON.parse(raw) as Array<Omit<Template, 'kind'> & { kind?: unknown }>
		cache = decoded.map((t) => ({
			...t,
			kind: normalizeKind(t.kind),
		}))
		return cache
	}

	async function getTemplate(id: string): Promise<Template> {
		const all = await listTemplates()
		const t = all.find((x) => x.id === id)
		if (!t) throw new Error(`Unknown template id: ${id}`)
		return t
	}

	return {
		listTemplates,
		getTemplate,
		invalidate: () => {
			cache = null
		},
	}
}
