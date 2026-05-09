// AEGIS STUB — @ant/computer-use-mcp is Anthropic-internal, not on npm. Throws on use.
const _handler = {
  get(_t, p) {
    throw new Error(`aegis: stubbed module @ant/computer-use-mcp (.${String(p)}) accessed — Anthropic-internal package not available`);
  },
};
const _stub = new Proxy({}, _handler);

export default _stub;
export const API_RESIZE_PARAMS = _stub;
export const targetImageSize = _stub;
export const buildComputerUseTools = _stub;
export const createComputerUseMcpServer = _stub;
export const bindSessionContext = _stub;
export const DEFAULT_GRANT_FLAGS = _stub;
