// AEGIS STUB — @ant/computer-use-mcp/sentinelApps is Anthropic-internal, not on npm. Throws on use.
const _handler = {
  get(_t, p) {
    throw new Error(`aegis: stubbed module @ant/computer-use-mcp/sentinelApps (.${String(p)}) accessed — Anthropic-internal package not available`);
  },
};
const _stub = new Proxy({}, _handler);

export default _stub;
export const getSentinelCategory = _stub;
