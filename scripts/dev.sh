#!/usr/bin/env bash
# Spectre local dev launcher — Rust engine edition.
#
# Starts:
#   - Rust engine-core on :8000 (LAN, no Cloudflare tunnel)
#   - Mobile Vite dev server on :5173
#   - Overlay Vite dev server on :5174
# Rebuilds the mobile and overlay production bundles first so the engine's
# /mobile and /overlay routes serve the latest code.
#
# Usage:
#   bash scripts/dev.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ---------- preflight ------------------------------------------------------

if ! command -v cargo &>/dev/null; then
  echo "ERROR: cargo not found."
  echo "Install Rust: https://rustup.rs"
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
# lsof can return multiple PIDs (server + child workers), so we don't quote
# $pids: word-splitting lets kill take all of them as separate arguments.
for port in 8000 5173 5174; do
  # shellcheck disable=SC2207
  pids=( $(lsof -ti :$port 2>/dev/null || true) )
  if [ "${#pids[@]}" -gt 0 ]; then
    echo "Port $port held by pid(s) ${pids[*]} -- killing"
    kill "${pids[@]}" 2>/dev/null || true
    sleep 0.5
    # shellcheck disable=SC2207
    still=( $(lsof -ti :$port 2>/dev/null || true) )
    if [ "${#still[@]}" -gt 0 ]; then
      kill -9 "${still[@]}" 2>/dev/null || true
      sleep 0.5
    fi
  fi
done

# ---------- build bundles --------------------------------------------------

echo "Building mobile bundle..."
(cd "$ROOT/mobile" && npm run build > /tmp/spectre-mobile-build.log 2>&1) || {
  echo "Mobile build FAILED. See /tmp/spectre-mobile-build.log"
  tail -20 /tmp/spectre-mobile-build.log
  exit 1
}

echo "Building overlay bundle..."
(cd "$ROOT/overlay" && npm run build > /tmp/spectre-overlay-build.log 2>&1) || {
  echo "Overlay build FAILED. See /tmp/spectre-overlay-build.log"
  tail -20 /tmp/spectre-overlay-build.log
  exit 1
}

echo "Building Rust engine (release)..."
(cd "$ROOT/engine" && cargo build --release -p engine-core > /tmp/spectre-engine-build.log 2>&1) || {
  echo "Engine build FAILED. See /tmp/spectre-engine-build.log"
  tail -20 /tmp/spectre-engine-build.log
  exit 1
}

# ---------- start services -------------------------------------------------

cleanup() {
  echo ""
  echo "Stopping all services..."
  kill "${engine_pid:-}" "${mobile_pid:-}" "${overlay_pid:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting Rust engine..."
PORT=8000 "$ROOT/engine/target/release/engine-core" &
engine_pid=$!

echo "Starting mobile dev server (Vite, hot reload)..."
cd "$ROOT/mobile"
npm run dev -- --port 5173 > /tmp/spectre-mobile-dev.log 2>&1 &
mobile_pid=$!

echo "Starting overlay dev server (Vite, hot reload)..."
cd "$ROOT/overlay"
npm run dev -- --port 5174 > /tmp/spectre-overlay-dev.log 2>&1 &
overlay_pid=$!

# Give the engine a moment to start.
sleep 1.5

# ---------- print URL guide -------------------------------------------------

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "<your-lan-ip>")

cat <<EOF

============================================================
All services are up.
============================================================

Open the lobby to create a room:
  http://localhost:8000/

  Click "Boxing" or "Dance" to get a room code,
  then enter it on your phone.

URLs to play locally on this LAPTOP only:
  Lobby (pick a game)
    http://localhost:8000/
  Overlay (game view)
    http://localhost:8000/overlay?room=<CODE>
  Mobile player (built bundle)
    http://localhost:8000/mobile?room=<CODE>&slot=1
  Mobile player (dev server, hot reload while iterating)
    http://localhost:5173?server=ws://localhost:8000&room=<CODE>&slot=1

URLs for OTHER DEVICES on the same WiFi (phones, friend's laptop):
  Lobby
    http://${LAN_IP}:8000/
  Overlay
    http://${LAN_IP}:8000/overlay?room=<CODE>
  Mobile player 1
    http://${LAN_IP}:8000/mobile?room=<CODE>&slot=1
  Mobile player 2
    http://${LAN_IP}:8000/mobile?room=<CODE>&slot=2

Tips:
  * No Cloudflare tunnel needed for same-WiFi play.
    All devices just need to share the LAN (${LAN_IP}/24).
  * Hot reload only works via :5173 (mobile) and :5174 (overlay).
    The :8000 routes serve the production bundle built above;
    restart the script to rebuild after code changes.
  * Two-player single-machine test: open two browser tabs to
    http://localhost:5173?... -- the server picks the slot.

Press Ctrl+C to stop everything.
============================================================

EOF

wait
