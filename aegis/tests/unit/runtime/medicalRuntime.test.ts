import { test, expect, beforeEach, afterEach } from 'bun:test'
import { homedir } from 'node:os'
import {
  __resetMedicalRuntimeForTests,
  getMedicalRuntime,
  setMedicalRuntime,
} from '../../../src/medical/runtime/medicalRuntime.js'
import { defaultAuditLogPath } from '../../../src/medical/runtime/auditPath.js'
import {
  __resetPhiModeForTests,
  getPhiMode,
  setPhiModeFromCli,
} from '../../../src/medical/runtime/phiMode.js'

beforeEach(() => __resetMedicalRuntimeForTests())
afterEach(() => __resetPhiModeForTests())

test('throws if read before set', () => {
  expect(() => getMedicalRuntime()).toThrow(/medicalRuntime/i)
})

// setMedicalRuntime is intentionally last-writer-wins (idempotent, not
// one-shot) because <MedicalRuntimeBridge> is rendered inside REPL.tsx's
// conditional UI tree and remounts during normal user flow (any picker
// open/close, message-actions cursor, etc.). Each remount creates a fresh
// `clientsRef`; refusing the re-set would silently leave `getMcpClients()`
// pointing at a stale closure once the user opened any slash-command
// picker. This test pins the live contract: the second call replaces the
// runtime, and the post-replace runtime is what `getMedicalRuntime()`
// returns. See `medicalRuntime.ts` for the full rationale.
test('setter is idempotent — second call replaces (last-writer-wins)', () => {
  const first = {
    getState: () => ({ tag: 'first' }) as any,
    setState: () => {},
    getMcpClients: () => [{ name: 'first-client' } as any],
    sessionId: 'abc-123',
  }
  const second = {
    getState: () => ({ tag: 'second' }) as any,
    setState: () => {},
    getMcpClients: () => [{ name: 'second-client' } as any],
    sessionId: 'abc-123',
  }
  setMedicalRuntime(first)
  expect(getMedicalRuntime().getState().tag).toBe('first')
  // Simulate the bridge remounting (e.g. user opened /model picker, closed it).
  expect(() => setMedicalRuntime(second)).not.toThrow()
  // Post-remount: the runtime now points at the second registration's closures.
  expect(getMedicalRuntime().getState().tag).toBe('second')
  expect(getMedicalRuntime().getMcpClients().map((c) => c.name)).toEqual([
    'second-client',
  ])
})

test('round-trips the holder', () => {
  const handle = {
    getState: () => ({ phiMode: 'strict' }) as any,
    setState: () => {},
    getMcpClients: () => [{ name: 'x' } as any],
    sessionId: 'abc-123',
  }
  setMedicalRuntime(handle)
  expect(getMedicalRuntime().sessionId).toBe('abc-123')
  expect(getMedicalRuntime().getMcpClients()).toHaveLength(1)
})

test('getMcpClients sees mutations to the underlying source (refs not snapshots)', () => {
  let live: readonly { name: string }[] = [{ name: 'one' } as any]
  setMedicalRuntime({
    getState: () => ({}) as any,
    setState: () => {},
    getMcpClients: () => live,
    sessionId: 'abc-123',
  })
  expect(getMedicalRuntime().getMcpClients().map((c) => c.name)).toEqual(['one'])
  // Simulate an MCP reconnect that swaps the client list
  live = [{ name: 'two' } as any, { name: 'three' } as any]
  expect(getMedicalRuntime().getMcpClients().map((c) => c.name)).toEqual(['two', 'three'])
})

// [P1 #2] Headless --print path mirrors the bridge: AppState seed +
// setMedicalRuntime. This test pins the contract that the headless path uses
// the EXACT same primitives as the React bridge (auditPath helper, phiMode
// runtime, setMedicalRuntime). If a future refactor splits these, this test
// breaks fast and points at the right files. The integration coverage of
// runHeadless lives in Task 4.15; this is the unit-level guard.
test('headless seed contract: store+sessionId is enough to satisfy getMedicalChain prereqs', () => {
  setPhiModeFromCli({ mode: 'research', allowOff: false })
  type FakeAppState = {
    auditLogPath?: string
    phiMode: 'strict' | 'research' | 'off'
    mcp: { clients: ReadonlyArray<{ name: string }> }
  }
  let state: FakeAppState = {
    phiMode: 'strict',
    mcp: { clients: [{ name: 'aegis-mcp' }] },
  }
  const getState = () => state as any
  const setState = (f: (prev: any) => any) => {
    state = f(state)
  }

  // Inline equivalent of the print.ts seed (kept in sync).
  setState((prev: FakeAppState) => ({
    ...prev,
    auditLogPath: defaultAuditLogPath('headless-session-1', homedir()),
    phiMode: getPhiMode(),
  }))
  setMedicalRuntime({
    getState,
    setState,
    getMcpClients: () => state.mcp.clients as any,
    sessionId: 'headless-session-1',
  })

  // After the seed, getMedicalChain's prereqs are met:
  //   - rt.getState().auditLogPath is non-null
  //   - rt.getMcpClients() is the live list
  //   - rt.sessionId is stable
  const rt = getMedicalRuntime()
  expect(rt.sessionId).toBe('headless-session-1')
  expect(typeof rt.getState().auditLogPath).toBe('string')
  expect(rt.getState().phiMode).toBe('research')
  expect(rt.getMcpClients()).toEqual([{ name: 'aegis-mcp' }] as any)

  // And the live ref still works in headless (MCP reconnect simulation).
  state = { ...state, mcp: { clients: [{ name: 'aegis-mcp-v2' }] } }
  expect(rt.getMcpClients()).toEqual([{ name: 'aegis-mcp-v2' }] as any)
})
