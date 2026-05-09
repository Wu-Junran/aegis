import { test, expect } from 'bun:test'
import { createMcpDeIdentifier } from '../../../src/medical/deid/mcpDeIdentifier.js'

test('redact passes text through and parses MCP envelope', async () => {
	const calls: { name: string; args: Record<string, unknown> }[] = []
	const callTool = async (name: string, args: Record<string, unknown>) => {
		calls.push({ name, args })
		return JSON.stringify({
			redacted: '<PERSON_1> seen.',
			mapping: {
				entries: { '<PERSON_1>': { type: 'PERSON', original: 'John Doe' } },
				version: 'presidio-2.2.x',
			},
		})
	}
	const deid = createMcpDeIdentifier({ callTool })
	const r = await deid.redact('John Doe seen.')
	expect(calls).toEqual([{ name: 'deidentify', args: { text: 'John Doe seen.' } }])
	expect(r.redacted).toBe('<PERSON_1> seen.')
	expect(r.mapping.version).toBe('presidio-2.2.x')
})

test('restore round-trips through MCP', async () => {
	const callTool = async (_name: string, args: Record<string, unknown>) => {
		if ((args as { text?: string }).text === '<PERSON_1> seen.') return 'John Doe seen.'
		throw new Error('unexpected text')
	}
	const deid = createMcpDeIdentifier({ callTool })
	const restored = await deid.restore('<PERSON_1> seen.', {
		entries: { '<PERSON_1>': { type: 'PERSON', original: 'John Doe' } },
		version: 'presidio-2.2.x',
	})
	expect(restored).toBe('John Doe seen.')
})

test('redact accepts string array (shared pool)', async () => {
	const callTool = async (_name: string, args: Record<string, unknown>) =>
		JSON.stringify({
			redacted: ['<PERSON_1> a', '<PERSON_1> b'],
			mapping: {
				entries: { '<PERSON_1>': { type: 'PERSON', original: 'John Doe' } },
				version: 'presidio-2.2.x',
			},
		})
	const deid = createMcpDeIdentifier({ callTool })
	const r = await deid.redactBatch(['John Doe a', 'John Doe b'])
	expect(r.redacted).toEqual(['<PERSON_1> a', '<PERSON_1> b'])
})
