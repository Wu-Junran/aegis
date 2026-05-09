#!/usr/bin/env bash
# aegis/scripts/install.sh — one-command Aegis install (M7 / A.4).
# Idempotent. Re-run safely after a venv rebuild or fresh checkout.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AEGIS_DIR="${REPO_ROOT}/aegis"
MCP_DIR="${REPO_ROOT}/aegis-mcp"

step() { printf '\n→ %s\n' "$*"; }
fail() {
  printf '\n✗ %s\n' "$*" >&2
  exit "${2:-1}"
}

# 1. Prerequisites.
step "Verifying prerequisites"
command -v bun >/dev/null || fail "Bun not on PATH. Install: https://bun.sh" 1
command -v python3.11 >/dev/null || command -v python3 >/dev/null || \
  fail "python3.11 (preferred) or python3 not on PATH" 1
PYTHON_BIN="$(command -v python3.11 || command -v python3)"
PY_VERSION="$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
# Numeric `major == 3 && minor >= 11` check — tracks the floor declared in
# aegis-mcp/pyproject.toml (`requires-python = ">=3.11"`) without an
# allowlist that would reject valid newer Pythons (3.14+).
PY_MAJOR="${PY_VERSION%%.*}"
PY_MINOR="${PY_VERSION#*.}"
if [[ "$PY_MAJOR" != "3" ]] || ! [[ "$PY_MINOR" =~ ^[0-9]+$ ]] || (( PY_MINOR < 11 )); then
  fail "Python ≥ 3.11 required; found $PY_VERSION at $PYTHON_BIN" 1
fi

# 2. Python venv + aegis-mcp install.
step "Setting up aegis-mcp Python venv"
cd "$MCP_DIR"
if [[ ! -d ".venv" ]]; then
  "$PYTHON_BIN" -m venv .venv || fail "python venv creation failed" 2
fi
.venv/bin/pip install --upgrade pip >/dev/null
.venv/bin/pip install -e '.[dev]' || fail "pip install of aegis-mcp failed" 2

step "Ensuring spaCy en_core_web_sm model is installed"
if ! .venv/bin/python -c "import spacy; spacy.load('en_core_web_sm')" >/dev/null 2>&1; then
  .venv/bin/python -m spacy download en_core_web_sm
fi

# 3. Generate .mcp.json.
step "Generating .mcp.json"
cd "$REPO_ROOT"
bash "${AEGIS_DIR}/scripts/generate-mcp-config.sh" || fail "generate-mcp-config.sh failed" 2

# 4. TS install + build.
step "Installing aegis Node dependencies (bun install)"
cd "$AEGIS_DIR"
bun install || fail "bun install failed" 2

step "Building aegis bundle (bun run build)"
bun run build || fail "bun run build failed" 2

# 5. Smoke test.
step "Running unit-test smoke (bun run test:unit)"
bun run test:unit || fail "bun run test:unit smoke failed" 2

cat <<'EOF'

✓ Aegis install complete.

Quickstart:
  cd aegis
  ./dist/aegis --phi-mode research

Replay-only Synthea dogfood (no API spend):
  cd aegis && bun run dogfood:synthea

See docs/operator-guide.md for full operations docs.
EOF
