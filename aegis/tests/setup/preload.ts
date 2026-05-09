// Bun test preload:
//   1. Stacks the bun:bundle resolver shim (same as scripts/bun-plugin-shims.ts
//      in prod dev mode; duplicated here because Bun's [test] preload replaces
//      the top-level preload rather than extending it).
//   2. Clears USER_TYPE=ant so this fork's missing ant-only require() targets
//      (e.g. src/tools/REPLTool/REPLTool.js) don't trip bun's ESM loader.
//   3. Installs a minimal `MACRO` global. In dev/build the bundler inlines
//      `MACRO.VERSION` etc. (see scripts/dev.ts → src/shims/macro.ts and
//      scripts/build-bundle.ts define-replacements). Tests run unbundled, so
//      any code path that references MACRO.* (e.g. utils/http.getUserAgent
//      reached by SDK calls under test) blows up with "MACRO is not defined"
//      unless we plant it on globalThis first.
//
// The @opentelemetry/resources shim that used to live here was removed after
// package.json was bumped to OTel 2.x — `resourceFromAttributes` is now a
// real export of the installed package.

import { plugin } from 'bun'
import { resolve as resolvePath } from 'node:path'

// Must happen BEFORE any src/ module loads.
if (process.env.USER_TYPE === 'ant') {
	delete process.env.USER_TYPE
}

// Plant MACRO.* globals before any src/ module loads. Mirrors src/shims/macro.ts
// minus the package.json read (test code never asserts on the version string).
;(globalThis as { MACRO?: Record<string, string | undefined> }).MACRO ??= {
	VERSION: '0.0.0-test',
	BUILD_TIME: '1970-01-01T00:00:00.000Z',
	PACKAGE_URL: '@anthropic-ai/claude-code',
	NATIVE_PACKAGE_URL: undefined,
	VERSION_CHANGELOG: '',
	FEEDBACK_CHANNEL: 'test feedback channel',
	ISSUES_EXPLAINER: 'test stub',
}

const bunBundleShimPath = resolvePath(
	import.meta.dir,
	'../../src/shims/bun-bundle.ts',
)

plugin({
	name: 'aegis-test-bun-bundle-shim',
	setup(build) {
		build.onResolve({ filter: /^bun:bundle$/ }, () => ({
			path: bunBundleShimPath,
		}))
	},
})
