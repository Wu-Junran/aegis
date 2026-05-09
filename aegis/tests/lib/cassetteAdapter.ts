import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { requestHash, canonicalizeRequest } from './canonicalRequest.js'
import {
  __setAdapterInterceptorForTest,
} from '../../src/medical/providers/adapterRegistry.js'
import type {
  AdapterRequest,
  AdapterRequestOptions,
  AdapterResponse,
  ProviderAdapter,
  ProviderConfig,
  SessionProviderId,
} from '../../src/medical/providers/ProviderAdapter.js'
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

export type CassetteMode = 'record' | 'replay'

export type CassetteOptions = {
  workflow: string
  cassetteDir?: string
  mode?: CassetteMode
}

type CassetteLine = {
  requestHash: string
  request: unknown
  response:
    | { kind: 'message'; message: BetaMessage }
    | { kind: 'events'; events: unknown[] }
}

const DEFAULT_DIR = join(import.meta.dir, '..', 'cassettes')

let _installed = false

export function installCassetteAdapter(opts: CassetteOptions): void {
  const dir = opts.cassetteDir ?? DEFAULT_DIR
  mkdirSync(dir, { recursive: true })
  const cassettePath = join(dir, `${opts.workflow}.jsonl`)
  const mode = opts.mode ?? (process.env.AEGIS_RECORD === '1' ? 'record' : 'replay')

  __setAdapterInterceptorForTest((id, _client, resolveReal) => {
    const shim: ProviderAdapter = {
      id,
      displayName: `cassette<${id}>`,
      async dispatch(
        request: AdapterRequest,
        cfg: ProviderConfig,
        opts2?: AdapterRequestOptions,
      ): Promise<AdapterResponse> {
        const hash = requestHash(request)
        if (mode === 'replay') {
          const found = lookup(cassettePath, hash)
          if (!found) {
            throw new Error(
              `cassette miss for workflow=${opts.workflow}\n` +
                `  hash: ${hash}\n` +
                `  request: ${JSON.stringify(canonicalizeRequest(request))}\n` +
                `  re-record with: AEGIS_RECORD=1 bun test tests/integration/${opts.workflow}.test.ts`,
            )
          }
          if (found.response.kind === 'message') {
            return { kind: 'message', message: found.response.message }
          }
          return {
            kind: 'events',
            events: (async function* () {
              for (const e of found.response.events) yield e as any
            })(),
          }
        }
        const real = resolveReal()
        const r = await real.dispatch(request, cfg, opts2)
        const recorded: CassetteLine = {
          requestHash: hash,
          request: canonicalizeRequest(request),
          response: r.kind === 'message'
            ? { kind: 'message', message: r.message }
            : { kind: 'events', events: await drainEvents(r.events) },
        }
        // (P1 fix) Re-record overrides previous: drop existing lines that
        // share this requestHash before writing the new one. Otherwise the
        // committed synthetic cassettes would silently shadow live recordings
        // (`lookup` returned the first match) — appending a new live line
        // would have no replay effect.
        replaceCassetteLine(cassettePath, recorded)
        if (r.kind === 'message') return r
        return {
          kind: 'events',
          events: (async function* () {
            for (const e of (recorded.response as any).events) yield e
          })(),
        }
      },
    }
    return shim
  })
  _installed = true
}

export function uninstallCassetteAdapter(): void {
  if (!_installed) return
  __setAdapterInterceptorForTest(null)
  _installed = false
}

async function drainEvents(events: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const e of events) out.push(e)
  return out
}

function lookup(path: string, hash: string): CassetteLine | null {
  if (!existsSync(path)) return null
  // (P1 fix) Last-match-wins on replay. Defends against hand-edited cassettes
  // that may have drifted from the strict "one line per hash" invariant the
  // record path enforces; a stale line followed by a fresh recording should
  // never resolve to the stale one.
  let last: CassetteLine | null = null
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line) continue
    try {
      const c = JSON.parse(line) as CassetteLine
      if (c.requestHash === hash) last = c
    } catch {
      continue
    }
  }
  return last
}

/**
 * Atomically rewrite the cassette so any existing line with the same
 * `requestHash` is replaced by `next`. Lines for other hashes are
 * preserved in the original order. Truncating + writing in one shot
 * keeps cassettes lean across re-record runs.
 */
function replaceCassetteLine(path: string, next: CassetteLine): void {
  const out: string[] = []
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
      if (!line) continue
      try {
        const c = JSON.parse(line) as CassetteLine
        if (c.requestHash === next.requestHash) continue
        out.push(line)
      } catch {
        // Preserve unparseable lines verbatim — operator may be hand-editing.
        out.push(line)
      }
    }
  }
  out.push(JSON.stringify(next))
  writeFileSync(path, out.join('\n') + '\n')
}
