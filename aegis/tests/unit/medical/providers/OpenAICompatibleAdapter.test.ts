import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	createOpenAICompatibleAdapter,
	__transformRequestForTest,
	__transformResponseForTest,
} from '../../../../src/medical/providers/OpenAICompatibleAdapter.js'
import type { ProviderConfig } from '../../../../src/medical/providers/ProviderAdapter.js'

const cfg: ProviderConfig = {
	id: 'openai',
	baseURL: 'https://api.openai.com/v1',
	modelId: 'gpt-5',
	capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128000 },
}

test('outbound transform: Anthropic system+messages → OpenAI messages', () => {
	const req = {
		model: 'gpt-5',
		max_tokens: 256,
		system: 'You are a clinical assistant.',
		messages: [
			{ role: 'user', content: 'Hello.' },
			{ role: 'assistant', content: 'Hi.' },
		],
	} as any
	const oai = __transformRequestForTest(req, cfg)
	expect(oai.model).toBe('gpt-5')
	expect(oai.max_tokens).toBe(256)
	expect(oai.messages[0]).toEqual({ role: 'system', content: 'You are a clinical assistant.' })
	expect(oai.messages[1]).toEqual({ role: 'user', content: 'Hello.' })
	expect(oai.messages[2]).toEqual({ role: 'assistant', content: 'Hi.' })
})

test('inbound transform: OpenAI choice → BetaMessage', () => {
	const fixture = JSON.parse(
		readFileSync(join(__dirname, '../../../fixtures/providers/openai-chat-response.json'), 'utf8'),
	)
	const beta = __transformResponseForTest(fixture)
	expect(beta.role).toBe('assistant')
	expect(beta.content).toEqual([{ type: 'text', text: 'Hello, world.' }])
	expect(beta.stop_reason).toBe('end_turn')
	expect(beta.usage).toEqual({ input_tokens: 4, output_tokens: 3 })
})

test('outbound transform: tool_use schema → OpenAI tools[]', () => {
	const req = {
		model: 'gpt-5',
		max_tokens: 256,
		messages: [{ role: 'user', content: 'Read /etc/hosts' }],
		tools: [
			{
				name: 'FileRead',
				description: 'Read a file',
				input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
			},
		],
	} as any
	const oai = __transformRequestForTest(req, cfg)
	expect(oai.tools).toHaveLength(1)
	expect(oai.tools![0].type).toBe('function')
	expect(oai.tools![0].function.name).toBe('FileRead')
	expect(oai.tools![0].function.parameters).toEqual({
		type: 'object',
		properties: { path: { type: 'string' } },
		required: ['path'],
	})
})

test('outbound transform: Anthropic assistant tool_use → OAI assistant.tool_calls', () => {
	const req = {
		model: 'gpt-5',
		max_tokens: 64,
		messages: [
			{ role: 'user', content: 'Read /etc/hosts' },
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 'I will read it.' },
					{ type: 'tool_use', id: 'call_xyz', name: 'FileRead', input: { path: '/etc/hosts' } },
				],
			},
		],
	} as any
	const oai = __transformRequestForTest(req, cfg)
	const last = oai.messages[oai.messages.length - 1]!
	expect(last.role).toBe('assistant')
	expect(last.content).toBe('I will read it.')
	expect(last.tool_calls).toHaveLength(1)
	expect(last.tool_calls![0].id).toBe('call_xyz')
	expect(last.tool_calls![0].function.name).toBe('FileRead')
	expect(JSON.parse(last.tool_calls![0].function.arguments)).toEqual({ path: '/etc/hosts' })
})

test('outbound transform: Anthropic user tool_result → OAI tool message linked by tool_call_id', () => {
	const req = {
		model: 'gpt-5',
		max_tokens: 64,
		messages: [
			{
				role: 'user',
				content: [
					{ type: 'tool_result', tool_use_id: 'call_xyz', content: '127.0.0.1 localhost' },
					{ type: 'text', text: 'What is on the second line?' },
				],
			},
		],
	} as any
	const oai = __transformRequestForTest(req, cfg)
	// One OAI `tool` message + one OAI `user` message, in that order.
	const lastTwo = oai.messages.slice(-2)
	expect(lastTwo[0]).toEqual({ role: 'tool', content: '127.0.0.1 localhost', tool_call_id: 'call_xyz' })
	expect(lastTwo[1]).toEqual({ role: 'user', content: 'What is on the second line?' })
})

test('outbound transform: tool_result with content blocks is concatenated', () => {
	const req = {
		model: 'gpt-5',
		max_tokens: 64,
		messages: [
			{
				role: 'user',
				content: [
					{
						type: 'tool_result',
						tool_use_id: 'call_1',
						content: [
							{ type: 'text', text: 'line one' },
							{ type: 'text', text: 'line two' },
						],
					},
				],
			},
		],
	} as any
	const oai = __transformRequestForTest(req, cfg)
	const toolMsg = oai.messages.find((m) => m.role === 'tool')!
	expect(toolMsg.content).toBe('line one\nline two')
	expect(toolMsg.tool_call_id).toBe('call_1')
})

test('inbound transform: OpenAI tool_calls → BetaMessage tool_use blocks', () => {
	const oaiResp = {
		id: 'cc-1',
		object: 'chat.completion',
		created: 0,
		model: 'gpt-5',
		choices: [
			{
				index: 0,
				message: {
					role: 'assistant',
					content: null,
					tool_calls: [
						{
							id: 'call_1',
							type: 'function',
							function: { name: 'FileRead', arguments: '{"path":"/etc/hosts"}' },
						},
					],
				},
				finish_reason: 'tool_calls',
			},
		],
		usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
	}
	const beta = __transformResponseForTest(oaiResp)
	expect(beta.stop_reason).toBe('tool_use')
	expect(beta.content).toEqual([
		{ type: 'tool_use', id: 'call_1', name: 'FileRead', input: { path: '/etc/hosts' } },
	])
})
