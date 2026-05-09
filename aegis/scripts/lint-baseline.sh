#!/usr/bin/env bash
# Enforce the M1 lint policy for the forked upstream: biome is not clean
# (~10,874 inherited errors from the leak) but must not regress, and
# aegis/src/medical/ — the code we author — must stay biome-clean.
#
#   1. Total biome error count ≤ frozen baseline
#   2. Zero biome errors inside aegis/src/medical/
#
# Exits 0 only if both hold. Use `bun run lint:strict` to see the full
# biome error stream against the original clean-lint gate.

set -euo pipefail

AEGIS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BASELINE="$AEGIS_DIR/scripts/baselines/biome-count.txt"

if [ ! -f "$BASELINE" ]; then
  echo "error: biome baseline file missing at $BASELINE" >&2
  exit 2
fi

BASE="$(tr -d '[:space:]' < "$BASELINE")"

cd "$AEGIS_DIR"

# biome exits non-zero on errors; we count them ourselves. Keep set +e
# active across both the biome call AND the grep pipeline because a clean
# subtree produces no "Found N errors" line, making grep exit non-zero.
set +e
FULL_OUT=$(bunx biome check src/ --reporter=summary 2>&1)
MED_OUT=$(bunx biome check src/medical/ --reporter=summary 2>&1)

TOTAL=$(printf '%s\n' "$FULL_OUT" | grep -oE 'Found [0-9]+ errors?' | head -1 | grep -oE '[0-9]+')
MEDICAL=$(printf '%s\n' "$MED_OUT" | grep -oE 'Found [0-9]+ errors?' | head -1 | grep -oE '[0-9]+')
set -e
: "${TOTAL:=0}"
: "${MEDICAL:=0}"

FAIL=0

if [ "$TOTAL" -gt "$BASE" ]; then
  echo "FAIL: total biome errors $TOTAL exceeds baseline $BASE (delta +$((TOTAL - BASE)))" >&2
  FAIL=1
fi

if [ "$MEDICAL" -ne 0 ]; then
  echo "FAIL: $MEDICAL biome errors in aegis/src/medical/ (must be 0):" >&2
  bunx biome check src/medical/ 2>&1 | head -30 >&2
  FAIL=1
fi

printf 'lint: total=%s baseline=%s medical=%s ' "$TOTAL" "$BASE" "$MEDICAL"

if [ "$FAIL" -eq 0 ]; then
  echo "OK"
  exit 0
else
  echo "FAIL"
  exit 1
fi
