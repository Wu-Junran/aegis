import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { render } from 'ink-testing-library'
import * as React from 'react'
import { TwoLevelModelPicker } from '../../../../src/commands/model/model.js'
import { PROVIDER_PRESETS, formatProviderCaps } from '../../../../src/medical/providers/presets.js'
import { AppStateProvider } from '../../../../src/state/AppState.js'
import { getDefaultAppState } from '../../../../src/state/AppStateStore.js'

test('shared formatter emits all provider capability fields', () => {
	const anthropic = PROVIDER_PRESETS.find((p) => p.id === 'anthropic')!
	expect(formatProviderCaps(anthropic)).toMatch(/streaming=(true|false)/)
	expect(formatProviderCaps(anthropic)).toMatch(/tool=(true|false)/)
	expect(formatProviderCaps(anthropic)).toMatch(/cache=(true|false)/)
	expect(formatProviderCaps(anthropic)).toMatch(/ctx=\d+/)
})

test('first-level picker shows preset ids + display names, NOT inline caps (layout regression guard)', () => {
	// Regression for the layout bug observed in /tmp/aegis-m5-manual: when
	// the picker passed `formatProviderCaps(p)` as the Select option's
	// `description` prop, Ink/Yoga's layout treated the description as a
	// column-rendered child of a row whose label had already consumed the
	// available row width. The result was the caps string ("streaming=true
	// tool=true cache=true ctx=1000000") wrapping char-by-char into a
	// 2-column-wide vertical strip on the right edge of the terminal —
	// unreadable. The fix moves caps to `/provider list` (where it's plain
	// text in a wide layout) and keeps the picker label to a bounded width.
	//
	// This test now pins the OPPOSITE contract: the picker frame must NOT
	// contain the caps strings, must show every preset id, and must point
	// the user at `/provider list` for the moved-out info.
	const { lastFrame } = render(
		<AppStateProvider initialState={getDefaultAppState()}>
			<TwoLevelModelPicker onDone={() => {}} />
		</AppStateProvider>,
	)
	const out = lastFrame() ?? ''
	const outNoWhitespace = out.replace(/\s+/g, '')
	// Load-bearing #1: the caps strings are NOT inline in the picker.
	expect(outNoWhitespace).not.toContain('streaming=true')
	expect(outNoWhitespace).not.toContain('tool=true')
	expect(outNoWhitespace).not.toContain('cache=true')
	expect(outNoWhitespace).not.toContain('ctx=1000000')
	// Load-bearing #2: every preset is identifiable by its id.
	for (const p of PROVIDER_PRESETS) {
		expect(out).toContain(p.id)
	}
	// Load-bearing #3: the user is told where the caps moved to.
	expect(out).toContain('/provider list')
})

test('picker no longer imports formatProviderCaps (contract: caps live in /provider list only)', () => {
	// Companion to the layout-regression test above. The picker source must
	// NOT import or call `formatProviderCaps` — that's how we keep the row
	// label to a bounded width that Ink/Yoga can lay out without the
	// constraint propagation that produced the char-by-char wrap. The
	// formatter still ships and is still used by `/provider list` (the
	// wide-layout, plain-text path), so the assertion below pins both:
	// picker doesn't import it, provider command does.
	const pickerSource = readFileSync(
		new URL('../../../../src/medical/repl/ProviderSelect.tsx', import.meta.url),
		'utf8',
	)
	const providerCommandSource = readFileSync(
		new URL('../../../../src/commands/provider/provider.tsx', import.meta.url),
		'utf8',
	)
	expect(pickerSource).not.toContain('formatProviderCaps')
	expect(providerCommandSource).toContain('formatProviderCaps(p)')
})
