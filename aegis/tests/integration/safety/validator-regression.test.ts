import { test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

type Case = {
  name: string
  note: string
  patient_context: Record<string, unknown>
  template: Record<string, unknown> | null
  expected_check: string
}

const REPO_ROOT = (() => {
  let dir = import.meta.dir
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, '.git'))) return dir
    dir = join(dir, '..')
  }
  throw new Error('repo root not found from ' + import.meta.dir)
})()

// Use the venv python explicitly so `aegis_mcp` package is importable.
// The plan's snippet suggested `cmd: ['python3', '-c', ...]` with a relative
// cwd — that fails when the system python3 lacks the venv-installed package.
const VENV_PY = join(REPO_ROOT, 'aegis-mcp', '.venv', 'bin', 'python3')
const HAS_VENV = existsSync(VENV_PY)
const t = HAS_VENV ? test : test.skip

const cases = JSON.parse(
  readFileSync(
    join(import.meta.dir, '..', '..', 'fixtures', 'regression-cases-validator.json'),
    'utf-8',
  ),
) as Case[]

t.each(cases)('regression: $name', async c => {
  const warnings = await callPythonValidator(c.note, c.patient_context, c.template)
  expect(warnings.some(w => w.check === c.expected_check)).toBe(true)
})

async function callPythonValidator(
  note: string,
  ctx: Record<string, unknown>,
  template: Record<string, unknown> | null,
): Promise<Array<{ check: string; severity: string; message: string }>> {
  const payload = JSON.stringify({ note, patient_context: ctx, template })
  const script = `
import json, sys
from aegis_mcp.validator.orchestrator import validate
p = json.loads(sys.stdin.read())
print(json.dumps(validate(p["note"], p["patient_context"], template=p["template"])))
`
  const proc = Bun.spawnSync({
    cmd: [VENV_PY, '-c', script],
    stdin: new TextEncoder().encode(payload),
    cwd: join(REPO_ROOT, 'aegis-mcp'),
  })
  const out = new TextDecoder().decode(proc.stdout)
  if (proc.exitCode !== 0) {
    const err = new TextDecoder().decode(proc.stderr)
    throw new Error(`python validator exited ${proc.exitCode}: ${err}\nstdout: ${out}`)
  }
  return JSON.parse(out)
}
