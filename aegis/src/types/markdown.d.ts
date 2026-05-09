// AEGIS STUB — missing from codeaashu/claude-code leak (SHA 126c311). Throws on use. Replace with real implementation if the feature is needed.
// Declare .md files as importable text modules (Bun text loader / esbuild text loader)
declare module '*.md' {
  const content: string
  export default content
}

// Declare Bun built-in modules for TypeScript (resolved by Bun runtime, not bundled by esbuild)
declare module 'bun:ffi' {
  const value: unknown
  export default value
  export const dlopen: unknown
  export const FFIType: unknown
  export const JSCallback: unknown
  export const Callback: unknown
  export const read: unknown
  export const toBuffer: unknown
  export const toArrayBuffer: unknown
  export const ptr: unknown
  export const viewSource: unknown
  export const CString: unknown
  export const suffix: unknown
}
