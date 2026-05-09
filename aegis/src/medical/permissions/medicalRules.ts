import type { AppState } from '../../state/AppStateStore.js'
import type { PermissionBehavior, ToolPermissionContext } from '../../types/permissions.js'
import { permissionRuleValueToString } from '../../utils/permissions/permissionRuleParser.js'
import { getPhiMode } from '../runtime/phiMode.js'

export type MedicalPermissionRule = {
	toolName: string
	behavior: PermissionBehavior
}

export function medicalPermissionRules(): MedicalPermissionRule[] {
	return [
		{ toolName: 'Bash', behavior: 'ask' },
		{ toolName: 'Write', behavior: 'ask' },
		{ toolName: 'WebFetch', behavior: 'deny' },
		{ toolName: 'mcp__aegis-mcp__fhir_query', behavior: 'allow' },
		{ toolName: 'mcp__aegis-mcp__deidentify', behavior: 'allow' },
		{ toolName: 'mcp__aegis-mcp__reidentify', behavior: 'allow' },
		{ toolName: 'mcp__aegis-mcp__list_templates', behavior: 'allow' },
		{ toolName: 'mcp__aegis-mcp__render_template', behavior: 'allow' },
		// fhir_load_bundle: command-tool only (filtered out by
		// applyAegisMcpToolFilters in src/services/mcp/client.ts).
	]
}

/**
 * Returns a NEW ToolPermissionContext with the spec §6.3 medical rules
 * merged into the `session` source of the appropriate behavior bucket.
 *
 * Idempotent — calling it on an already-medicalized context is a no-op.
 * Preserves rules from every other source (userSettings/projectSettings/etc).
 */
export function applyMedicalPermissionRules(ctx: ToolPermissionContext): ToolPermissionContext {
	const allow = new Set(ctx.alwaysAllowRules.session ?? [])
	const deny = new Set(ctx.alwaysDenyRules.session ?? [])
	const ask = new Set(ctx.alwaysAskRules.session ?? [])
	for (const r of medicalPermissionRules()) {
		const ruleString = permissionRuleValueToString({ toolName: r.toolName })
		if (r.behavior === 'allow') allow.add(ruleString)
		else if (r.behavior === 'deny') deny.add(ruleString)
		else ask.add(ruleString)
	}
	return {
		...ctx,
		alwaysAllowRules: { ...ctx.alwaysAllowRules, session: [...allow] },
		alwaysDenyRules: { ...ctx.alwaysDenyRules, session: [...deny] },
		alwaysAskRules: { ...ctx.alwaysAskRules, session: [...ask] },
	}
}

/**
 * The gate predicate consulted by every medical-rule installer. True iff
 * the active phi-mode is NOT `off`. Centralized so the React bridge
 * (REPL) and the headless `--print` path agree on the strict/research/off
 * decision. Spec §6.4 contract: off mode produces "pure Claude Code
 * behavior" — no medical rules installed.
 */
export function shouldInstallMedicalPermissionRules(): boolean {
	return getPhiMode() !== 'off'
}

/**
 * Idempotent installer for the AppState-updater setter shape (used by the
 * non-React `--print` / SDK headless path in `cli/print.ts`). Mirrors the
 * React bridge's behavior so the strict/research/off decision is consistent
 * across surfaces. Without this, the bridge was the only installer,
 * leaving headless strict/research sessions with vanilla permissions:
 * `WebFetch` ungated, `Bash`/`Write` not forced to ask, and
 * `isMedicalSessionActive()` only able to disable Bash sandbox auto-allow
 * AFTER an ask rule already exists (which it didn't).
 */
export function installMedicalPermissionRulesIfMedical(
	setState: (updater: (prev: AppState) => AppState) => void,
): void {
	if (!shouldInstallMedicalPermissionRules()) return
	setState((prev) => ({
		...prev,
		toolPermissionContext: applyMedicalPermissionRules(prev.toolPermissionContext),
	}))
}
