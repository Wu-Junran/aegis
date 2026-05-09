/** @jsxImportSource react */
import { test, expect, afterEach } from 'bun:test'
// NOTE: spec's `ink-testing-library` is unavailable here — see comment in
// tests/setup/inkRenderShim.ts. The shim provides the same `render(...)`
// surface used in this file (mount + run effects).
import { render } from '../../setup/inkRenderShim.js'
import * as React from 'react'
import { MedicalPermissionsBridge } from '../../../src/medical/permissions/MedicalPermissionsBridge.js'
import {
  __resetPhiModeForTests,
  setPhiModeFromCli,
} from '../../../src/medical/runtime/phiMode.js'
import type { ToolPermissionContext } from '../../../src/types/permissions.js'

afterEach(() => {
  __resetPhiModeForTests()
})

const baseCtx: ToolPermissionContext = {
  mode: 'default',
  additionalWorkingDirectories: new Map(),
  alwaysAllowRules: {},
  alwaysDenyRules: {},
  alwaysAskRules: {},
  isBypassPermissionsModeAvailable: false,
}

test('strict mode: bridge installs medical rules', async () => {
  setPhiModeFromCli({ mode: 'strict', allowOff: false })
  const calls: ToolPermissionContext[] = []
  render(
    <MedicalPermissionsBridge
      toolPermissionContext={baseCtx}
      setToolPermissionContext={(next) => calls.push(next)}
    />,
  )
  await new Promise((r) => setTimeout(r, 0))
  expect(calls).toHaveLength(1)
  expect(calls[0].alwaysAskRules.session).toContain('Bash')
  expect(calls[0].alwaysDenyRules.session).toContain('WebFetch')
})

test('research mode: bridge installs medical rules (same as strict)', async () => {
  setPhiModeFromCli({ mode: 'research', allowOff: false })
  const calls: ToolPermissionContext[] = []
  render(
    <MedicalPermissionsBridge
      toolPermissionContext={baseCtx}
      setToolPermissionContext={(next) => calls.push(next)}
    />,
  )
  await new Promise((r) => setTimeout(r, 0))
  expect(calls).toHaveLength(1)
  expect(calls[0].alwaysAskRules.session).toContain('Bash')
})

test('off mode: bridge SKIPS rule installation (pure Claude Code permission behavior — spec §6.4 contract)', async () => {
  // Regression: without the off-mode short-circuit, launching
  // --phi-mode=off --allow-phi-off would still deny WebFetch and force
  // Bash/Write asks, contradicting "pure Claude Code behavior".
  setPhiModeFromCli({ mode: 'off', allowOff: true })
  const calls: ToolPermissionContext[] = []
  render(
    <MedicalPermissionsBridge
      toolPermissionContext={baseCtx}
      setToolPermissionContext={(next) => calls.push(next)}
    />,
  )
  await new Promise((r) => setTimeout(r, 0))
  // The setter is NEVER called — bridge short-circuits before applying rules.
  expect(calls).toHaveLength(0)
})
