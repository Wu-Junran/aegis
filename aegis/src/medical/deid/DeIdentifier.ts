export type PhiEntityType =
	| 'PERSON'
	| 'DATE'
	| 'MRN'
	| 'PHONE'
	| 'EMAIL'
	| 'ADDRESS'
	| 'ID'
	| 'ORGANIZATION'
	| 'LOCATION'

export type PhiMapping = {
	entries: Record<string, { type: PhiEntityType; original: string }>
	version: string
}

export type RedactionResult = {
	redacted: string
	mapping: PhiMapping
}

export interface DeIdentifier {
	redact(text: string): Promise<RedactionResult>
	restore(text: string, mapping: PhiMapping): Promise<string>
}

export { createMcpDeIdentifier } from './mcpDeIdentifier.js'
export type { McpDeIdentifier } from './mcpDeIdentifier.js'
