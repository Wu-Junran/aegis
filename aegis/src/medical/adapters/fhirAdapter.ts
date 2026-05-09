import type { PatientContext } from './InputAdapter.js'

export type CallMcpTool = (name: string, args: Record<string, unknown>) => Promise<string>

export type FhirAdapterContext = { callTool: CallMcpTool }

/**
 * Calls the aegis-mcp `fhir_load_bundle` tool and parses the JSON payload
 * into a PatientContext. The camelCase JSON shape is the M2 contract
 * (aegis-mcp/src/aegis_mcp/fhir/parser.py :: PatientContext TypedDict).
 */
export async function loadPatient(path: string, ctx: FhirAdapterContext): Promise<PatientContext> {
	const payload = await ctx.callTool('fhir_load_bundle', { path })
	return JSON.parse(payload) as PatientContext
}
