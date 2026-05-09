import { test, expect } from 'bun:test'
import {
	applyAegisMcpToolFilters,
	isAegisCommandTool,
} from '../../src/services/mcp/client.js'

const t = (name: string) => ({ name }) as any

test('isAegisCommandTool hides fhir_load_bundle only', () => {
	expect(isAegisCommandTool('mcp__aegis-mcp__fhir_load_bundle')).toBe(true)
	expect(isAegisCommandTool('mcp__aegis-mcp__fhir_query')).toBe(false)
	expect(isAegisCommandTool('mcp__aegis-mcp__list_templates')).toBe(false)
	expect(isAegisCommandTool('mcp__aegis-mcp__render_template')).toBe(false)
	expect(isAegisCommandTool('mcp__ide__executeCode')).toBe(false)
})

test('applyAegisMcpToolFilters strips fhir_load_bundle and forbidden IDE tools', () => {
	const input = [
		t('mcp__aegis-mcp__fhir_load_bundle'),
		t('mcp__aegis-mcp__fhir_query'),
		t('mcp__aegis-mcp__list_templates'),
		t('mcp__aegis-mcp__render_template'),
		t('mcp__ide__executeCode'),
		t('mcp__ide__someOtherTool'),
		t('mcp__other-server__my_tool'),
	]
	const names = applyAegisMcpToolFilters(input).map(x => x.name)
	expect(names).not.toContain('mcp__aegis-mcp__fhir_load_bundle')
	expect(names).not.toContain('mcp__ide__someOtherTool')
	expect(names).toContain('mcp__aegis-mcp__fhir_query')
	expect(names).toContain('mcp__aegis-mcp__list_templates')
	expect(names).toContain('mcp__aegis-mcp__render_template')
	expect(names).toContain('mcp__ide__executeCode')
	expect(names).toContain('mcp__other-server__my_tool')
})
