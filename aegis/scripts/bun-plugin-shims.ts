// scripts/bun-plugin-shims.ts
// Bun preload plugin — intercepts `bun:bundle` imports at runtime
// and resolves them to our local shim so the CLI can run without
// the production Bun bundler pass.
//
// Also registers a text loader for `.md` / `.txt` imports so source-mode
// runs (`bun src/entrypoints/cli.tsx`) match the production esbuild build,
// which has `loader: { '.md': 'text', '.txt': 'text' }` configured.
// `src/skills/bundled/*Content.ts` modules `import skillMd from './x.md'`
// expecting the file's contents as a default string export — without this
// loader Bun parses the markdown as JS and fails with
// `SyntaxError: Missing 'default' export in module '.../SKILL.md'`.

import { plugin } from 'bun'
import { resolve, dirname } from 'path'
import { readFileSync } from 'fs'
import { readFile as readFileAsync } from 'fs/promises'
import { fileURLToPath } from 'url'

// `MACRO.*` and `process.env.USER_TYPE` are replaced at build time by
// esbuild's `define:` map (see scripts/build-bundle.ts). Source-mode runs
// (`bun src/entrypoints/cli.tsx`) bypass that pass, so cli.tsx hits a
// `ReferenceError: MACRO is not defined` on the `--version` path. Install
// the same constants as a global at preload time so source-mode behaves
// identically to the bundled build.
const __pluginDir = dirname(fileURLToPath(import.meta.url))
const __rootDir = resolve(__pluginDir, '..')
const __pkg = JSON.parse(
  readFileSync(resolve(__rootDir, 'package.json'), 'utf8'),
) as { version?: string }

;(globalThis as unknown as {
  MACRO?: Record<string, string | undefined>
}).MACRO ??= {
  VERSION: __pkg.version ?? '0.0.0-dev',
  BUILD_TIME: new Date().toISOString(),
  PACKAGE_URL: 'aegis',
  NATIVE_PACKAGE_URL: undefined,
  VERSION_CHANGELOG: '',
  FEEDBACK_CHANNEL: 'the Aegis repository issue tracker',
  ISSUES_EXPLAINER:
    'open an issue in the Aegis repository issue tracker',
}
// Match the build's `process.env.USER_TYPE = "external"` replacement.
// Source-mode tests/runs that branch on `USER_TYPE === 'ant'` (Anthropic-
// internal) MUST take the public path, same as a bundled binary.
if (process.env.USER_TYPE === undefined) {
  process.env.USER_TYPE = 'external'
}

plugin({
  name: 'bun-bundle-shim',
  setup(build) {
    const shimPath = resolve(import.meta.dir, '../src/shims/bun-bundle.ts')

    build.onResolve({ filter: /^bun:bundle$/ }, () => ({
      path: shimPath,
    }))

    // Match the build's text loader for documentation/skill assets.
    // Bun plugins have no `'text'` loader (valid: js, jsx, ts, tsx, json,
    // toml, yaml, object, md), so we synthesize a JS module that
    // re-exports the file's UTF-8 contents as the default string.
    // Result is identical to esbuild's `loader: { '.md': 'text' }` —
    // `import md from './x.md'` gives the file contents as a string.
    build.onLoad({ filter: /\.(md|txt)$/ }, async (args) => ({
      contents: `export default ${JSON.stringify(
        await readFileAsync(args.path, 'utf8'),
      )};`,
      loader: 'js',
    }))
  },
})
