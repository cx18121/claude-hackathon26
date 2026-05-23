#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[ ! -d "$ROOT/games/fps-boxing/client/node_modules" ] && (cd "$ROOT/games/fps-boxing/client" && npm install)

for port in 8003 5175; do
  pids=( $(lsof -ti :$port 2>/dev/null || true) )
  [ "${#pids[@]}" -gt 0 ] && kill "${pids[@]}" 2>/dev/null || true
done

echo "Building fps-boxing client..."
(cd "$ROOT/games/fps-boxing/client" && npm run build > /tmp/spectre-fps-client.log 2>&1) || {
  echo "FPS-Boxing client build FAILED."; tail -20 /tmp/spectre-fps-client.log; exit 1
}

echo "Building fps-boxing server..."
(cd "$ROOT/games/fps-boxing/server" && cargo build --release > /tmp/spectre-fps-server.log 2>&1) || {
  echo "FPS-Boxing server build FAILED."; tail -20 /tmp/spectre-fps-server.log; exit 1
}

cleanup() { kill "${server_pid:-}" "${vite_pid:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

PORT=8003 "$ROOT/games/fps-boxing/server/target/release/fps-boxing-server" &
server_pid=$!

cd "$ROOT/games/fps-boxing/client"
npm run dev -- --port 5175 > /tmp/spectre-fps-dev.log 2>&1 &
vite_pid=$!

sleep 1.5
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "<lan-ip>")

cat <<EOF

============================================================
FPS-Boxing server running.
  Lobby:    http://localhost:8003/
  LAN:      http://${LAN_IP}:8003/
  Vite dev: http://localhost:5175/
Press Ctrl+C to stop.
============================================================
EOF

wait
