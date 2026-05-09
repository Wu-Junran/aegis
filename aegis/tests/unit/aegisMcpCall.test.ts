import { test, expect } from 'bun:test'
import { resolveAegisMcpClient } from '../../src/medical/adapters/aegisMcpCall.js'

test('resolveAegisMcpClient finds the aegis-mcp connection by name', () => {
	const connected = { name: 'aegis-mcp', type: 'connected' } as any
	const disconnected = { name: 'other', type: 'failed' } as any
	const clients = [disconnected, connected]
	expect(resolveAegisMcpClient(clients)).toBe(connected)
})

test('resolveAegisMcpClient throws when aegis-mcp is not connected', () => {
	const clients = [{ name: 'aegis-mcp', type: 'pending' } as any]
	expect(() => resolveAegisMcpClient(clients)).toThrow(/aegis-mcp/i)
})
