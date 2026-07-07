#!/usr/bin/env bash
# Rebuild and redeploy the prod Agent Log Viewer safely.
#
# Closes two recurring failure modes:
#   1. Leaked Next internals (__NEXT_PRIVATE_STANDALONE_CONFIG / __NEXT_PRIVATE_ORIGIN)
#      inherited from the running next-server force output:standalone and bypass
#      next.config.ts, so a clean build dies early with "generate is not a function".
#      We scrub them before building.
#   2. Restarting mid-build desyncs served HTML from on-disk asset hashes (CSS 500,
#      unstyled UI). We stop -> build -> start, then verify the CSS the HTML points
#      at actually returns 200.
#
# The tmux `agents` server + panes survive because the unit uses KillMode=process.
#
# Usage: scripts/rebuild.sh
# Env overrides: LLV_NODE_BIN=/path/to/node   (force a node binary)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

SERVICE="agent-log-viewer.service"
PORT="${PORT:-8898}"
TOKEN="$(sed -n 's/^LLV_TOKEN=//p' "$HOME/.config/agent-log-viewer/service.env" 2>/dev/null | head -1)"

# --- 1. scrub leaked Next internals ---------------------------------------
unset __NEXT_PRIVATE_STANDALONE_CONFIG __NEXT_PRIVATE_ORIGIN NEXT_DEPLOYMENT_ID || true

# --- 2. pick a node the build is known to tolerate ------------------------
# Next 16 wants >=20.9. The system node can be far newer than tested; a clean
# webpack build has miscompiled on very new majors. Prefer an explicit binary,
# then PATH node if its major is in [20,24], then a known bundled node 22.
pick_node() {
  if [ -n "${LLV_NODE_BIN:-}" ] && "$LLV_NODE_BIN" -v >/dev/null 2>&1; then
    dirname "$LLV_NODE_BIN"; return
  fi
  local major
  major="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')" || major=""
  if [ -n "$major" ] && [ "$major" -ge 20 ] && [ "$major" -le 24 ]; then
    dirname "$(command -v node)"; return
  fi
  local bundled="$HOME/codex-desktop-linux/codex-app/resources/node-runtime/bin"
  if [ -x "$bundled/node" ]; then
    echo "  note: system node $(node -v 2>/dev/null) out of tested range; using bundled $($bundled/node -v)" >&2
    echo "$bundled"; return
  fi
  echo "  note: no node in [20,24] found; using $(node -v 2>/dev/null) as-is" >&2
  dirname "$(command -v node)"
}
NODE_DIR="$(pick_node)"
export PATH="$NODE_DIR:$PATH"
echo "==> build node: $(node -v)  (from $NODE_DIR)"

# --- 3. stop the server so it never serves a half-written .next -----------
echo "==> stopping $SERVICE"
systemctl --user stop "$SERVICE" 2>/dev/null || true
systemctl --user reset-failed "$SERVICE" 2>/dev/null || true

# --- 4. clean build -------------------------------------------------------
echo "==> clean build"
rm -rf .next
NEXT_TELEMETRY_DISABLED=1 ./node_modules/.bin/next build --webpack

if [ ! -d .next/static/css ] || [ -z "$(ls -A .next/static/css 2>/dev/null)" ]; then
  echo "!! build produced no CSS — aborting, NOT starting the service" >&2
  exit 1
fi

# --- 5. start and verify --------------------------------------------------
echo "==> starting $SERVICE"
systemctl --user start "$SERVICE"

BASE="http://127.0.0.1:${PORT}/"
[ -n "$TOKEN" ] && BASE="${BASE}?k=${TOKEN}"

for i in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE" 2>/dev/null || echo 000)"
  [ "$code" = "200" ] && break
  sleep 1
done
[ "${code:-000}" = "200" ] || { echo "!! page not serving (HTTP ${code:-000})" >&2; exit 1; }

# The CSS the freshly-served HTML references must exist and return 200 —
# this is the exact check that catches the hash-desync failure mode.
html_css="$(curl -s --max-time 5 "$BASE" | grep -oE '/_next/static/css/[^\"]+\.css' | head -1)"
if [ -n "$html_css" ]; then
  css_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${PORT}${html_css}" 2>/dev/null || echo 000)"
  [ "$css_code" = "200" ] || { echo "!! CSS $html_css returns HTTP $css_code (HTML/asset desync)" >&2; exit 1; }
  echo "==> OK  page 200, css 200 ($html_css)"
else
  echo "==> page 200 (no <link> css found — check manually)"
fi

echo "==> done. tmux agents: $(tmux has-session -t agents 2>/dev/null && echo alive || echo none)"
