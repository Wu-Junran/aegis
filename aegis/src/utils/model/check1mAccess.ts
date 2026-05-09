import type { OverageDisabledReason } from 'src/services/claudeAiLimits.js'
import { isClaudeAISubscriber } from '../auth.js'
import { getGlobalConfig } from '../config.js'
import { is1mContextDisabled } from '../context.js'

/**
 * Check if extra usage is enabled based on the cached disabled reason.
 * Extra usage is considered enabled if there's no disabled reason,
 * or if the disabled reason indicates it's provisioned but temporarily unavailable.
 */
function isExtraUsageEnabled(): boolean {
  const reason = getGlobalConfig().cachedExtraUsageDisabledReason
  // undefined = no cache yet, treat as not enabled (conservative)
  if (reason === undefined) {
    return false
  }
  // null = no disabled reason from API, extra usage is enabled
  if (reason === null) {
    return true
  }
  // Check which disabled reasons still mean "provisioned"
  switch (reason as OverageDisabledReason) {
    // Provisioned but credits depleted — still counts as enabled
    case 'out_of_credits':
      return true
    // Not provisioned or actively disabled
    case 'overage_not_provisioned':
    case 'org_level_disabled':
    case 'org_level_disabled_until':
    case 'seat_tier_level_disabled':
    case 'member_level_disabled':
    case 'seat_tier_zero_credit_limit':
    case 'group_zero_credit_limit':
    case 'member_zero_credit_limit':
    case 'org_service_level_disabled':
    case 'org_service_zero_credit_limit':
    case 'no_limits_configured':
    case 'unknown':
      return false
    default:
      return false
  }
}

// Test-only override slots. Production paths fall through to the real
// `isClaudeAISubscriber` / `isExtraUsageEnabled` chain unless a test
// installed a non-null override via `__setCheck1mAccessOverridesForTest`.
// The `model-inline-args.test.tsx` 1M-access regression test uses this
// to simulate a no-access environment so the assertion "1M rejection
// fires BEFORE the alias short-circuit" can be made BIDIRECTIONALLY:
// under the buggy gate ordering (`isKnownAlias` before `isOpus1mUnavailable`,
// reverted in commit 715f207) the alias is set silently in the no-access
// env, no rejection message appears, and the test fails.
let _opus1mAccessOverride: boolean | null = null
let _sonnet1mAccessOverride: boolean | null = null

// @[MODEL LAUNCH]: Add check if the new model supports 1M context
export function checkOpus1mAccess(): boolean {
  if (_opus1mAccessOverride !== null) return _opus1mAccessOverride
  if (is1mContextDisabled()) {
    return false
  }

  if (isClaudeAISubscriber()) {
    // Subscribers have access if extra usage is enabled for their account
    return isExtraUsageEnabled()
  }

  // Non-subscribers (API/PAYG) have access
  return true
}

export function checkSonnet1mAccess(): boolean {
  if (_sonnet1mAccessOverride !== null) return _sonnet1mAccessOverride
  if (is1mContextDisabled()) {
    return false
  }

  if (isClaudeAISubscriber()) {
    // Subscribers have access if extra usage is enabled for their account
    return isExtraUsageEnabled()
  }

  // Non-subscribers (API/PAYG) have access
  return true
}

/**
 * Test-only seam. Force `checkOpus1mAccess()` and/or `checkSonnet1mAccess()`
 * to return a fixed boolean, bypassing the subscriber/extra-usage chain.
 * Pass `null` for either field to clear that override (back to real impl).
 * Underscore prefix follows the M5 convention (`__setKeytarForTest`,
 * `__setAdapterForTest`, …) — production code MUST NOT call this.
 */
export function __setCheck1mAccessOverridesForTest(opts: {
  opus?: boolean | null
  sonnet?: boolean | null
}): void {
  if (opts.opus !== undefined) _opus1mAccessOverride = opts.opus
  if (opts.sonnet !== undefined) _sonnet1mAccessOverride = opts.sonnet
}

