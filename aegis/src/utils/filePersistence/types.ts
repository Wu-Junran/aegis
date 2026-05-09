// AEGIS STUB — missing from codeaashu/claude-code leak (SHA 126c311). Throws on use. Replace with real implementation if the feature is needed.

const _handler = {
  get(_t: object, p: string | symbol) {
    throw new Error(`aegis: stubbed module accessed (.${String(p)}) — upstream leak gap (codeaashu/claude-code@126c311)`);
  },
};
const _stub = new Proxy({} as Record<string, unknown>, _handler) as any;

// deno-lint-ignore no-explicit-any
export const DEFAULT_UPLOAD_CONCURRENCY: any = _stub;
// deno-lint-ignore no-explicit-any
export const FailedPersistence: any = _stub;
// deno-lint-ignore no-explicit-any
export const FILE_COUNT_LIMIT: any = _stub;
// deno-lint-ignore no-explicit-any
export const FilesPersistedEventData: any = _stub;
// deno-lint-ignore no-explicit-any
export const OUTPUTS_SUBDIR: any = _stub;
// deno-lint-ignore no-explicit-any
export const PersistedFile: any = _stub;
// deno-lint-ignore no-explicit-any
export const TurnStartTime: any = _stub;
