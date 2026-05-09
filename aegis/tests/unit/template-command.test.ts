import { test, expect } from 'bun:test'
import { handleTemplateCommand } from '../../src/commands/template/template.js'
import {
	getDefaultAppState,
	type AppState,
} from '../../src/state/AppStateStore.js'
import { createStore } from '../../src/state/store.js'

const soapTemplate = {
	id: 'soap',
	name: 'SOAP',
	source: 'builtin' as const,
	sections: [
		{
			id: 'S',
			title: 'Subjective',
			requiredFields: [],
			promptGuidance: 'patient story',
		},
		{
			id: 'O',
			title: 'Objective',
			requiredFields: [],
			promptGuidance: 'vitals + observations',
		},
		{
			id: 'A',
			title: 'Assessment',
			requiredFields: [],
			promptGuidance: 'problems',
		},
		{
			id: 'P',
			title: 'Plan',
			requiredFields: [],
			promptGuidance: '',
		},
	],
}

function captureOnDone() {
	const calls: Array<{ result?: string; options?: unknown }> = []
	return {
		calls,
		onDone: (result?: string, options?: unknown) => {
			calls.push({ result, options })
		},
	}
}

function failingRegistry() {
	return () => {
		throw new Error('aegis-mcp should not have been called')
	}
}

test('/template show prints template sections, not just a count', async () => {
	const store = createStore<AppState>({
		...getDefaultAppState(),
		currentTemplate: soapTemplate,
	})
	const { calls, onDone } = captureOnDone()
	await handleTemplateCommand({
		subcommand: 'show',
		arg: '',
		store,
		buildRegistry: failingRegistry(),
		onDone,
	})
	expect(calls).toHaveLength(1)
	const out = calls[0]!.result!
	expect(out).toContain('soap — SOAP')
	expect(out).toContain('Sections:')
	expect(out).toContain('Subjective (S)')
	expect(out).toContain('Objective (O)')
	expect(out).toContain('Assessment (A)')
	expect(out).toContain('Plan (P)')
	expect(out).toContain('patient story')
	// The old output leaked a section count — guard against regression.
	expect(out).not.toMatch(/\(\d+ sections\)/)
})

test('/template show with no template set does not touch MCP', async () => {
	const store = createStore<AppState>(getDefaultAppState())
	const { calls, onDone } = captureOnDone()
	await handleTemplateCommand({
		subcommand: 'show',
		arg: '',
		store,
		buildRegistry: failingRegistry(),
		onDone,
	})
	expect(calls).toEqual([
		{ result: 'No template set.', options: { display: 'system' } },
	])
})

test('/template set with no arg does not touch MCP; prints usage', async () => {
	const store = createStore<AppState>(getDefaultAppState())
	const { calls, onDone } = captureOnDone()
	await handleTemplateCommand({
		subcommand: 'set',
		arg: '',
		store,
		buildRegistry: failingRegistry(),
		onDone,
	})
	expect(calls).toEqual([
		{
			result: 'Usage: /template set <id>',
			options: { display: 'system' },
		},
	])
})

test('/template list DOES build the registry (needs MCP)', async () => {
	const store = createStore<AppState>(getDefaultAppState())
	const { calls, onDone } = captureOnDone()
	let built = 0
	await handleTemplateCommand({
		subcommand: 'list',
		arg: '',
		store,
		buildRegistry: () => {
			built += 1
			return {
				listTemplates: async () => [soapTemplate],
				getTemplate: async () => soapTemplate,
				invalidate: () => {},
			}
		},
		onDone,
	})
	expect(built).toBe(1)
	expect(calls).toHaveLength(1)
	expect(calls[0]!.result).toContain('soap')
})

test('/template set <id> updates AppState via the registry', async () => {
	const store = createStore<AppState>(getDefaultAppState())
	const { calls, onDone } = captureOnDone()
	await handleTemplateCommand({
		subcommand: 'set',
		arg: 'soap',
		store,
		buildRegistry: () => ({
			listTemplates: async () => [soapTemplate],
			getTemplate: async id => {
				expect(id).toBe('soap')
				return soapTemplate
			},
			invalidate: () => {},
		}),
		onDone,
	})
	expect(store.getState().currentTemplate?.id).toBe('soap')
	expect(calls).toHaveLength(1)
	expect(calls[0]!.result).toContain('Template set to soap')
})
