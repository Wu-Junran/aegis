// AEGIS STUB — missing from codeaashu/claude-code leak (SHA 126c311). Throws on use. Replace with real implementation if the feature is needed.

const _handler = {
  get(_t, p) {
    throw new Error(`aegis: stubbed npm module accessed (.${String(p)}) — upstream leak gap (codeaashu/claude-code@126c311)`);
  },
};
const _stub = new Proxy({}, _handler);

export default _stub;
export const start = _stub;
export const stop = _stub;
export const capture = _stub;
export const prewarm = _stub;
