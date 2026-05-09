/**
 * A testing shim that mirrors `ink-testing-library`'s `render(...)` API but
 * uses the *vendored* Ink (`src/ink/root.ts`) rather than the published `ink`
 * package.  The published package is unavailable here: it pulls in
 * `signal-exit@4` (ESM, named export `onExit`) while bun's hoisted
 * `signal-exit@3` (CJS) shadows it, producing:
 *
 *   SyntaxError: Export named 'onExit' not found in module 'signal-exit/index.js'
 *
 * This shim replicates the `ink-testing-library@4` source
 * (node_modules/ink-testing-library/build/index.js) verbatim except the
 * single `import { render as inkRender } from 'ink'` line is replaced with
 * the vendored equivalent.  All other logic (Stdout / Stdin / Stderr mock
 * classes) is identical.
 *
 * Additionally, this shim flushes the React reconciler (via
 * `reconciler.flushSyncWork()`) after each stdin.write so that
 * `lastFrame()` can be called synchronously immediately after — the same
 * contract that `ink-testing-library` + published ink's `debug:true` mode
 * provides.
 *
 * Suitable for components that use `useInput` (requires stdin event
 * delivery) and render text (requires lastFrame). NOT needed for null-
 * returning bridge components — use `inkRenderShim.ts` for those.
 */
import { EventEmitter } from 'node:events'
import type { ReactNode } from 'react'
import { renderSync } from '../../src/ink/root.js'
// The vendored reconciler exposes flushSyncWork (not in @types/react-reconciler).
import reconciler from '../../src/ink/reconciler.js'

class Stdout extends EventEmitter {
	get columns() {
		return 100
	}
	frames: string[] = []
	_lastFrame: string | undefined
	// The last frame that contains actual rendered content (not pure terminal
	// escape sequences). When a component uses `useInput`, React layout effects
	// fire after the initial render and write terminal setup sequences (bracketed
	// paste, focus events, extended keys) which overwrite `_lastFrame`. These
	// pure-escape writes must not shadow the component's render output.
	// A "render frame" is identified by containing at least one non-ANSI char:
	// if `strip-ansi` stripped the frame and the result is non-empty, it's a
	// render frame. Terminal setup frames strip to empty strings.
	_lastRenderFrame: string | undefined
	write = (frame: string) => {
		this.frames.push(frame)
		this._lastFrame = frame
		// Strip ANSI escape sequences to detect if this is a content frame.
		// Fast inline strip: remove all ESC-[ sequences and lone ESC chars.
		const stripped = frame.replace(/\x1b\[[0-9;?<>]*[a-zA-Z]/g, '').replace(/\x1b./g, '').replace(/\x1b/g, '')
		if (stripped.length > 0) {
			this._lastRenderFrame = frame
		}
	}
	// `lastFrame` returns the last frame that contained actual rendered content.
	// Falls back to `_lastFrame` if no content frame has been seen yet (e.g.
	// component returns null or an empty tree — same fallback as before).
	lastFrame = () => this._lastRenderFrame ?? this._lastFrame
}

class Stderr extends EventEmitter {
	frames: string[] = []
	_lastFrame: string | undefined
	write = (frame: string) => {
		this.frames.push(frame)
		this._lastFrame = frame
	}
	lastFrame = () => this._lastFrame
}

class Stdin extends EventEmitter {
	isTTY = true
	data: string | null = null

	// `flush` is injected by the shim after instance creation so that
	// `write` can synchronously flush the React reconciler's pending work.
	// Without the flush, the state update scheduled by useInput's handler
	// (e.g., `setBuffer(b => b + input)`) lives in React's scheduler queue
	// and hasn't been committed yet when `lastFrame()` is called — making
	// the frame stale by one render. Calling `flushSyncWork` after the
	// event delivery drains the queue synchronously, so tests can assert on
	// `lastFrame()` immediately after `stdin.write(...)` (same contract as
	// `ink-testing-library` + published ink's `debug:true` mode).
	_flush: (() => void) | null = null

	constructor(options: { isTTY?: boolean } = {}) {
		super()
		this.isTTY = options.isTTY ?? true
	}

	write = (data: string) => {
		this.data = data
		this.emit('readable')
		this.emit('data', data)
		// Flush any pending React work that the event delivery scheduled.
		this._flush?.()
	}

	setEncoding() {
		// noop
	}

	setRawMode() {
		// noop
	}

	resume() {
		// noop
	}

	pause() {
		// noop
	}

	ref() {
		// noop
	}

	unref() {
		// noop
	}

	read = () => {
		const { data } = this
		this.data = null
		return data
	}
}

export function render(tree: ReactNode) {
	const stdout = new Stdout()
	const stderr = new Stderr()
	const stdin = new Stdin()

	const instance = renderSync(tree, {
		stdout: stdout as unknown as NodeJS.WriteStream,
		stderr: stderr as unknown as NodeJS.WriteStream,
		stdin: stdin as unknown as NodeJS.ReadStream,
		exitOnCtrlC: false,
		patchConsole: false,
	})

	// Inject the reconciler flush so stdin.write can drain pending work.
	// @ts-expect-error flushSyncWork is not in @types/react-reconciler
	stdin._flush = () => { (reconciler as any).flushSyncWork?.() }

	return {
		rerender: instance.rerender,
		unmount: instance.unmount,
		cleanup: instance.cleanup,
		stdout,
		stderr,
		stdin,
		frames: stdout.frames,
		lastFrame: stdout.lastFrame,
	}
}
