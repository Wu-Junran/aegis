import type { CallMcpTool } from '../adapters/fhirAdapter.js'
import type { DeIdentifier, PhiMapping, RedactionResult } from './DeIdentifier.js'

export type McpDeIdentifier = DeIdentifier & {
	redactBatch(blobs: readonly string[]): Promise<{
		redacted: string[]
		mapping: PhiMapping
	}>
}

type RawEnvelope = {
	redacted: string | string[]
	mapping: PhiMapping
}

export function createMcpDeIdentifier(args: {
	callTool: CallMcpTool
}): McpDeIdentifier {
	const { callTool } = args

	async function redact(text: string): Promise<RedactionResult> {
		const raw = await callTool('deidentify', { text })
		const env = JSON.parse(raw) as RawEnvelope
		if (typeof env.redacted !== 'string') {
			throw new Error('deidentify: expected string redacted, got array')
		}
		return { redacted: env.redacted, mapping: env.mapping }
	}

	async function redactBatch(blobs: readonly string[]) {
		const raw = await callTool('deidentify', { text: [...blobs] })
		const env = JSON.parse(raw) as RawEnvelope
		if (!Array.isArray(env.redacted)) {
			throw new Error('deidentify: expected array redacted, got string')
		}
		return { redacted: env.redacted, mapping: env.mapping }
	}

	async function restore(text: string, mapping: PhiMapping): Promise<string> {
		return await callTool('reidentify', { text, mapping })
	}

	return { redact, redactBatch, restore }
}
