// scripts/package-npm.ts
// Generate an npm package inspection directory in dist/npm/
//
// Usage: bun scripts/package-npm.ts
//
// Prerequisites: run `bun run build:prod` first to generate dist/cli.mjs

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, chmodSync, cpSync } from 'fs'
import { resolve } from 'path'

// Bun: import.meta.dir — Node 21+: import.meta.dirname — fallback
const __dir: string =
  (import.meta as ImportMeta & { dir?: string; dirname?: string }).dir ??
  (import.meta as ImportMeta & { dir?: string; dirname?: string }).dirname ??
  new URL('.', import.meta.url).pathname

const ROOT = resolve(__dir, '..')
const DIST = resolve(ROOT, 'dist')
const NPM_DIR = resolve(DIST, 'npm')
const CLI_BUNDLE = resolve(DIST, 'cli.mjs')

function main() {
  // Verify the bundle exists
  if (!existsSync(CLI_BUNDLE)) {
    console.error('Error: dist/cli.mjs not found. Run `bun run build:prod` first.')
    process.exit(1)
  }

  // Read source package.json
  const srcPkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'))

  // Create npm output directory
  mkdirSync(NPM_DIR, { recursive: true })

  // Copy the bundled CLI
  copyFileSync(CLI_BUNDLE, resolve(NPM_DIR, 'cli.mjs'))
  chmodSync(resolve(NPM_DIR, 'cli.mjs'), 0o755)

  // Source maps stay in dist/ for development debugging but are NOT shipped
  // in the npm tarball — end users do not need them and they roughly double
  // the download size. Pass --include-sourcemap to ship them anyway (e.g.
  // for a debug release).
  const includeSourcemap = process.argv.includes('--include-sourcemap')
  const sourceMap = resolve(DIST, 'cli.mjs.map')
  if (includeSourcemap && existsSync(sourceMap)) {
    copyFileSync(sourceMap, resolve(NPM_DIR, 'cli.mjs.map'))
  }

  // Generate an npm package.json. The source package is normally
  // public-domain (Unlicense) and not marked private, so the generated
  // package is publishable. The release-block path stays here for the
  // case where someone temporarily flips the source back to private/
  // UNLICENSED for an inspection-only build.
  const sourceLicense = srcPkg.license || 'UNLICENSED'
  const releaseBlocked = srcPkg.private === true || sourceLicense === 'UNLICENSED'

  // Bundle-local stubs for packages that have no public-npm publication.
  // build-bundle.ts marks `@ant/*` and `image-processor-napi` as external so
  // esbuild leaves the imports untouched in the bundle. The runtime resolver
  // therefore needs a copy of each stub at install time. We ship the stubs
  // inside the npm tarball under `vendor-stubs/` and reference them via
  // `file:` so npm symlinks them into the install-tree's node_modules.
  const VENDOR_SRC = resolve(ROOT, 'vendor-stubs')
  const VENDOR_DST = resolve(NPM_DIR, 'vendor-stubs')
  const vendorStubs = [
    '@ant/claude-for-chrome-mcp',
    '@ant/computer-use-mcp',
    'image-processor-napi',
  ]
  for (const stub of vendorStubs) {
    const src = resolve(VENDOR_SRC, stub)
    const dst = resolve(VENDOR_DST, stub)
    if (existsSync(src)) {
      cpSync(src, dst, { recursive: true })
    } else {
      console.warn(`  warning: vendor-stub ${stub} missing at ${src}`)
    }
  }

  const files = [
    'cli.mjs',
    'README.md',
    'vendor-stubs/',
  ]
  if (includeSourcemap) files.splice(1, 0, 'cli.mjs.map')
  const repoLicense = resolve(ROOT, '..', 'LICENSE.md')
  if (existsSync(repoLicense)) files.push('LICENSE.md')

  // Runtime dependencies of the bundle.
  //
  // build-bundle.ts marks several packages as `external` so esbuild does not
  // try to bundle them. For an end-user `npm install -g aegis` to work, the
  // public-npm ones need to be declared as dependencies; vendor-stubbed ones
  // ship in the tarball and are referenced via `file:`. Anthropic-internal
  // packages (e.g. `@anthropic-ai/sandbox-runtime`, `@ant/computer-use-input`,
  // `@ant/computer-use-swift`) are not published; their code paths are gated
  // behind `USER_TYPE === 'ant'` which the bundle hardcodes to `"external"`,
  // so they are dead code for end-user installs and are intentionally omitted.
  const requiredRuntimeDeps: Record<string, string> = {
    // Public npm — eagerly imported at module-load on the user-facing path.
    'node-fetch': '^3.3.2',
    'agentkeepalive': '^4.5.0',
    'commander': '^12.1.0',
    '@commander-js/extra-typings': '^12.1.0',
    'cross-spawn': '^7.0.6',
    '@alcalzone/ansi-tokenize': '^0.3.0',
    '@anthropic-ai/sandbox-runtime': '^0.0.50',
    '@anthropic-ai/claude-agent-sdk': '^0.2.138',
    '@anthropic-ai/bedrock-sdk': '^0.29.1',
    '@anthropic-ai/foundry-sdk': '^0.2.3',
    '@anthropic-ai/mcpb': '^2.1.2',
    '@anthropic-ai/vertex-sdk': '^0.16.0',
    // Vendor-stubbed — shipped inside the tarball under vendor-stubs/.
    '@ant/claude-for-chrome-mcp': 'file:./vendor-stubs/@ant/claude-for-chrome-mcp',
    '@ant/computer-use-mcp': 'file:./vendor-stubs/@ant/computer-use-mcp',
    'image-processor-napi': 'file:./vendor-stubs/image-processor-napi',
  }
  const optionalRuntimeDeps: Record<string, string> = {
    // OS keychain — credentials gracefully fall back to env vars when absent.
    'keytar': '^7.9.0',
    // Cloud SDKs / OTLP exporters — only loaded when the user opts into a
    // matching provider or telemetry exporter. Marked optional so `npm install`
    // never fails on a user who doesn't need them.
    '@aws-sdk/client-bedrock-runtime': '*',
    '@aws-sdk/client-bedrock': '*',
    '@aws-sdk/client-sts': '*',
    '@aws-sdk/credential-provider-node': '*',
    '@aws-sdk/credential-providers': '*',
    '@azure/identity': '*',
    '@smithy/core': '*',
    '@smithy/node-http-handler': '*',
    '@opentelemetry/exporter-trace-otlp-http': '*',
    '@opentelemetry/exporter-trace-otlp-grpc': '*',
    '@opentelemetry/exporter-trace-otlp-proto': '*',
    '@opentelemetry/exporter-metrics-otlp-http': '*',
    '@opentelemetry/exporter-metrics-otlp-grpc': '*',
    '@opentelemetry/exporter-metrics-otlp-proto': '*',
    '@opentelemetry/exporter-logs-otlp-http': '*',
    '@opentelemetry/exporter-logs-otlp-grpc': '*',
    '@opentelemetry/exporter-logs-otlp-proto': '*',
    '@opentelemetry/exporter-prometheus': '*',
    // Native optional perf addons used by ws / image processing.
    'sharp': '*',
    'bufferutil': '*',
    'utf-8-validate': '*',
  }

  const npmPkg = {
    name: srcPkg.name || 'aegis',
    version: srcPkg.version || '0.0.0',
    description: srcPkg.description || 'Aegis clinical documentation agent',
    license: sourceLicense,
    ...(releaseBlocked ? { private: true } : {}),
    type: 'module',
    main: './cli.mjs',
    bin: {
      aegis: './cli.mjs',
    },
    engines: {
      node: '>=20.0.0',
    },
    os: ['darwin', 'linux', 'win32'],
    files,
    dependencies: requiredRuntimeDeps,
    optionalDependencies: optionalRuntimeDeps,
  }

  writeFileSync(
    resolve(NPM_DIR, 'package.json'),
    JSON.stringify(npmPkg, null, 2) + '\n',
  )

  // Copy README if it exists
  const readme = resolve(ROOT, 'README.md')
  if (existsSync(readme)) {
    copyFileSync(readme, resolve(NPM_DIR, 'README.md'))
  }
  if (existsSync(repoLicense)) {
    copyFileSync(repoLicense, resolve(NPM_DIR, 'LICENSE.md'))
  }

  // Summary
  const bundleSize = readFileSync(CLI_BUNDLE).byteLength
  const sizeMB = (bundleSize / 1024 / 1024).toFixed(2)

  console.log('npm package generated in dist/npm/')
  console.log(`  package:  ${npmPkg.name}@${npmPkg.version}`)
  console.log(`  bundle:   cli.mjs (${sizeMB} MB)`)
  console.log('  bin:      aegis -> ./cli.mjs')
  console.log('')
  if (releaseBlocked) {
    console.log('Publish gate:')
    console.log('  Source package is private and/or UNLICENSED.')
    console.log('  Use this package for inspection only until release metadata is intentionally changed.')
  } else {
    console.log('To publish:')
    console.log('  cd dist/npm && npm publish')
  }
}

main()
