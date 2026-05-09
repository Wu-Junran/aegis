// AEGIS STUB — missing from codeaashu/claude-code leak (SHA 126c311). Throws on use. Replace with real implementation if the feature is needed.

const _handler = {
  get(_t: object, p: string | symbol) {
    throw new Error(`aegis: stubbed module accessed (.${String(p)}) — upstream leak gap (codeaashu/claude-code@126c311)`);
  },
};
const _stub = new Proxy({} as Record<string, unknown>, _handler) as any;

// deno-lint-ignore no-explicit-any
export const AnyZodRawShape: any = _stub;
// deno-lint-ignore no-explicit-any
export const ForkSessionOptions: any = _stub;
// deno-lint-ignore no-explicit-any
export const ForkSessionResult: any = _stub;
// deno-lint-ignore no-explicit-any
export const GetSessionInfoOptions: any = _stub;
// deno-lint-ignore no-explicit-any
export const GetSessionMessagesOptions: any = _stub;
// deno-lint-ignore no-explicit-any
export const InferShape: any = _stub;
// deno-lint-ignore no-explicit-any
export const InternalOptions: any = _stub;
// deno-lint-ignore no-explicit-any
export const InternalQuery: any = _stub;
// deno-lint-ignore no-explicit-any
export const ListSessionsOptions: any = _stub;
// deno-lint-ignore no-explicit-any
export const McpSdkServerConfigWithInstance: any = _stub;
// deno-lint-ignore no-explicit-any
export const Options: any = _stub;
// deno-lint-ignore no-explicit-any
export const Query: any = _stub;
// deno-lint-ignore no-explicit-any
export const SDKSession: any = _stub;
// deno-lint-ignore no-explicit-any
export const SDKSessionOptions: any = _stub;
// deno-lint-ignore no-explicit-any
export const SdkMcpToolDefinition: any = _stub;
// deno-lint-ignore no-explicit-any
export const SessionMessage: any = _stub;
// deno-lint-ignore no-explicit-any
export const SessionMutationOptions: any = _stub;
