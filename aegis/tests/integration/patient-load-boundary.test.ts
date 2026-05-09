import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyAegisMcpToolFilters } from '../../src/services/mcp/client.js'

const t = (name: string) => ({ name }) as any

test('LLM tool list excludes fhir_load_bundle after the production filter', () => {
	const toolList = [
		t('mcp__aegis-mcp__fhir_load_bundle'),
		t('mcp__aegis-mcp__fhir_query'),
		t('mcp__aegis-mcp__list_templates'),
		t('mcp__aegis-mcp__render_template'),
		t('mcp__ide__executeCode'),
		t('mcp__ide__someOtherTool'),
		t('mcp__other-server__some_tool'),
	]
	const visible = applyAegisMcpToolFilters(toolList).map(x => x.name)

	expect(visible).not.toContain('mcp__aegis-mcp__fhir_load_bundle')
	expect(visible).not.toContain('mcp__ide__someOtherTool')
	expect(visible).toContain('mcp__aegis-mcp__fhir_query')
	expect(visible).toContain('mcp__aegis-mcp__list_templates')
	expect(visible).toContain('mcp__aegis-mcp__render_template')
	expect(visible).toContain('mcp__ide__executeCode')
	expect(visible).toContain('mcp__other-server__some_tool')
})

test('wire-up guard: fetchToolsForClient actually calls applyAegisMcpToolFilters', () => {
	const src = readFileSync(
		join(__dirname, '..', '..', 'src', 'services', 'mcp', 'client.ts'),
		'utf8',
	)
	expect(src).toContain('applyAegisMcpToolFilters(')
	const fetchIdx = src.indexOf('fetchToolsForClient')
	expect(fetchIdx).toBeGreaterThan(-1)
	// The helper is called at the end of the memoized body; simply assert
	// the invocation appears AFTER the function-start marker.
	const usageIdx = src.indexOf('applyAegisMcpToolFilters(', fetchIdx)
	expect(usageIdx).toBeGreaterThan(fetchIdx)
})
