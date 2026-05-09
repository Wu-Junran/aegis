import { test, expect } from 'bun:test'
import { makeRenderForExport } from '../../../src/medical/export/templateRenderer.js'

test('M4: returns input unchanged regardless of state (pass-through)', async () => {
  const renderNoState = makeRenderForExport({
    callTool: async () => { throw new Error('should not be called in M4') },
    getAppState: () => ({
      currentPatient: null,
      currentTemplate: null,
    } as any),
  })
  expect(await renderNoState('hello', 'md')).toBe('hello')

  const renderWithState = makeRenderForExport({
    callTool: async () => { throw new Error('should not be called in M4') },
    getAppState: () => ({
      currentPatient: { patientId: 'p1' },
      currentTemplate: { id: 'soap', name: 'SOAP', sections: [], source: 'builtin' },
    } as any),
  })
  // Same input → same output. callTool was given a guard that throws if
  // called; the test passing proves we never reached it.
  expect(await renderWithState('multi-line\nnote text', 'md')).toBe('multi-line\nnote text')
})

test('non-empty filled_sections invokes render_template with the section map', async () => {
  const calls: Array<{ name: string; args: any }> = []
  const callTool = async (name: string, args: any) => {
    calls.push({ name, args })
    return '# Rendered\nA\nB'
  }
  const renderer = makeRenderForExport({
    callTool,
    getAppState: () =>
      ({
        currentTemplate: { id: 'soap', name: 'SOAP', source: 'builtin', sections: [
          { id: 'subjective', title: 'Subjective', requiredFields: [], promptGuidance: '' },
        ] },
        currentPatient: { patientId: 'p1', demographics: {}, problems: [], medications: [], allergies: [], observations: [], encounters: [], priorNotes: [] },
        currentNote: { free: null, filled_sections: { subjective: 'body' } },
      }) as any,
  })
  const out = await renderer('IGNORED — should pass filled_sections', 'md')
  expect(out).toBe('# Rendered\nA\nB')
  expect(calls).toHaveLength(1)
  expect(calls[0].name).toBe('render_template')
  expect(calls[0].args.template_id).toBe('soap')
  expect(calls[0].args.filled_sections).toEqual({ subjective: 'body' })
})

test('empty filled_sections falls back to free / passthrough', async () => {
  const callTool = async () => { throw new Error('should not be called') }
  const renderer = makeRenderForExport({
    callTool,
    getAppState: () =>
      ({
        currentTemplate: null,
        currentPatient: null,
        currentNote: { free: 'plaintext note', filled_sections: {} },
      }) as any,
  })
  const out = await renderer('plaintext note', 'md')
  expect(out).toBe('plaintext note')
})

test('partial filled_sections is normalized against template ids before render_template (P2#4 fix)', async () => {
  // Regression: render_template uses jinja2.StrictUndefined; missing keys
  // would otherwise raise UndefinedError. The renderer must fill every
  // expected section id with '' so the template body resolves and check 5
  // (sections) surfaces the gap as a non-blocking warning at the gate.
  const calls: Array<{ name: string; args: any }> = []
  const callTool = async (name: string, args: any) => {
    calls.push({ name, args })
    return '# Rendered\nbody'
  }
  const renderer = makeRenderForExport({
    callTool,
    getAppState: () =>
      ({
        currentTemplate: { id: 'soap', name: 'SOAP', source: 'builtin', sections: [
          { id: 'subjective', title: 'Subjective', requiredFields: [], promptGuidance: '' },
          { id: 'objective',  title: 'Objective',  requiredFields: [], promptGuidance: '' },
          { id: 'assessment', title: 'Assessment', requiredFields: [], promptGuidance: '' },
          { id: 'plan',       title: 'Plan',       requiredFields: [], promptGuidance: '' },
        ] },
        currentPatient: { patientId: 'p1', demographics: {}, problems: [], medications: [], allergies: [], observations: [], encounters: [], priorNotes: [] },
        currentNote: { free: null, filled_sections: { plan: 'Continue lisinopril.' } },
      }) as any,
  })
  await renderer('IGNORED', 'md')
  expect(calls).toHaveLength(1)
  expect(calls[0].args.filled_sections).toEqual({
    subjective: '',
    objective:  '',
    assessment: '',
    plan: 'Continue lisinopril.',
  })
})
