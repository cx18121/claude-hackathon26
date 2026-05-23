#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[ ! -d "$ROOT/games/boxing/client/node_modules" ] && (cd "$ROOT/games/boxing/client" && npm install)

for port in 8001 5173; do
  pids=( $(lsof -ti :$port 2>/dev/null || true) )
  [ "${#pids[@]}" -gt 0 ] && kill "${pids[@]}" 2>/dev/null || true
done

echo "Building boxing client..."
(cd "$ROOT/games/boxing/client" && npm run build > /tmp/spectre-boxing-client.log 2>&1) || {
  echo "Boxing client build FAILED."; tail -20 /tmp/spectre-boxing-client.log; exit 1
}

echo "Building boxing server..."
(cd "$ROOT/games/boxing/server" && cargo build --release > /tmp/spectre-boxing-server.log 2>&1) || {
  echo "Boxing server build FAILED."; tail -20 /tmp/spectre-boxing-server.log; exit 1
}

cleanup() { kill "${server_pid:-}" "${vite_pid:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

PORT=8001 "$ROOT/games/boxing/server/target/release/boxing-server" &
server_pid=$!

cd "$ROOT/games/boxing/client"
npm run dev -- --port 5173 > /tmp/spectre-boxing-dev.log 2>&1 &
vite_pid=$!

sleep 1.5
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "<lan-ip>")

cat <<EOF

============================================================
Boxing server running.
  Lobby:    http://localhost:8001/
  LAN:      http://${LAN_IP}:8001/
  Vite dev: http://localhost:5173/
Press Ctrl+C to stop.
============================================================
EOF

wait
