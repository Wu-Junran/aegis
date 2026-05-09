// AEGIS STUB — missing from codeaashu/claude-code leak (SHA 126c311). Throws on use. Replace with real implementation if the feature is needed.

const _handler = {
  get(_t: object, p: string | symbol) {
    throw new Error(`aegis: stubbed module accessed (.${String(p)}) — upstream leak gap (codeaashu/claude-code@126c311)`);
  },
};
const _stub = new Proxy({} as Record<string, unknown>, _handler) as any;

// deno-lint-ignore no-explicit-any
export const FsReadRestrictionConfig: any = _stub;
// deno-lint-ignore no-explicit-any
export const FsWriteRestrictionConfig: any = _stub;
// deno-lint-ignore no-explicit-any
export const IgnoreViolationsConfig: any = _stub;
// deno-lint-ignore no-explicit-any
export const NetworkHostPattern: any = _stub;
// deno-lint-ignore no-explicit-any
export const NetworkRestrictionConfig: any = _stub;
// deno-lint-ignore no-explicit-any
export const SandboxAskCallback: any = _stub;
// deno-lint-ignore no-explicit-any
export const SandboxDependencyCheck: any = _stub;
// deno-lint-ignore no-explicit-any
export const SandboxRuntimeConfig: any = _stub;
// deno-lint-ignore no-explicit-any
export const SandboxViolationEvent: any = _stub;
// deno-lint-ignore no-explicit-any
export const SandboxManager: any = _stub;
// deno-lint-ignore no-explicit-any
export const SandboxRuntimeConfigSchema: any = _stub;
// deno-lint-ignore no-explicit-any
export const SandboxViolationStore: any = _stub;
