/** @jsxImportSource react */
import { test, expect, afterEach } from 'bun:test'
// NOTE: spec's `ink-testing-library` is unavailable here — see comment in
// tests/setup/inkRenderShim.ts. The shim provides the same `render(...)`
// surface used in this file (mount + run effects).
import { render } from '../../setup/inkRenderShim.js'
import * as React from 'react'
import { AppStateProvider, useAppStateStore } from '../../../src/state/AppState.js'
import { MedicalRuntimeBridge } from '../../../src/medical/runtime/MedicalRuntimeBridge.js'
import { __resetMedicalRuntimeForTests } from '../../../src/medical/runtime/medicalRuntime.js'
import {
  __resetPhiModeForTests,
  setPhiModeFromCli,
} from '../../../src/medical/runtime/phiMode.js'

afterEach(() => {
  __resetMedicalRuntimeForTests()
  __resetPhiModeForTests()
})

function StateProbe({ onSnapshot }: { onSnapshot: (s: any) => void }): null {
  const store = useAppStateStore()
  React.useEffect(() => {
    // Run after the bridge's effect — microtask defers past the current
    // commit batch so the bridge's setState has landed before we snapshot.
    queueMicrotask(() => onSnapshot(store.getState()))
  }, [onSnapshot, store])
  return null
}

test('bridge seeds AppState.phiMode = research when CLI mode is research', async () => {
  setPhiModeFromCli({ mode: 'research', allowOff: false })
  let snap: any = null
  render(
    <AppStateProvider>
      <MedicalRuntimeBridge mcpClients={[] as never} sessionId="s-research" />
      <StateProbe onSnapshot={(s) => { snap = s }} />
    </AppStateProvider>,
  )
  await new Promise((r) => setTimeout(r, 0))
  expect(snap.phiMode).toBe('research')
  expect(typeof snap.auditLogPath).toBe('string')
})

test('bridge seeds AppState.phiMode = off when CLI mode is off (with --allow-phi-off)', async () => {
  setPhiModeFromCli({ mode: 'off', allowOff: true })
  let snap: any = null
  render(
    <AppStateProvider>
      <MedicalRuntimeBridge mcpClients={[] as never} sessionId="s-off" />
      <StateProbe onSnapshot={(s) => { snap = s }} />
    </AppStateProvider>,
  )
  await new Promise((r) => setTimeout(r, 0))
  expect(snap.phiMode).toBe('off')
})

test('bridge seeds AppState.phiMode = strict for the default case (no regression)', async () => {
  setPhiModeFromCli({ mode: 'strict', allowOff: false })
  let snap: any = null
  render(
    <AppStateProvider>
      <MedicalRuntimeBridge mcpClients={[] as never} sessionId="s-strict" />
      <StateProbe onSnapshot={(s) => { snap = s }} />
    </AppStateProvider>,
  )
  await new Promise((r) => setTimeout(r, 0))
  expect(snap.phiMode).toBe('strict')
})
