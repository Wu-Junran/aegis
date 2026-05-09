// Minimal stand-in for `ink-testing-library` used only by null-render React
// component tests (e.g. tests/unit/runtime/medicalRuntimeBridge.test.tsx).
//
// We don't install the real `ink` + `ink-testing-library` packages into this
// fork's devDeps because:
//   1) the project ships a *vendored* ink under `src/ink/`, and
//   2) the published `ink` chain trips a `signal-exit` v3↔v4 ESM mismatch
//      under bun test (the hoisted top-level `signal-exit@3` (CJS) shadows
//      the v4 ESM with named `onExit` that ink + execa expect).
//
// Bridge-shaped components return `null`, so we don't need a host renderer —
// just react-reconciler with a noop host config so `useEffect`/`useRef` fire.
//
// API mirrors `ink-testing-library`'s `render(...)` so tests read like the
// upstream spec; only the import path differs.

import type { ReactNode } from 'react'
import ReactReconcilerImport from 'react-reconciler'
import { ConcurrentRoot } from 'react-reconciler/constants.js'

// react-reconciler is shipped as CJS; bun's ESM interop hands us either the
// function directly or an object with .default — handle both.
const ReactReconciler =
	(ReactReconcilerImport as unknown as { default?: typeof ReactReconcilerImport })
		.default ?? ReactReconcilerImport

const reconciler = (ReactReconciler as (config: unknown) => {
	createContainer: (...args: unknown[]) => unknown
	updateContainer: (
		element: ReactNode | null,
		container: unknown,
		parentComponent: unknown,
		callback: unknown,
	) => void
	updateContainerSync?: (
		element: ReactNode | null,
		container: unknown,
		parentComponent: unknown,
		callback: unknown,
	) => void
	flushSyncWork?: () => void
	flushPassiveEffects?: () => boolean
})({
	// Booleans / capabilities
	isPrimaryRenderer: true,
	supportsMutation: true,
	supportsPersistence: false,
	supportsHydration: false,

	// Host context
	getRootHostContext: () => null,
	getChildHostContext: () => null,

	// Commit phase
	prepareForCommit: () => null,
	resetAfterCommit: () => {},
	preparePortalMount: () => null,
	clearContainer: () => false,

	// Instance lifecycle (no real host — just stub objects)
	createInstance: () => ({}),
	createTextInstance: () => ({}),
	appendInitialChild: () => {},
	finalizeInitialChildren: () => false,
	shouldSetTextContent: () => false,
	getPublicInstance: (i: unknown) => i,

	// Mutation
	appendChild: () => {},
	appendChildToContainer: () => {},
	insertBefore: () => {},
	insertInContainerBefore: () => {},
	removeChild: () => {},
	removeChildFromContainer: () => {},
	commitMount: () => {},
	commitUpdate: () => {},
	commitTextUpdate: () => {},
	resetTextContent: () => {},
	hideInstance: () => {},
	hideTextInstance: () => {},
	unhideInstance: () => {},
	unhideTextInstance: () => {},
	detachDeletedInstance: () => {},

	// Timeouts / scheduling
	scheduleTimeout: setTimeout,
	cancelTimeout: clearTimeout,
	noTimeout: -1,
	supportsMicrotasks: true,
	scheduleMicrotask: queueMicrotask,
	now: () => Date.now(),

	// React 19 priority hooks (without these you get
	// `resolveUpdatePriority is not a function` at render time).
	getCurrentUpdatePriority: () => 0,
	setCurrentUpdatePriority: () => {},
	resolveUpdatePriority: () => 0,
	getCurrentEventPriority: () => 0,

	// React 19 suspense / transition hooks
	maySuspendCommit: () => false,
	preloadInstance: () => true,
	startSuspendingCommit: () => {},
	suspendInstance: () => {},
	waitForCommitToBeReady: () => null,
	NotPendingTransition: null,
	// React 19.x context internals — re-check on React upgrade. If the bridge
	// tests start failing after a React bump, this is the line to inspect.
	HostTransitionContext: {
		$$typeof: Symbol.for('react.context'),
		_currentValue: null,
	},
	resetFormInstance: () => {},
	requestPostPaintCallback: () => {},
	shouldAttemptEagerTransition: () => false,
	trackSchedulerEvent: () => {},
	resolveEventType: () => null,
	resolveEventTimeStamp: () => -1.1,

	// Misc
	beforeActiveInstanceBlur: () => {},
	afterActiveInstanceBlur: () => {},
	prepareScopeUpdate: () => {},
	getInstanceFromScope: () => null,
	getInstanceFromNode: () => null,
})

export type RenderHandle = {
	rerender: (node: ReactNode) => void
	unmount: () => void
	cleanup: () => void
}

function commit(
	node: ReactNode | null,
	container: unknown,
): void {
	if (typeof reconciler.updateContainerSync === 'function') {
		reconciler.updateContainerSync(node, container, null, null)
		reconciler.flushSyncWork?.()
	} else {
		reconciler.updateContainer(node, container, null, null)
	}
	// Drain useEffect (passive effects). Without this, the bridge's effect
	// won't run before the test inspects state.
	reconciler.flushPassiveEffects?.()
}

export function render(node: ReactNode): RenderHandle {
	const container = reconciler.createContainer(
		{},
		ConcurrentRoot,
		null,
		false,
		null,
		'',
		(error: unknown) => {
			// biome-ignore lint/suspicious/noConsole: surface render errors in tests
			console.error('[inkRenderShim] uncaught:', error)
		},
		null,
	)
	commit(node, container)
	return {
		rerender(next) {
			commit(next, container)
		},
		unmount() {
			commit(null, container)
		},
		cleanup() {
			commit(null, container)
		},
	}
}
