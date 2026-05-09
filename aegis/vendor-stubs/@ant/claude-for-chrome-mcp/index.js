// AEGIS STUB — @ant/claude-for-chrome-mcp not available on public npm.
// Safe no-op shapes so the CLI boots; throws only on actual use.

function _notImplemented(name) {
  return function () {
    throw new Error(
      'aegis: stubbed @ant/claude-for-chrome-mcp.' + name + '() called — Anthropic-internal package not available'
    );
  };
}

// Used by setup.ts and claudeInChrome.ts — must be iterable, not a Proxy
export const BROWSER_TOOLS = [];

// Used by mcpServer.ts — throws on actual invocation, not on import/map
export const createClaudeForChromeMcpServer = _notImplemented('createClaudeForChromeMcpServer');

export default {
  BROWSER_TOOLS,
  createClaudeForChromeMcpServer,
};
