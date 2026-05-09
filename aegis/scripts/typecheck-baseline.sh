#!/usr/bin/env bash
# Enforce the typecheck policy for the forked upstream: tsc is not clean
# (~5,867 inherited type-only errors from the leak) but must not regress.
# Three invariants must hold:
#
#   1. Total tsc error count ≤ frozen baseline
#   2. Zero errors originate inside aegis/src/medical/
#   3. Zero @ts-nocheck directives in aegis/src/
#
# Exits 0 only if all three hold. Use `bun run typecheck:strict` to see the
# full tsc error stream against the original clean-tsc gate.

set -euo pipefail

AEGIS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BASELINE="$AEGIS_DIR/scripts/baselines/tsc-count.txt"

if [ ! -f "$BASELINE" ]; then
  echo "error: baseline file missing at $BASELINE" >&2
  exit 2
fi

BASE="$(tr -d '[:space:]' < "$BASELINE")"
LOG="$(mktemp -t aegis-tsc.XXXXXX)"
trap 'rm -f "$LOG"' EXIT

cd "$AEGIS_DIR"

# Run tsc, capture output (non-zero exit is expected — errors are fine, we're counting them).
bunx tsc --noEmit >"$LOG" 2>&1 || true

# grep -c prints the count to stdout even on zero matches; the non-zero
# exit in that case is harmless to us, so briefly disable set -e.
set +e
TOTAL=$(grep -cE '^[^:]+\([0-9]+,[0-9]+\): error TS[0-9]+' "$LOG" 2>/dev/null)
MEDICAL=$(grep -cE '^src/medical/.+error TS[0-9]+' "$LOG" 2>/dev/null)
TS2307=$(grep -cE 'error TS2307:' "$LOG" 2>/dev/null)
NOCHECK_LIST=$(grep -rl '@ts-nocheck' src 2>/dev/null)
set -e
if [ -z "$NOCHECK_LIST" ]; then
  NOCHECK=0
else
  NOCHECK=$(printf '%s\n' "$NOCHECK_LIST" | wc -l | tr -d '[:space:]')
fi

FAIL=0

if [ "$TOTAL" -gt "$BASE" ]; then
  echo "FAIL: total tsc errors $TOTAL exceeds baseline $BASE (delta +$((TOTAL - BASE)))" >&2
  FAIL=1
fi

if [ "$MEDICAL" -ne 0 ]; then
  echo "FAIL: $MEDICAL tsc errors originate in aegis/src/medical/ (must be 0):" >&2
  grep -E '^src/medical/.+error TS[0-9]+' "$LOG" | head -20 >&2
  FAIL=1
fi

if [ "$NOCHECK" -ne 0 ]; then
  echo "FAIL: @ts-nocheck directives found in aegis/src/ (must be 0):" >&2
  grep -rl '@ts-nocheck' src 2>/dev/null | head -20 >&2
  FAIL=1
fi

printf 'typecheck: total=%s baseline=%s medical=%s ts2307=%s nocheck=%s ' \
  "$TOTAL" "$BASE" "$MEDICAL" "$TS2307" "$NOCHECK"

if [ "$FAIL" -eq 0 ]; then
  echo "OK"
  exit 0
else
  echo "FAIL"
  exit 1
fi
