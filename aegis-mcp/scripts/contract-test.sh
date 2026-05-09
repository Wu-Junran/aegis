#!/usr/bin/env bash
# Contract-test harness for aegis-mcp. Used by CI (spec §8 Layer 2).
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -x .venv/bin/pytest ]; then
  echo "aegis-mcp venv missing — run: python3.11 -m venv .venv && .venv/bin/pip install -e '.[dev]'" >&2
  exit 1
fi

.venv/bin/pytest -q tests/test_contract.py
