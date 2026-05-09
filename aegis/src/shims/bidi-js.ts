// AEGIS STUB — missing from codeaashu/claude-code leak (SHA 126c311). Throws on use. Replace with real implementation if the feature is needed.

const _handler = {
  get(_t: object, p: string | symbol) {
    throw new Error(`aegis: stubbed module accessed (.${String(p)}) — upstream leak gap (codeaashu/claude-code@126c311)`);
  },
};
const _stub = new Proxy({} as Record<string, unknown>, _handler) as any;

export default _stub;
