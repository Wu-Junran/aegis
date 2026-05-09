import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { buildAegisMcpCallTool } from '../../medical/adapters/aegisMcpCall.js'
import { createTemplateRegistry } from '../../medical/templates/templateRegistry.js'
import type { TemplateRegistry } from '../../medical/templates/templateRegistry.js'
import { useAppStateStore } from '../../state/AppState.js'
import type { AppState, AppStateStore } from '../../state/AppStateStore.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

export type Subcommand = 'list' | 'set' | 'show'

type OnDone = (
	result?: string,
	options?: { display?: 'system' | 'user' },
) => void

type Props = {
	subcommand: Subcommand
	arg: string
	onDone: OnDone
}

/**
 * Pure, testable body of the /template command.
 *
 * The `buildRegistry` factory is injected so tests can feed in a stub;
 * production code passes a closure that resolves the aegis-mcp client and
 * wraps it in `createTemplateRegistry`. Registry construction is deferred
 * until a branch actually needs MCP (i.e., NOT `show` and NOT `set` with
 * no id) so the read-only branches never trip `aegis-mcp not connected`.
 */
export async function handleTemplateCommand(deps: {
	subcommand: Subcommand
	arg: string
	store: Pick<AppStateStore, 'getState' | 'setState'>
	buildRegistry: () => TemplateRegistry
	onDone: OnDone
	isCancelled?: () => boolean
}): Promise<void> {
	const { subcommand, arg, store, buildRegistry, onDone, isCancelled } = deps
	const cancelled = () => isCancelled?.() === true
	try {
		if (subcommand === 'show') {
			const t = store.getState().currentTemplate
			if (!t) {
				onDone('No template set.', { display: 'system' })
				return
			}
			const sectionLines = t.sections.map(
				s =>
					`  - ${s.title} (${s.id})${
						s.promptGuidance ? ` — ${s.promptGuidance}` : ''
					}`,
			)
			onDone(
				[`${t.id} — ${t.name}`, 'Sections:', ...sectionLines].join(
					'\n',
				),
				{ display: 'system' },
			)
			return
		}
		if (subcommand === 'set' && !arg) {
			onDone('Usage: /template set <id>', { display: 'system' })
			return
		}

		// list / set <id> — both need the MCP registry.
		const reg = buildRegistry()

		if (subcommand === 'list') {
			const all = await reg.listTemplates()
			if (cancelled()) return
			onDone(
				all.map(t => `  ${t.id}  — ${t.name}`).join('\n') ||
					'No templates.',
				{ display: 'system' },
			)
			return
		}
		// set <id>
		const t = await reg.getTemplate(arg)
		if (cancelled()) return
		store.setState((s: AppState) => ({ ...s, currentTemplate: t }))
		onDone(`Template set to ${t.id} (${t.name}).`, { display: 'system' })
	} catch (err) {
		if (cancelled()) return
		onDone(`Error: ${(err as Error).message}`, { display: 'system' })
	}
}

function TemplateCommand({
	subcommand,
	arg,
	onDone,
}: Props): React.ReactNode {
	const store = useAppStateStore()

	React.useEffect(() => {
		let cancelled = false
		void handleTemplateCommand({
			subcommand,
			arg,
			store,
			buildRegistry: () => {
				const callTool = buildAegisMcpCallTool({
					clients: store.getState().mcp.clients,
					setAppState: store.setState,
				})
				return createTemplateRegistry({ callTool })
			},
			onDone,
			isCancelled: () => cancelled,
		})
		return () => {
			cancelled = true
		}
	}, [subcommand, arg, store, onDone])

	return (
		<Box>
			<Text>{subcommand === 'set' ? 'Setting template…' : ''}</Text>
		</Box>
	)
}

export const call: LocalJSXCommandCall = async (onDone, _ctx, rawArgs) => {
	const [sub = 'show', ...rest] = rawArgs.trim().split(/\s+/)
	const subcommand: Subcommand =
		sub === 'list' || sub === 'set' || sub === 'show' ? sub : 'show'
	return (
		<TemplateCommand
			subcommand={subcommand}
			arg={rest.join(' ')}
			onDone={onDone}
		/>
	)
}
