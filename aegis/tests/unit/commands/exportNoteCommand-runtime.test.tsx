/** @jsxImportSource react */
import { test, expect, afterEach } from 'bun:test'
// NOTE: spec's `ink-testing-library` is unavailable here — see comment in
// tests/setup/inkRenderShim.ts. The shim provides the same `render(...)`
// surface used in this file (mount + run effects).
import { render } from '../../setup/inkRenderShim.js'
import * as React from 'react'
import { ExportNoteCommand } from '../../../src/commands/note/ExportNoteCommand.js'
import { AppStateProvider } from '../../../src/state/AppState.js'
import {
  getDefaultAppState,
  type AppState,
} from '../../../src/state/AppStateStore.js'
import { __resetMedicalRuntimeForTests } from '../../../src/medical/runtime/medicalRuntime.js'
import { __resetPhiModeForTests, setPhiModeFromCli } from '../../../src/medical/runtime/phiMode.js'

afterEach(() => {
  __resetMedicalRuntimeForTests()
  __resetPhiModeForTests()
})

/**
 * The hooks ExportNoteCommand uses (`useAppState`) throw outside an
 * `<AppStateProvider>` — without the provider this test would fail for the
 * wrong reason (provider missing, not runtime missing) and prove nothing
 * about the runtime-catch path. We wrap in a provider with `currentNote`
 * and `auditLogPath` deliberately seeded so the React shell would otherwise
 * proceed to call `runExportFlow` — but we DO NOT call `setMedicalRuntime`,
 * so `getMedicalRuntime()` throws and the shell must convert that throw
 * into an `onDone(system)` failure.
 */
function makeProviderState(): AppState {
  const base = getDefaultAppState()
  return { ...base, currentNote: 'drafted note text', auditLogPath: '/tmp/audit.jsonl' }
}

test('ExportNoteCommand: missing runtime → onDone receives structured failure (no unhandled throw)', async () => {
  setPhiModeFromCli({ mode: 'strict', allowOff: false })
  // Deliberately do NOT call setMedicalRuntime — simulate bridge not mounted.
  const calls: Array<{ msg?: string; opts?: { display?: 'system' | 'user' } }> = []
  const onDone = (msg?: string, opts?: { display?: 'system' | 'user' }) => {
    calls.push({ msg, opts })
  }
  render(
    <AppStateProvider initialState={makeProviderState()}>
      <ExportNoteCommand
        args={{ target: '/tmp/x.md', format: 'md', mode: 'full' }}
        onDone={onDone}
      />
    </AppStateProvider>,
  )
  // Yield once for the effect.
  await new Promise((r) => setTimeout(r, 0))
  expect(calls).toHaveLength(1)
  expect(calls[0].opts?.display).toBe('system')
  expect(calls[0].msg).toMatch(/medical runtime not initialized/i)
  // Critically: no unhandled promise rejection thrown during render.
})
