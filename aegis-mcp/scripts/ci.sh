#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# ci.sh — aegis-mcp CI pipeline
# ─────────────────────────────────────────────────────────────
# Runs the Python unit tests + MCP wire-contract harness.
# Bootstraps .venv on first run so a fresh CI checkout works
# without a separate setup step.
#
# Wired into the top-level pipeline by aegis/scripts/ci-build.sh.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -x .venv/bin/pytest ]; then
  echo "=== Bootstrapping aegis-mcp .venv ==="
  python3.11 -m venv .venv
  .venv/bin/pip install -e ".[dev]"
fi

echo "=== aegis-mcp unit tests ==="
.venv/bin/pytest -q tests/

echo "=== aegis-mcp MCP wire-contract harness ==="
scripts/contract-test.sh

echo "=== aegis-mcp CI done ==="
