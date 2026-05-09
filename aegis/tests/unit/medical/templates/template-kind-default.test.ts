import { test, expect } from 'bun:test'
import { createTemplateRegistry } from '../../../../src/medical/templates/templateRegistry.js'
import type { CallMcpTool } from '../../../../src/medical/adapters/fhirAdapter.js'

const SAMPLE_OLD_TEMPLATE = {
  id: 'old-template',
  name: 'Pre-kind Template',
  sections: [
    { id: 's1', title: 'S1', requiredFields: [], promptGuidance: '' },
  ],
  source: 'builtin' as const,
  // no kind — simulates older MCP server / user template
}

const SAMPLE_REPORT_TEMPLATE = {
  ...SAMPLE_OLD_TEMPLATE,
  id: 'report-tmpl',
  kind: 'report' as const,
}

function makeFakeCallTool(payload: unknown[]): CallMcpTool {
  return async (name) => {
    if (name === 'list_templates') return JSON.stringify(payload)
    throw new Error(`unexpected tool: ${name}`)
  }
}

test('templateRegistry defaults missing kind to clinical_note', async () => {
  const reg = createTemplateRegistry({ callTool: makeFakeCallTool([SAMPLE_OLD_TEMPLATE]) })
  const t = await reg.getTemplate('old-template')
  expect(t.kind).toBe('clinical_note')
})

test('templateRegistry preserves explicit kind: report', async () => {
  const reg = createTemplateRegistry({ callTool: makeFakeCallTool([SAMPLE_REPORT_TEMPLATE]) })
  const t = await reg.getTemplate('report-tmpl')
  expect(t.kind).toBe('report')
})

test('templateRegistry preserves explicit kind: clinical_note', async () => {
  const reg = createTemplateRegistry({
    callTool: makeFakeCallTool([{ ...SAMPLE_OLD_TEMPLATE, kind: 'clinical_note' }]),
  })
  const t = await reg.getTemplate('old-template')
  expect(t.kind).toBe('clinical_note')
})
