import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function aegisMcpBinPath(): string {
  const root = process.env.AEGIS_REPO_ROOT ?? findRepoRoot(import.meta.dir)
  return join(root, 'aegis-mcp', '.venv', 'bin', 'aegis-mcp')
}

let _client: Promise<Client> | null = null

export async function sharedMcpClient(): Promise<Client> {
  if (_client) return _client
  const bin = aegisMcpBinPath()
  if (!existsSync(bin)) {
    throw new MissingMcpBinError(
      `aegis-mcp binary not found at ${bin}. Bring up the venv first:\n` +
        '  cd aegis-mcp && python3.11 -m venv .venv && .venv/bin/pip install -e ".[dev]"',
    )
  }
  _client = (async () => {
    const transport = new StdioClientTransport({ command: bin, args: [] })
    const client = new Client(
      { name: 'aegis-test-harness', version: '0.0.0' },
      { capabilities: {} },
    )
    await client.connect(transport)
    return client
  })()
  return _client
}

export async function closeSharedMcpClient(): Promise<void> {
  if (!_client) return
  try { await (await _client).close() } catch { /* best-effort */ }
  _client = null
}

export class MissingMcpBinError extends Error {
  constructor(message: string) { super(message); this.name = 'MissingMcpBinError' }
}

function findRepoRoot(start: string): string {
  let dir = start
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = join(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`could not find repo root from ${start}`)
}
