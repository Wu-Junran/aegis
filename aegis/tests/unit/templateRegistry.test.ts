import { test, expect } from 'bun:test'
import { createTemplateRegistry } from '../../src/medical/templates/templateRegistry.js'

const fakeTemplates = [
	{ id: 'soap', name: 'SOAP', source: 'builtin', sections: [] },
	{ id: 'discharge', name: 'Discharge', source: 'builtin', sections: [] },
]

test('listTemplates calls list_templates once and caches', async () => {
	let calls = 0
	const callTool = async (name: string) => {
		calls += 1
		expect(name).toBe('list_templates')
		return JSON.stringify(fakeTemplates)
	}
	const reg = createTemplateRegistry({ callTool })
	const a = await reg.listTemplates()
	const b = await reg.listTemplates()
	expect(calls).toBe(1)
	expect(a).toEqual(b)
	expect(a.map(t => t.id)).toEqual(['soap', 'discharge'])
})

test('getTemplate returns cached entry or throws on unknown', async () => {
	const callTool = async () => JSON.stringify(fakeTemplates)
	const reg = createTemplateRegistry({ callTool })
	const soap = await reg.getTemplate('soap')
	expect(soap.name).toBe('SOAP')
	await expect(reg.getTemplate('missing')).rejects.toThrow(/missing/)
})
