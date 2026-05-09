// Local ambient module declaration for the OPTIONAL `keytar` dependency.
// Runtime: `credentials.ts` does `await import('keytar')` inside a try/
// catch — if the native module is missing (no build tools, sandboxed CI,
// or a deliberately stripped install), the catch falls through to env-
// only auth. This declaration ensures the literal import string still
// typechecks without `keytar` present in node_modules. Keep it tightly
// scoped to the three methods we actually call (`loadCredential` /
// `saveCredential` / `clearCredential`) so adding new keytar APIs would
// surface here as a missing-prop error instead of leaking through.
declare module 'keytar' {
	export function getPassword(service: string, account: string): Promise<string | null>
	export function setPassword(service: string, account: string, password: string): Promise<void>
	export function deletePassword(service: string, account: string): Promise<boolean>
}
