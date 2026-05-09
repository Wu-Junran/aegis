// AEGIS STUB — missing from codeaashu/claude-code leak (SHA 126c311). Throws on use. Replace with real implementation if the feature is needed.

const _handler = {
  get(_t: object, p: string | symbol) {
    throw new Error(`aegis: stubbed module accessed (.${String(p)}) — upstream leak gap (codeaashu/claude-code@126c311)`);
  },
};
const _stub = new Proxy({} as Record<string, unknown>, _handler) as any;

// deno-lint-ignore no-explicit-any
export const ComputerExecutor: any = _stub;
// deno-lint-ignore no-explicit-any
export const DisplayGeometry: any = _stub;
// deno-lint-ignore no-explicit-any
export const FrontmostApp: any = _stub;
// deno-lint-ignore no-explicit-any
export const InstalledApp: any = _stub;
// deno-lint-ignore no-explicit-any
export const ResolvePrepareCaptureResult: any = _stub;
// deno-lint-ignore no-explicit-any
export const RunningApp: any = _stub;
// deno-lint-ignore no-explicit-any
export const ScreenshotResult: any = _stub;
// deno-lint-ignore no-explicit-any
export const API_RESIZE_PARAMS: any = _stub;
// deno-lint-ignore no-explicit-any
export const targetImageSize: any = _stub;
// deno-lint-ignore no-explicit-any
export const buildComputerUseTools: any = _stub;
// deno-lint-ignore no-explicit-any
export const createComputerUseMcpServer: any = _stub;
// deno-lint-ignore no-explicit-any
export const bindSessionContext: any = _stub;
// deno-lint-ignore no-explicit-any
export const ComputerUseSessionContext: any = _stub;
// deno-lint-ignore no-explicit-any
export const CuCallToolResult: any = _stub;
// deno-lint-ignore no-explicit-any
export const CuPermissionRequest: any = _stub;
// deno-lint-ignore no-explicit-any
export const CuPermissionResponse: any = _stub;
// deno-lint-ignore no-explicit-any
export const DEFAULT_GRANT_FLAGS: any = _stub;
// deno-lint-ignore no-explicit-any
export const ScreenshotDims: any = _stub;
