import { test, expect, beforeEach, afterEach } from 'bun:test'
import { checkRuleBasedPermissions } from '../../../src/utils/permissions/permissions.js'
import { applyMedicalPermissionRules } from '../../../src/medical/permissions/medicalRules.js'
import {
  __resetPhiModeForTests,
  setPhiModeFromCli,
} from '../../../src/medical/runtime/phiMode.js'
import type { ToolPermissionContext } from '../../../src/types/permissions.js'
import type { ToolUseContext } from '../../../src/Tool.js'
import { getDefaultAppState, type AppState } from '../../../src/state/AppStateStore.js'
import { BASH_TOOL_NAME } from '../../../src/tools/BashTool/toolName.js'
// IMPORTANT (mock-timing fix): we import the SAME `SandboxManager` object
// reference that `permissions.ts` already captured when it was loaded
// (statically importing `checkRuleBasedPermissions` above transitively
// loaded permissions.ts → sandbox-adapter.ts). `SandboxManager` is exported
// as a `const` object, so mutating its methods here changes the methods
// `permissions.ts` invokes — no `mock.module` race between import order
// and registration. Originals are saved + restored per test.
import { SandboxManager } from '../../../src/utils/sandbox/sandbox-adapter.js'

// Stand-in for the real Bash tool — only the fields the engine touches.
// The engine calls `getDenyRuleForTool(ctx, tool)` (uses `tool.name`),
// `getAskRuleForTool(ctx, tool)` (uses `tool.name`), and falls through to
// `tool.checkPermissions(parsedInput, context)` if the rule allows fall-through.
const bashToolStub = {
  name: BASH_TOOL_NAME, // 'Bash'
  inputSchema: { parse: (x: unknown) => x },
  checkPermissions: async () => ({ behavior: 'allow' as const, message: '' }),
} as never

function makeContext(overrides: Partial<AppState> = {}): ToolUseContext {
  const appState: AppState = { ...getDefaultAppState(), ...overrides }
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-6',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    abortController: new AbortController(),
    readFileState: new Map(),
    getAppState: () => appState,
    setAppState: () => {},
    messages: [],
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
  } as unknown as ToolUseContext
}

const baseToolPermCtx: ToolPermissionContext = {
  mode: 'default',
  additionalWorkingDirectories: new Map(),
  alwaysAllowRules: {},
  alwaysDenyRules: {},
  alwaysAskRules: {},
  isBypassPermissionsModeAvailable: false,
}

// In-place method swap on the LIVE SandboxManager export. Saves originals,
// returns a restorer the test (or afterEach) calls to undo. This is what
// makes the test hermetic: no module re-load, no import-order race; the
// engine sees the swapped methods because it holds the same object reference.
function withSandboxFlags(args: {
  isSandboxingEnabled: boolean
  isAutoAllowBashIfSandboxedEnabled: boolean
}): () => void {
  const origSandboxing = SandboxManager.isSandboxingEnabled
  const origAutoAllow = SandboxManager.isAutoAllowBashIfSandboxedEnabled
  SandboxManager.isSandboxingEnabled = () => args.isSandboxingEnabled
  SandboxManager.isAutoAllowBashIfSandboxedEnabled = () =>
    args.isAutoAllowBashIfSandboxedEnabled
  return () => {
    SandboxManager.isSandboxingEnabled = origSandboxing
    SandboxManager.isAutoAllowBashIfSandboxedEnabled = origAutoAllow
  }
}

let restoreSandbox: (() => void) | null = null
beforeEach(() => {
  __resetPhiModeForTests()
})
afterEach(() => {
  __resetPhiModeForTests()
  if (restoreSandbox) {
    restoreSandbox()
    restoreSandbox = null
  }
})

test('strict mode + sandboxable Bash command → asks (sandbox bypass blocked by medical-session gate)', async () => {
  setPhiModeFromCli({ mode: 'strict', allowOff: false })
  // Dev-env case: sandbox auto-allow is ON globally. Medical-session
  // gate must still produce 'ask'.
  restoreSandbox = withSandboxFlags({
    isSandboxingEnabled: true,
    isAutoAllowBashIfSandboxedEnabled: true,
  })
  const toolPermCtx = applyMedicalPermissionRules(baseToolPermCtx)
  const ctx = makeContext({ toolPermissionContext: toolPermCtx })
  const result = await checkRuleBasedPermissions(
    bashToolStub,
    { command: 'ls' },
    ctx,
  )
  expect(result?.behavior).toBe('ask')
})

test('phi-mode=off + sandboxable Bash command → returns null (sandbox bypass allowed; engine falls through to tool.checkPermissions)', async () => {
  setPhiModeFromCli({ mode: 'off', allowOff: true })
  restoreSandbox = withSandboxFlags({
    isSandboxingEnabled: true,
    isAutoAllowBashIfSandboxedEnabled: true,
  })
  // Install the medical rules WITH the off-mode bridge skipped (off mode
  // contractually doesn't install rules — but here we install them
  // explicitly to prove the GATE controls the bypass, not the RULE).
  const toolPermCtx = applyMedicalPermissionRules(baseToolPermCtx)
  const ctx = makeContext({ toolPermissionContext: toolPermCtx })
  const result = await checkRuleBasedPermissions(
    bashToolStub,
    { command: 'ls' },
    ctx,
  )
  // checkRuleBasedPermissions returns null when the rule chain doesn't
  // produce ask/deny — the bypass took the ask rule out, falling through
  // to tool.checkPermissions (returns 'allow' in our stub but the engine
  // returns null at this layer to let the caller invoke the tool check).
  expect(result).toBeNull()
})

test('strict mode + Bash WITHOUT sandbox auto-allow → asks (control: ask rule applies the normal way)', async () => {
  setPhiModeFromCli({ mode: 'strict', allowOff: false })
  restoreSandbox = withSandboxFlags({
    isSandboxingEnabled: true,
    isAutoAllowBashIfSandboxedEnabled: false, // bypass NOT enabled
  })
  const toolPermCtx = applyMedicalPermissionRules(baseToolPermCtx)
  const ctx = makeContext({ toolPermissionContext: toolPermCtx })
  const result = await checkRuleBasedPermissions(
    bashToolStub,
    { command: 'ls' },
    ctx,
  )
  expect(result?.behavior).toBe('ask')
})

// ─────────────────────────────────────────────────────────────────────────
// SECOND BYPASS SITE COVERAGE
// `permissions.ts` has TWO `canSandboxAutoAllow` blocks: one inside
// `checkRuleBasedPermissions` (line ~1094, covered by the tests above)
// and one inside `hasPermissionsToUseToolInner` (line ~1189, reached only
// via the `hasPermissionsToUseTool` entry point). The REPL goes through
// `hasPermissionsToUseTool` — a worker could fix one bypass site while
// leaving the other unpatched and the tests above would still pass.
// These parallel tests prove BOTH sites enforce the medical-session gate.
// ─────────────────────────────────────────────────────────────────────────
import { hasPermissionsToUseTool } from '../../../src/utils/permissions/permissions.js'
import type { AssistantMessage } from '../../../src/types/message.js'

const fakeAssistantMessage = {
  type: 'assistant',
  uuid: 'test-uuid',
  message: { content: [], usage: { input_tokens: 0, output_tokens: 0 } },
} as unknown as AssistantMessage

test('hasPermissionsToUseTool: strict mode + sandboxable Bash → asks (second bypass site also gated)', async () => {
  setPhiModeFromCli({ mode: 'strict', allowOff: false })
  restoreSandbox = withSandboxFlags({
    isSandboxingEnabled: true,
    isAutoAllowBashIfSandboxedEnabled: true,
  })
  const toolPermCtx = applyMedicalPermissionRules(baseToolPermCtx)
  const ctx = makeContext({ toolPermissionContext: toolPermCtx })
  const result = await hasPermissionsToUseTool(
    bashToolStub,
    { command: 'ls' },
    ctx,
    fakeAssistantMessage,
    'tu-1',
  )
  expect(result.behavior).toBe('ask')
})

test('hasPermissionsToUseTool: phi-mode=off + sandboxable Bash → bypass restored (falls through to tool.checkPermissions → "allow")', async () => {
  setPhiModeFromCli({ mode: 'off', allowOff: true })
  restoreSandbox = withSandboxFlags({
    isSandboxingEnabled: true,
    isAutoAllowBashIfSandboxedEnabled: true,
  })
  const toolPermCtx = applyMedicalPermissionRules(baseToolPermCtx)
  const ctx = makeContext({ toolPermissionContext: toolPermCtx })
  const result = await hasPermissionsToUseTool(
    bashToolStub,
    { command: 'ls' },
    ctx,
    fakeAssistantMessage,
    'tu-2',
  )
  // hasPermissionsToUseTool DOES invoke tool.checkPermissions on the
  // fall-through path (unlike checkRuleBasedPermissions which returns
  // null and lets the caller decide). Our stub returns 'allow', so the
  // bypass-restored case yields 'allow' end-to-end.
  expect(result.behavior).toBe('allow')
})

test('hasPermissionsToUseTool: strict mode without sandbox auto-allow → asks (control)', async () => {
  setPhiModeFromCli({ mode: 'strict', allowOff: false })
  restoreSandbox = withSandboxFlags({
    isSandboxingEnabled: true,
    isAutoAllowBashIfSandboxedEnabled: false,
  })
  const toolPermCtx = applyMedicalPermissionRules(baseToolPermCtx)
  const ctx = makeContext({ toolPermissionContext: toolPermCtx })
  const result = await hasPermissionsToUseTool(
    bashToolStub,
    { command: 'ls' },
    ctx,
    fakeAssistantMessage,
    'tu-3',
  )
  expect(result.behavior).toBe('ask')
})
