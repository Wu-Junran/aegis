import * as React from 'react'
import type { ToolPermissionContext } from '../../types/permissions.js'
import { applyMedicalPermissionRules, shouldInstallMedicalPermissionRules } from './medicalRules.js'

export function MedicalPermissionsBridge({
	toolPermissionContext,
	setToolPermissionContext,
}: {
	toolPermissionContext: ToolPermissionContext
	setToolPermissionContext: (next: ToolPermissionContext) => void
}): null {
	// One-shot: install medical rules at REPL mount. The merge is idempotent
	// so re-mounts (e.g., during HMR) do not duplicate.
	const installed = React.useRef(false)
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional one-shot install — deps are captured once at mount
	React.useEffect(() => {
		if (installed.current) return
		installed.current = true
		// [M4 P1] phi-mode=off contracts to "pure Claude Code behavior" (spec
		// §6.4). The `shouldInstallMedicalPermissionRules()` predicate is the
		// shared source of truth for the strict/research/off decision; the
		// headless `--print` path in `cli/print.ts` consults the same gate via
		// `installMedicalPermissionRulesIfMedical`, so REPL and headless agree.
		// Installing the medical rules in off mode would still deny WebFetch
		// and force Bash/Write asks — contradicting that contract.
		if (!shouldInstallMedicalPermissionRules()) {
			return
		}
		setToolPermissionContext(applyMedicalPermissionRules(toolPermissionContext))
		// eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot install
	}, [])
	return null
}
