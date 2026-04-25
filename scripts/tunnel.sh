#!/usr/bin/env bash
# Shadow Fight launcher with a public Cloudflare tunnel.
#
# Use this instead of dev.sh when you and your opponent are on different
# networks (different WiFi, eduroam isolation, mobile data, remote, etc.).
# The server is exposed via cloudflared; the printed URL works from anywhere
# on the public internet.
#
# Builds the mobile and overlay bundles before starting so they are served
# under the same tunnel host. Vite dev servers are NOT started -- the only
# thing the friend's device can hit is what cloudflared exposes (port 8000).
#
# Requirements:
#   - cloudflared installed:  brew install cloudflared
#   - server/.venv set up:    cd server && python3 -m venv .venv && source
#                              .venv/bin/activate && pip install -r requirements.txt
#
# Usage:
#   bash scripts/tunnel.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ---------- preflight ------------------------------------------------------

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "ERROR: cloudflared not found."
  echo "Install:"
  echo "  macOS:   brew install cloudflared"
  echo "  Linux:   sudo apt install cloudflared"
  echo "  Windows: winget install cloudflared"
  exit 1
fi

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

# Free port 8000 if a previous run left something behind.
pid=$(lsof -ti :8000 2>/dev/null || true)
if [ -n "$pid" ]; then
  echo "Port 8000 held by pid $pid -- killing"
  kill "$pid" 2>/dev/null || true
  sleep 0.3
fi

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

# ---------- start server with tunnel ---------------------------------------

cleanup() {
  echo ""
  echo "Stopping server and tunnel..."
  kill "${server_pid:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cat <<'BANNER'

============================================================
Starting server with Cloudflare tunnel.
The first launch may take ~10-15s while cloudflared
negotiates a public URL. Watch for the banner below.
============================================================

BANNER

cd "$ROOT/server"
source .venv/bin/activate
# TUNNEL is true by default in main.py, so we just don't override it.
python main.py &
server_pid=$!

# ---------- wait + print friendly guide ------------------------------------

# Give the server time to print its full startup banner (which contains the
# public URL printed by qr.py).
sleep 12

cat <<EOF

============================================================
HOW TO PLAY (copy URLs from the server's startup banner above)
============================================================

The 'Public URL' line above is your shareable host. It looks
like:  https://something-random.trycloudflare.com

Send your opponent the printed mobile URL (it includes the
correct ?server=... and ?room=... already).

  Player 1 (you):   <Public URL>/mobile?room=<CODE>&slot=1&v=<v>
  Player 2 (friend):<Public URL>/mobile?room=<CODE>&slot=2&v=<v>
  Overlay:          <Public URL>/overlay?room=<CODE>&v=<v>

The cache-buster (&v=...) is already baked into the URLs the
server prints -- copy those rather than typing by hand.

Notes:
  * Cloudflare's free tunnel URLs are ephemeral: they change
    every time you restart this script. Re-share after restart.
  * The tunnel auto-upgrades to HTTPS/WSS, which means the
    mobile client can request the camera on iOS Safari (which
    blocks getUserMedia on plain http origins).
  * Vite dev servers are NOT running in tunnel mode. If you
    want hot-reload while iterating on UI code, run dev.sh
    instead and test on the same WiFi.

Press Ctrl+C to stop the server and tear down the tunnel.
============================================================

EOF

wait
