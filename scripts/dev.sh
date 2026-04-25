#!/usr/bin/env bash
# Shadow Fight local dev launcher.
#
# Starts:
#   - Python server on :8000 (LAN, no Cloudflare tunnel)
#   - Mobile Vite dev server on :5173
#   - Overlay Vite dev server on :5174
# Rebuilds the mobile and overlay production bundles first so the server's
# /mobile and /overlay routes serve the latest code (otherwise phones on
# the LAN load stale bundles).
#
# Usage:
#   bash scripts/dev.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ---------- preflight ------------------------------------------------------

if [ ! -d "$ROOT/server/.venv" ]; then
  echo "ERROR: server/.venv not found."
  echo "Run once:  cd server && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi
if [ ! -d "$ROOT/mobile/node_modules" ]; then
  echo "Installing mobile deps..."
  (cd "$ROOT/mobile" && npm install)
fi
if [ ! -d "$ROOT/overlay/node_modules" ]; then
  echo "Installing overlay deps..."
  (cd "$ROOT/overlay" && npm install)
fi

# Free the ports if a previous run left something behind.
for port in 8000 5173 5174; do
  pid=$(lsof -ti :$port 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "Port $port held by pid $pid -- killing"
    kill "$pid" 2>/dev/null || true
    sleep 0.3
  fi
done

# ---------- build bundles --------------------------------------------------

echo "Building mobile bundle..."
(cd "$ROOT/mobile" && npm run build > /tmp/shadowfight-mobile-build.log 2>&1) || {
  echo "Mobile build FAILED. See /tmp/shadowfight-mobile-build.log"
  tail -20 /tmp/shadowfight-mobile-build.log
  exit 1
}

echo "Building overlay bundle..."
(cd "$ROOT/overlay" && npm run build > /tmp/shadowfight-overlay-build.log 2>&1) || {
  echo "Overlay build FAILED. See /tmp/shadowfight-overlay-build.log"
  tail -20 /tmp/shadowfight-overlay-build.log
  exit 1
}

# ---------- start services -------------------------------------------------

cleanup() {
  echo ""
  echo "Stopping all dev servers..."
  kill "${server_pid:-}" "${mobile_pid:-}" "${overlay_pid:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting server..."
cd "$ROOT/server"
source .venv/bin/activate
TUNNEL=false python main.py &
server_pid=$!

echo "Starting mobile dev server (Vite, hot reload)..."
cd "$ROOT/mobile"
npm run dev -- --port 5173 > /tmp/shadowfight-mobile-dev.log 2>&1 &
mobile_pid=$!

echo "Starting overlay dev server (Vite, hot reload)..."
cd "$ROOT/overlay"
npm run dev -- --port 5174 > /tmp/shadowfight-overlay-dev.log 2>&1 &
overlay_pid=$!

# Give the server a moment to print its startup banner.
sleep 1.5

# ---------- print URL guide -------------------------------------------------

# Find the LAN IP so we can show phone-reachable URLs.
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "<your-lan-ip>")

cat <<EOF

============================================================
All three services are up.
============================================================

For the room code, scroll up to the server's startup banner.

URLs to play locally on this LAPTOP only:
  Overlay (game view)
    http://localhost:8000/overlay?room=<CODE>
  Mobile player (built bundle)
    http://localhost:8000/mobile?room=<CODE>&slot=1
  Mobile player (dev server, hot reload while iterating)
    http://localhost:5173?server=ws://localhost:8000&room=<CODE>&slot=1

URLs for OTHER DEVICES on the same WiFi (phones, friend's laptop):
  Overlay
    http://${LAN_IP}:8000/overlay?room=<CODE>
  Mobile player 1
    http://${LAN_IP}:8000/mobile?room=<CODE>&slot=1
  Mobile player 2
    http://${LAN_IP}:8000/mobile?room=<CODE>&slot=2

Tips:
  * No Cloudflare tunnel is needed for same-WiFi play.
    All three devices just need to share the LAN ($LAN_IP/24).
  * The server's startup output also prints these URLs with a
    cache-busting parameter -- prefer those if your phone has been
    showing stale content.
  * Hot reload only works for /mobile via :5173 and /overlay via
    :5174. The :8000/mobile and :8000/overlay routes serve the
    production bundle that this script just built; restart the
    script to rebuild after code changes.
  * Two-player single-machine test: open two browser tabs to
    http://localhost:5173?... -- the server picks the slot.

Press Ctrl+C to stop everything.
============================================================

EOF

wait
