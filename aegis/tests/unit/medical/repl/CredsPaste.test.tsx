import { test, expect } from 'bun:test'
import { render } from '../../../setup/inkTestingShim.js'
import * as React from 'react'
import { CredsPaste } from '../../../../src/medical/repl/CredsPaste.js'
import { __setKeytarForTest } from '../../../../src/medical/providers/credentials.js'

test('typing characters renders only stars; Enter triggers saveCredential', async () => {
	const stored = new Map<string, string>()
	__setKeytarForTest({
		getPassword: async () => null,
		setPassword: async (svc, acc, pw) => { stored.set(`${svc}:${acc}`, pw) },
		deletePassword: async () => true,
	})
	const messages: string[] = []
	const onDone = (m: string) => { messages.push(m) }
	const { stdin, lastFrame, unmount } = render(<CredsPaste providerId="openai" onDone={onDone} />)
	stdin.write('sk-test-1234')
	const frame = lastFrame() ?? ''
	expect(frame).toContain('************') // 12 stars; the key itself never appears
	expect(frame).not.toContain('sk-test-1234')
	stdin.write('\r') // Enter
	await new Promise((r) => setTimeout(r, 10)) // let the async saveCredential settle
	expect(stored.get('aegis:openai')).toBe('sk-test-1234')
	expect(messages.join('\n')).toMatch(/stored in keychain/)
	unmount()
})

test('Esc cancels without saving', async () => {
	const stored = new Map<string, string>()
	__setKeytarForTest({
		getPassword: async () => null,
		setPassword: async (svc, acc, pw) => { stored.set(`${svc}:${acc}`, pw) },
		deletePassword: async () => true,
	})
	const messages: string[] = []
	const onDone = (m: string) => { messages.push(m) }
	const { stdin, unmount } = render(<CredsPaste providerId="openai" onDone={onDone} />)
	stdin.write('sk-secret-99')
	stdin.write('\x1b') // Esc
	await new Promise((r) => setTimeout(r, 10))
	expect(stored.size).toBe(0)
	expect(messages.join('\n')).toMatch(/cancelled/)
	unmount()
})
