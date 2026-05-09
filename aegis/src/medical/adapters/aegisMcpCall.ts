import type { ConnectedMCPServer, MCPServerConnection } from '../../services/mcp/types.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { CallMcpTool } from './fhirAdapter.js'

export const AEGIS_MCP_SERVER_NAME = 'aegis-mcp'

export function resolveAegisMcpClient(clients: readonly MCPServerConnection[]): ConnectedMCPServer {
	const match = clients.find((c) => c.name === AEGIS_MCP_SERVER_NAME)
	if (!match || match.type !== 'connected') {
		throw new Error(
			`aegis-mcp server is not connected (type=${
				match?.type ?? 'missing'
			}). Check scripts/generate-mcp-config.sh and restart Aegis.`,
		)
	}
	return match
}

/**
 * Build a CallMcpTool bound to the connected aegis-mcp client.
 *
 * Signature matches the exported helper in src/services/mcp/client.ts:
 *   callMCPToolWithUrlElicitationRetry({
 *     client: ConnectedMCPServer,
 *     clientConnection: MCPServerConnection,   // same object; used by elicitation retry
 *     tool, args, signal,
 *     setAppState: (updater) => void,          // needed if the server triggers URL elicitation
 *   })
 *
 * We pass the connected server for both `client` and `clientConnection` — they
 * are the same object at runtime; the type split is purely for narrowing.
 */
export function buildAegisMcpCallTool(args: {
	clients: readonly MCPServerConnection[]
	setAppState: (updater: (prev: AppState) => AppState) => void
}): CallMcpTool {
	const server = resolveAegisMcpClient(args.clients)
	return async (name: string, toolArgs: Record<string, unknown>) => {
		// Lazy-import avoids a circular dep with mcp/client.ts at module init.
		const { callMCPToolWithUrlElicitationRetry } = await import('../../services/mcp/client.js')
		const { content } = await callMCPToolWithUrlElicitationRetry({
			client: server,
			clientConnection: server,
			tool: name,
			args: toolArgs,
			signal: new AbortController().signal,
			setAppState: args.setAppState,
		})
		if (typeof content === 'string') return content
		const text = Array.isArray(content)
			? content
					.filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
					.map((b: any) => b.text)
					.join('')
			: ''
		if (!text) throw new Error(`aegis-mcp tool ${name} returned no text content`)
		return text
	}
}
