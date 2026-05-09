import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { createStore } from '../../src/state/store.js'
import { getDefaultAppState, type AppState } from '../../src/state/AppStateStore.js'
import { setMedicalRuntime, __resetMedicalRuntimeForTests } from '../../src/medical/runtime/medicalRuntime.js'
import { setSessionProvider } from '../../src/services/api/sessionProvider.js'
import { setPhiModeFromCli, __resetPhiModeForTests } from '../../src/medical/runtime/phiMode.js'
import { loadPatient } from '../../src/medical/adapters/fhirAdapter.js'
import { createTemplateRegistry } from '../../src/medical/templates/templateRegistry.js'
import { sendRedactedRequestNonStreaming } from '../../src/services/api/redactedSend.js'
import { buildMedicalMiddleware } from '../../src/medical/runtime/middlewareWiring.js'
import { openAuditLogger, type AuditLogger } from '../../src/medical/audit/AuditLogger.js'
import { runExportFlow } from '../../src/commands/note/runExportFlow.js'
import type { CallMcpTool } from '../../src/medical/adapters/fhirAdapter.js'
import type { ExportOpts, ExportPromptResponse, ExportPromptSummary } from '../../src/medical/export/NoteExportGate.js'
import type { CurrentNoteValue } from '../../src/medical/state/currentNote.js'
import { createMcpDeIdentifier } from '../../src/medical/deid/mcpDeIdentifier.js'
import type { DeIdentifier } from '../../src/medical/deid/DeIdentifier.js'
import {
  sharedMcpClient,
  closeSharedMcpClient,
  MissingMcpBinError,
  aegisMcpBinPath,
} from './spawnMcp.js'
import { canonicalizeRequest, requestHash } from './canonicalRequest.js'
import { appendClinicalOverlay } from '../../src/medical/prompts/clinicalSystemPrompt.js'

export type HarnessOpts = {
  bundlePath: string
  templateId: string
  phiMode?: 'strict' | 'research'
  callTool?: CallMcpTool
  anthropicClient?: Anthropic
}

export type Harness = {
  store: ReturnType<typeof createStore<AppState>>
  draftTurn: (userPrompt: string) => Promise<CurrentNoteValue>
  runExport: (args: ExportOpts) => Promise<{ ok: boolean; message: string; promptSummary: ExportPromptSummary | null }>
  cleanup: () => void
}

export async function makeHarness(opts: HarnessOpts): Promise<Harness> {
  __resetMedicalRuntimeForTests()
  __resetPhiModeForTests()
  const phiMode = opts.phiMode ?? 'research'
  setPhiModeFromCli({ mode: phiMode, allowOff: false })

  const store = createStore<AppState>(getDefaultAppState())
  const tmp = mkdtempSync(join(tmpdir(), 'aegis-wf-'))
  const auditPath = join(tmp, 'audit.jsonl')
  store.setState(s => ({ ...s, auditLogPath: auditPath }))

  const callTool: CallMcpTool = opts.callTool ?? defaultHarnessCallTool

  setMedicalRuntime({
    getState: () => store.getState(),
    setState: updater => store.setState(updater),
    getMcpClients: () => [],
    sessionId: 'test-session',
  })

  const patient = await loadPatient(opts.bundlePath, { callTool })
  store.setState(s => ({ ...s, currentPatient: patient }))
  const reg = createTemplateRegistry({ callTool })
  const template = await reg.getTemplate(opts.templateId)
  store.setState(s => ({ ...s, currentTemplate: template }))

  setSessionProvider({
    id: 'anthropic',
    modelId: 'claude-haiku-4-5-20251001',
    capabilities: { streaming: true, toolUse: true, promptCache: true, maxContextTokens: 200_000 },
  })

  const deid = createMcpDeIdentifier({ callTool })
  let logger: AuditLogger | null = null
  function getOrOpenLogger(): AuditLogger {
    if (logger == null) logger = openAuditLogger(auditPath, phiMode)
    return logger
  }

  async function draftTurn(userPrompt: string): Promise<CurrentNoteValue> {
    const chain = buildMedicalMiddleware({
      deid,
      logger: getOrOpenLogger(),
      mode: phiMode,
      setNote: (value: CurrentNoteValue) => store.setState(s => ({ ...s, currentNote: value })),
      isDraftingContext: () => {
        const s = store.getState()
        return !!s.currentPatient && !!s.currentTemplate
      },
      callTool,
      getPatientContext: () => store.getState().currentPatient,
      getTemplate: () => store.getState().currentTemplate,
      pushValidatorWarnings: ws => store.setState(s => ({ ...s, validatorWarnings: ws })),
    })
    const baseReq = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: appendClinicalOverlay(['You are Aegis (test harness).'], store.getState()).join('\n'),
      messages: [{ role: 'user' as const, content: userPrompt }],
    } as Record<string, unknown>
    const ctx: any = { requestId: `req-${Date.now()}-${Math.random()}` }
    let outbound = baseReq
    for (const mw of chain.outbound) {
      outbound = (await mw.process(outbound, ctx)) as Record<string, unknown>
    }
    const redacted = outbound as any
    const isRecord = process.env.AEGIS_RECORD === '1'
    if (isRecord && !opts.anthropicClient && !process.env.ANTHROPIC_API_KEY && !process.env.DEEPSEEK_API_KEY) {
      throw new Error(
        'AEGIS_RECORD=1 requires either an explicit anthropicClient or one of: ANTHROPIC_API_KEY (default), DEEPSEEK_API_KEY (DeepSeek\'s Anthropic-compatible endpoint).',
      )
    }
    const client = opts.anthropicClient ?? new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY ?? 'replay-mode-placeholder',
    })
    const message = await sendRedactedRequestNonStreaming(client, redacted, undefined as any)
    let inbound: any = { message }
    for (const mw of chain.inbound) {
      inbound = await mw.process(inbound, ctx)
    }
    return store.getState().currentNote
  }

  async function runExport(args: ExportOpts) {
    let promptSummary: ExportPromptSummary | null = null
    const prompt = async (
      _kind: 'attestation' | 'phi-extra-confirm',
      summary: ExportPromptSummary,
    ): Promise<ExportPromptResponse> => {
      promptSummary = summary
      return { accepted: true, attestationText: 'TEST-SIGNOFF' }
    }
    const result = await runExportFlow({
      note: store.getState().currentNote,
      auditPath,
      runtime: {
        getState: () => store.getState(),
        setState: updater => store.setState(updater),
        getMcpClients: () => [],
        sessionId: 'test-session',
      },
      args,
      prompt,
      loggerFactory: () => getOrOpenLogger(),
      deidOverride: deid,
      callToolOverride: callTool,
    })
    return { ...result, promptSummary }
  }

  function cleanup() {
    setSessionProvider(null)
    __resetMedicalRuntimeForTests()
    __resetPhiModeForTests()
    if (logger) void logger.close().catch(() => undefined)
  }

  return { store, draftTurn, runExport, cleanup }
}

export const defaultHarnessCallTool: CallMcpTool = async (name, args) => {
  const client = await sharedMcpClient()
  const r = await client.callTool({ name, arguments: args })
  const text = (r.content as any[])
    .filter(b => b?.type === 'text' && typeof b.text === 'string')
    .map(b => b.text as string)
    .join('')
  if (!text) throw new Error(`aegis-mcp tool ${name} returned no text content`)
  return text
}

export async function buildRedactedDraftRequest(args: {
  store: ReturnType<typeof createStore<AppState>>
  callTool: CallMcpTool
  phiMode: 'strict' | 'research'
  userPrompt: string
  logger?: AuditLogger
  deid?: DeIdentifier
}): Promise<{ redacted: any; requestHash: string; canonicalRequest: unknown }> {
  const deid = args.deid ?? createMcpDeIdentifier({ callTool: args.callTool })
  const logger = args.logger ?? { append: async () => {}, close: async () => {} }
  const chain = buildMedicalMiddleware({
    deid,
    logger,
    mode: args.phiMode,
    setNote: () => {},
    isDraftingContext: () => true,
    callTool: args.callTool,
    getPatientContext: () => args.store.getState().currentPatient,
    getTemplate: () => args.store.getState().currentTemplate,
    pushValidatorWarnings: () => {},
  })
  const baseReq = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: appendClinicalOverlay(['You are Aegis (test harness).'], args.store.getState()).join('\n'),
    messages: [{ role: 'user' as const, content: args.userPrompt }],
  } as Record<string, unknown>
  const ctx: any = { requestId: 'build-redacted-draft-request' }
  let outbound = baseReq
  for (const mw of chain.outbound) {
    outbound = (await mw.process(outbound, ctx)) as Record<string, unknown>
  }
  const redacted = outbound as any
  const canonicalRequest = canonicalizeRequest(redacted)
  return { redacted, requestHash: requestHash(redacted), canonicalRequest }
}
