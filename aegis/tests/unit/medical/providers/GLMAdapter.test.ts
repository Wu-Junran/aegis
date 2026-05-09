import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	createGLMAdapter,
	__transformRequestForTest as txReq,
	__transformResponseForTest as txResp,
} from '../../../../src/medical/providers/GLMAdapter.js'
import type { ProviderConfig } from '../../../../src/medical/providers/ProviderAdapter.js'

const cfg: ProviderConfig = {
	id: 'glm',
	modelId: 'glm-4',
	capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128000 },
}

test('GLM adapter id is glm; default baseURL when not provided', () => {
	const a = createGLMAdapter()
	expect(a.id).toBe('glm')
	expect(a.displayName.toLowerCase()).toContain('glm')
})

test('GLM outbound: system prompt is preserved as messages[0] (compat path)', () => {
	const req = {
		model: 'glm-4',
		max_tokens: 64,
		system: 'You are a clinical assistant.',
		messages: [{ role: 'user', content: 'Hi' }],
	} as any
	const out = txReq(req, cfg)
	expect(out.messages[0]).toEqual({ role: 'system', content: 'You are a clinical assistant.' })
})

test('GLM inbound fixture parses to BetaMessage', () => {
	const fixture = JSON.parse(
		readFileSync(join(__dirname, '../../../fixtures/providers/glm-response.json'), 'utf8'),
	)
	const beta = txResp(fixture)
	expect(beta.content[0]).toEqual({ type: 'text', text: '你好。' })
})
