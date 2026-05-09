import { test, expect } from 'bun:test'
import { render } from '../../../setup/inkTestingShim.js'
import * as React from 'react'
import { ProviderConfirm } from '../../../../src/medical/repl/ProviderConfirm.js'

const cfg = {
	id: 'openai' as const,
	displayName: 'OpenAI',
	modelId: 'gpt-5',
	capabilities: { streaming: true, toolUse: true, promptCache: false, maxContextTokens: 128000 },
}

test('renders id, display, capabilities', () => {
	const { lastFrame } = render(<ProviderConfirm cfg={cfg} onResolve={() => {}} />)
	const out = lastFrame() ?? ''
	expect(out).toContain('Switch active provider')
	expect(out).toContain('openai')
	expect(out).toContain('OpenAI')
	expect(out).toContain('gpt-5')
})

test('y / Y accept; n / N / Escape reject; Enter is NOT an accept key', async () => {
	// Strict-mode confirmation must require explicit Y. Enter (the most
	// common reflex key) MUST not approve — see Decision #8 and the
	// ExportConfirm reference behavior.
	async function press(seq: string): Promise<{ accepted: boolean } | null> {
		let resolved: { accepted: boolean } | null = null
		const { stdin } = render(
			<ProviderConfirm cfg={cfg} onResolve={(r) => (resolved = r)} />,
		)
		stdin.write(seq)
		await new Promise((r) => setTimeout(r, 10))
		return resolved
	}
	expect(await press('y')).toEqual({ accepted: true })
	expect(await press('Y')).toEqual({ accepted: true })
	expect(await press('n')).toEqual({ accepted: false })
	expect(await press('N')).toEqual({ accepted: false })
	expect(await press('\x1b')).toEqual({ accepted: false }) // ESC
	// Enter / Return: MUST NOT resolve. Wait the same tick budget as the
	// other branches; if onResolve never fires, the resolved capture is
	// still null.
	expect(await press('\r')).toBeNull()
})
