import { test, expect, afterEach } from 'bun:test'
import {
  applyMedicalPermissionRules,
  installMedicalPermissionRulesIfMedical,
  medicalPermissionRules,
  shouldInstallMedicalPermissionRules,
} from '../../../src/medical/permissions/medicalRules.js'
import {
  __resetPhiModeForTests,
  setPhiModeFromCli,
} from '../../../src/medical/runtime/phiMode.js'
import {
  getDefaultAppState,
  type AppState,
} from '../../../src/state/AppStateStore.js'
import type { ToolPermissionContext } from '../../../src/types/permissions.js'

afterEach(() => {
  __resetPhiModeForTests()
})

const emptyCtx: ToolPermissionContext = {
  mode: 'default',
  additionalWorkingDirectories: new Map(),
  alwaysAllowRules: {},
  alwaysDenyRules: {},
  alwaysAskRules: {},
  isBypassPermissionsModeAvailable: false,
}

test('rules match spec §6.3 (real PermissionBehavior shape)', () => {
  const rules = medicalPermissionRules()
  const byTool = Object.fromEntries(
    rules.map((r) => [r.toolName, r.behavior]),
  ) as Record<string, string>
  expect(byTool['Bash']).toBe('ask')
  expect(byTool['Write']).toBe('ask')
  expect(byTool['WebFetch']).toBe('deny')
  expect(byTool['mcp__aegis-mcp__fhir_query']).toBe('allow')
  expect(byTool['mcp__aegis-mcp__deidentify']).toBe('allow')
  expect(byTool['mcp__aegis-mcp__reidentify']).toBe('allow')
  expect(byTool['mcp__aegis-mcp__list_templates']).toBe('allow')
  expect(byTool['mcp__aegis-mcp__render_template']).toBe('allow')
  // fhir_load_bundle is NOT registered (command-tool only).
  expect(byTool['mcp__aegis-mcp__fhir_load_bundle']).toBeUndefined()
})

test('applyMedicalPermissionRules merges rules under source: "session"', () => {
  const next = applyMedicalPermissionRules(emptyCtx)
  expect(next.alwaysAskRules.session).toContain('Bash')
  expect(next.alwaysAskRules.session).toContain('Write')
  expect(next.alwaysDenyRules.session).toContain('WebFetch')
  expect(next.alwaysAllowRules.session).toContain('mcp__aegis-mcp__deidentify')
  // No leakage to other sources
  expect(next.alwaysAllowRules.userSettings).toBeUndefined()
})

test('applyMedicalPermissionRules is idempotent (no duplicates on re-apply)', () => {
  const once = applyMedicalPermissionRules(emptyCtx)
  const twice = applyMedicalPermissionRules(once)
  expect(twice.alwaysAskRules.session?.filter((r) => r === 'Bash')).toHaveLength(1)
  expect(twice.alwaysAllowRules.session?.filter((r) => r === 'mcp__aegis-mcp__deidentify')).toHaveLength(1)
})

test('preserves pre-existing rules from other sources', () => {
  const withUser: ToolPermissionContext = {
    ...emptyCtx,
    alwaysAllowRules: { userSettings: ['Read'] },
  }
  const next = applyMedicalPermissionRules(withUser)
  expect(next.alwaysAllowRules.userSettings).toEqual(['Read'])
  expect(next.alwaysAllowRules.session).toContain('mcp__aegis-mcp__deidentify')
})

// [P1 review] Headless `--print` / SDK sessions never mount the React
// <MedicalPermissionsBridge>, so prior to this fix they ran with vanilla
// permissions: WebFetch ungated, Bash/Write not forced to ask. The shared
// gate predicate + AppState-updater installer below give the headless path
// the same treatment as the REPL bridge. Tests pin the strict/research/off
// truth table so a future regression in EITHER call site is caught here.

test('shouldInstallMedicalPermissionRules: strict → true', () => {
  setPhiModeFromCli({ mode: 'strict', allowOff: false })
  expect(shouldInstallMedicalPermissionRules()).toBe(true)
})

test('shouldInstallMedicalPermissionRules: research → true', () => {
  setPhiModeFromCli({ mode: 'research', allowOff: false })
  expect(shouldInstallMedicalPermissionRules()).toBe(true)
})

test('shouldInstallMedicalPermissionRules: off → false (spec §6.4 contract)', () => {
  setPhiModeFromCli({ mode: 'off', allowOff: true })
  expect(shouldInstallMedicalPermissionRules()).toBe(false)
})

test('installMedicalPermissionRulesIfMedical: strict mode mutates AppState toolPermissionContext via updater', () => {
  setPhiModeFromCli({ mode: 'strict', allowOff: false })
  let state: AppState = getDefaultAppState()
  installMedicalPermissionRulesIfMedical((updater) => {
    state = updater(state)
  })
  expect(state.toolPermissionContext.alwaysAskRules.session).toContain('Bash')
  expect(state.toolPermissionContext.alwaysAskRules.session).toContain('Write')
  expect(state.toolPermissionContext.alwaysDenyRules.session).toContain(
    'WebFetch',
  )
  expect(state.toolPermissionContext.alwaysAllowRules.session).toContain(
    'mcp__aegis-mcp__deidentify',
  )
})

test('installMedicalPermissionRulesIfMedical: research mode also installs (same as strict)', () => {
  setPhiModeFromCli({ mode: 'research', allowOff: false })
  let state: AppState = getDefaultAppState()
  installMedicalPermissionRulesIfMedical((updater) => {
    state = updater(state)
  })
  expect(state.toolPermissionContext.alwaysAskRules.session).toContain('Bash')
  expect(state.toolPermissionContext.alwaysDenyRules.session).toContain(
    'WebFetch',
  )
})

test('installMedicalPermissionRulesIfMedical: off mode SKIPS install — setState never called (spec §6.4 contract)', () => {
  // The headless regression: prior to this fix, --print never installed
  // the medical rules in any mode. The fix made strict/research install
  // them; this test pins that off mode still skips, preserving the
  // "pure Claude Code behavior" promise.
  setPhiModeFromCli({ mode: 'off', allowOff: true })
  let calls = 0
  installMedicalPermissionRulesIfMedical(() => {
    calls++
  })
  expect(calls).toBe(0)
})

test('installMedicalPermissionRulesIfMedical: preserves AppState slices outside toolPermissionContext', () => {
  setPhiModeFromCli({ mode: 'strict', allowOff: false })
  let state: AppState = {
    ...getDefaultAppState(),
    currentNote: 'pre-existing draft',
    auditLogPath: '/tmp/x.jsonl',
  }
  installMedicalPermissionRulesIfMedical((updater) => {
    state = updater(state)
  })
  // The updater is a partial-state merge — every other slice survives.
  expect(state.currentNote).toBe('pre-existing draft')
  expect(state.auditLogPath).toBe('/tmp/x.jsonl')
})
