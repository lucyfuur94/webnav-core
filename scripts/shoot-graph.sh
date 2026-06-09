#!/usr/bin/env bash
# Dev-only fast feedback loop for the graph viewer: render a site's interior graph
# and produce a PNG I can look at — in ONE command, no manual server/playwright dance.
#
#   scripts/shoot-graph.sh [site] [shape]
#     site  : site-node id (default www.saucedemo.com)
#     shape : step | curved (default step)
#
# It (re)builds the web bundle if stale, generates the self-contained standalone
# HTML (graph data inlined, no API needed), serves it over http (playwright-cli
# blocks file://), drives playwright-cli to open+fit+screenshot, prints the PNG path.
set -euo pipefail
cd "$(dirname "$0")/.."

SITE="${1:-www.saucedemo.com}"
SHAPE="${2:-step}"
PORT=7791
OUT="/tmp/wn-shoot"
mkdir -p "$OUT"
HTML="$OUT/graph.html"
SESS="shoot"

# 1. Build web bundle if it changed (cheap if up to date).
npm --prefix web run build >/dev/null 2>&1

# 2. Generate the standalone HTML (data inlined → no webnav API server needed).
npx tsx src/cli.ts dev standalone "$SITE" --out "$HTML" >/dev/null 2>&1

# 3. Serve it (playwright-cli only accepts http/https, not file://).
pkill -f "http.server $PORT" >/dev/null 2>&1 || true
sleep 0.3
( cd "$OUT" && python3 -m http.server "$PORT" >/dev/null 2>&1 & )
sleep 1.2

# 4. Open + (optionally) switch shape + fit + screenshot.
playwright-cli -s="$SESS" close >/dev/null 2>&1 || true
playwright-cli -s="$SESS" open "http://127.0.0.1:$PORT/graph.html" >/dev/null 2>&1
playwright-cli -s="$SESS" resize 1500 1100 >/dev/null 2>&1
sleep 2.5
if [ "$SHAPE" = "curved" ]; then
  playwright-cli -s="$SESS" eval "() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='Curved'); b&&b.click(); }" >/dev/null 2>&1
  sleep 1
fi
playwright-cli -s="$SESS" eval "() => document.querySelector('button.react-flow__controls-fitview')?.click()" >/dev/null 2>&1
sleep 1
playwright-cli -s="$SESS" screenshot >/dev/null 2>&1

SHOT="$(ls -t .playwright-cli/*.png 2>/dev/null | head -1)"
NODES="$(playwright-cli -s="$SESS" eval "() => document.querySelectorAll('.react-flow__node').length" 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo '?')"
playwright-cli -s="$SESS" close >/dev/null 2>&1 || true
pkill -f "http.server $PORT" >/dev/null 2>&1 || true

echo "site=$SITE shape=$SHAPE nodes=$NODES"
echo "PNG=$SHOT"
