import { createHash } from 'node:crypto'

const STRIPPED_TOP_LEVEL = new Set(['metadata'])

export function canonicalizeRequest(req: unknown): unknown {
  return walk(req, /*depth=*/ 0)
}

function walk(v: unknown, depth: number): unknown {
  if (Array.isArray(v)) return v.map(x => walk(x, depth + 1))
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    const obj = v as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    for (const k of keys) {
      if (depth === 0 && STRIPPED_TOP_LEVEL.has(k)) continue
      // Drop tools[*].cache_control entries (cache hints don't change semantics).
      if (k === 'cache_control' && depth >= 2) continue
      out[k] = walk(obj[k], depth + 1)
    }
    return out
  }
  if (typeof v === 'string') return v.replace(/\s+/g, ' ').trim()
  return v
}

export function requestHash(req: unknown): string {
  const c = canonicalizeRequest(req)
  return `sha256:${createHash('sha256').update(JSON.stringify(c)).digest('hex')}`
}
