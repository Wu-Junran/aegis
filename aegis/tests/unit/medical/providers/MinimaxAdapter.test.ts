import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	createMinimaxAdapter,
	__transformRequestForTest as txReq,
	__transformResponseForTest as txResp,
} from '../../../../src/medical/providers/MinimaxAdapter.js'

const cfg = {
	id: 'minimax' as const,
	modelId: 'abab6.5-chat',
	capabilities: { streaming: false, toolUse: false, promptCache: false, maxContextTokens: 245000 },
}

test('Minimax adapter id is minimax', () => {
	expect(createMinimaxAdapter().id).toBe('minimax')
})

test('Minimax inbound (chatcompletion_pro) extracts assistant text', () => {
	const fixture = JSON.parse(
		readFileSync(join(__dirname, '../../../fixtures/providers/minimax-chatcompletion-pro.json'), 'utf8'),
	)
	const beta = txResp(fixture)
	expect(beta.content[0]).toEqual({ type: 'text', text: 'Hello from Minimax.' })
	expect(beta.usage).toEqual({ input_tokens: 7, output_tokens: 5 })
})

test('Minimax outbound: tool-use request drops the tools schema (v1 graceful-degrade contract)', () => {
	// Decision #11 says capabilities are informative — `toolUse: false`
	// does NOT generally mean "drop tools" at the adapter boundary. The
	// Minimax v1 adapter is the explicit exception: master plan §M5 5.8
	// left native protocols for follow-up, so the adapter does NOT
	// translate Anthropic's `tools` schema to Minimax's `functions`
	// vocabulary. This test locks that v1 contract — the wire body has
	// no `functions` (and no `tools`) field. The matrix tool-use loop's
	// Minimax branch enforces the same invariant at integration level.
	// When the adapter is upgraded to parse `function_call`, this test
	// flips: assert `body.functions` is non-empty and shaped correctly.
	const req = {
		model: 'abab6.5-chat',
		max_tokens: 64,
		messages: [{ role: 'user' as const, content: 'Read /etc/hosts' }],
		tools: [
			{
				name: 'FileRead',
				description: 'Read a file',
				input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
			},
		],
	}
	const out = txReq(req as any, cfg) as Record<string, unknown>
	expect(out.functions).toBeUndefined()
	expect(out.tools).toBeUndefined()
	// Sanity: the rest of the body is still well-formed.
	expect(out.model).toBe('abab6.5-chat')
	expect(Array.isArray(out.messages)).toBe(true)
})

test('Minimax outbound: block-array `system` prompt is flattened, not dropped', () => {
	// Regression: real agent-loop requests build `params.system` via
	// `buildSystemPromptBlocks(...)` which returns `TextBlockParam[]`
	// (each entry `{ type: 'text', text: '...', cache_control?: {...} }`),
	// not a plain string. The earlier `typeof req.system === 'string'`
	// branch alone would silently drop the medical/safety/system
	// instructions and leave Minimax with only the hardcoded
	// `bot_setting` — invisible at the call site, catastrophic for any
	// behavior gated on system text.
	const req = {
		model: 'abab6.5-chat',
		max_tokens: 64,
		system: [
			{ type: 'text' as const, text: 'You are a clinical safety assistant.' },
			{ type: 'text' as const, text: 'Always cite the source for any clinical claim.' },
		],
		messages: [{ role: 'user' as const, content: 'Hi.' }],
	}
	const out = txReq(req as any, cfg) as { messages: Array<{ sender_type: string; sender_name: string; text: string }> }
	// First message must be the SYSTEM entry, with the flattened body.
	expect(out.messages[0].sender_type).toBe('SYSTEM')
	expect(out.messages[0].text).toBe(
		'You are a clinical safety assistant.\nAlways cite the source for any clinical claim.',
	)
	// Sanity: the user message survives in second position.
	expect(out.messages[1].sender_type).toBe('USER')
	expect(out.messages[1].text).toBe('Hi.')
})

test('Minimax outbound: string `system` prompt is preserved (legacy shape still supported)', () => {
	// Counter-test for the array branch above: string-shaped `system`
	// must continue to flow through unchanged. Without this, a fix for
	// the array-shape regression could accidentally over-narrow and
	// break the legacy path.
	const req = {
		model: 'abab6.5-chat',
		max_tokens: 64,
		system: 'You are a clinical safety assistant.',
		messages: [{ role: 'user' as const, content: 'Hi.' }],
	}
	const out = txReq(req as any, cfg) as { messages: Array<{ sender_type: string; text: string }> }
	expect(out.messages[0].sender_type).toBe('SYSTEM')
	expect(out.messages[0].text).toBe('You are a clinical safety assistant.')
})

test('Minimax outbound: block-array content is concatenated, not dropped', () => {
	// Regression: earlier draft did `typeof content === 'string' ? content
	// : ''`, which silently discarded the actual prompt for any structured
	// user message. Claude Code routinely sends `[{ type: 'text', text:
	// '...' }]` so this path is hot. Also exercise tool_result block
	// recovery (text-shaped content nested one level deep).
	const req = {
		model: 'abab6.5-chat',
		max_tokens: 64,
		messages: [
			{
				role: 'user' as const,
				content: [
					{ type: 'text', text: 'Hello from a block array.' },
					{ type: 'text', text: 'Second block.' },
				],
			},
			{
				role: 'user' as const,
				content: [
					{
						type: 'tool_result',
						tool_use_id: 'tu-1',
						content: [{ type: 'text', text: 'Tool returned this string.' }],
					},
				],
			},
		],
	}
	const out = txReq(req as any, cfg) as { messages: Array<{ sender_type: string; text: string }> }
	expect(out.messages).toHaveLength(2)
	expect(out.messages[0].text).toBe('Hello from a block array.\nSecond block.')
	expect(out.messages[1].text).toBe('Tool returned this string.')
	// Empty / unknown blocks must NOT silently leak as ''.
	for (const m of out.messages) expect(m.text.length).toBeGreaterThan(0)
})
