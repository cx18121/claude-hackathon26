#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  echo ""
  echo "Stopping all dev servers..."
  kill "$server_pid" "$mobile_pid" "$overlay_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting server..."
cd "$ROOT/server"
if [ -f .venv/bin/activate ]; then
  source .venv/bin/activate
fi
python main.py &
server_pid=$!

echo "Starting mobile dev server..."
cd "$ROOT/mobile"
npm run dev -- --port 5173 &
mobile_pid=$!

echo "Starting overlay dev server..."
cd "$ROOT/overlay"
npm run dev -- --port 5174 &
overlay_pid=$!

echo ""
echo "All services started."
echo ""
echo "  Server:  http://localhost:8000"
echo "  Mobile:  http://localhost:5173?server=http://localhost:8000"
echo "  Overlay: http://localhost:5174?server=http://localhost:8000&room=<code>"
echo ""
echo "The server prints the room code on startup."
echo "Press Ctrl+C to stop everything."
echo ""

wait
