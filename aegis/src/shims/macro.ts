// src/shims/macro.ts

// Read version from package.json at startup
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const pkgPath = resolve(dirname(__filename), '..', '..', 'package.json')
let version = '0.0.0-dev'
try {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  version = pkg.version || version
} catch {}

const MACRO_OBJ = {
  VERSION: version,
  BUILD_TIME: new Date().toISOString(),
  PACKAGE_URL: 'aegis',
  NATIVE_PACKAGE_URL: undefined,
  VERSION_CHANGELOG: '',
  FEEDBACK_CHANNEL: 'the Aegis repository issue tracker',
  ISSUES_EXPLAINER:
    'open an issue in the Aegis repository issue tracker',
}

// Install as global
;(globalThis as any).MACRO = MACRO_OBJ

export default MACRO_OBJ
