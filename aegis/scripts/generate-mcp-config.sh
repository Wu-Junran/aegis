#!/usr/bin/env bash
set -euo pipefail

REPO="$(git rev-parse --show-toplevel)"
BIN="${REPO}/aegis-mcp/.venv/bin/aegis-mcp"
TEMPLATE="${REPO}/.mcp.json.template"
OUT="${REPO}/.mcp.json"

if [ ! -x "$BIN" ]; then
  echo "error: aegis-mcp binary not found at $BIN" >&2
  echo "" >&2
  echo "run:" >&2
  echo "  cd \"$REPO/aegis-mcp\"" >&2
  echo "  python3.11 -m venv .venv" >&2
  echo "  .venv/bin/pip install -e '.[dev]'" >&2
  exit 1
fi

if [ ! -f "$TEMPLATE" ]; then
  echo "error: template not found at $TEMPLATE" >&2
  exit 1
fi

# Use node for JSON-aware substitution to survive paths with special chars.
node -e '
const fs = require("fs");
const [tmpl, bin, out] = [process.argv[1], process.argv[2], process.argv[3]];
const s = fs.readFileSync(tmpl, "utf8");
const replaced = s.split("__AEGIS_MCP_BIN__").join(bin);
// Validate JSON before writing.
JSON.parse(replaced);
fs.writeFileSync(out, replaced);
' "$TEMPLATE" "$BIN" "$OUT"

echo "wrote $OUT"
echo "  command: $BIN"
