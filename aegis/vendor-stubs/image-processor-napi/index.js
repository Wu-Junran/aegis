// AEGIS STUB — missing from codeaashu/claude-code leak (SHA 126c311). Throws on use.
const _handler = {
  get(_t, p) {
    throw new Error(`aegis: stubbed npm module accessed (.${String(p)}) — upstream leak gap`);
  },
};
const _stub = new Proxy({}, _handler);
export default _stub;

