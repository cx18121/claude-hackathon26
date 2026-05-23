#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[ ! -d "$ROOT/games/dance/client/node_modules" ] && (cd "$ROOT/games/dance/client" && npm install)

for port in 8002 5174; do
  pids=( $(lsof -ti :$port 2>/dev/null || true) )
  [ "${#pids[@]}" -gt 0 ] && kill "${pids[@]}" 2>/dev/null || true
done

echo "Building dance client..."
(cd "$ROOT/games/dance/client" && npm run build > /tmp/spectre-dance-client.log 2>&1) || {
  echo "Dance client build FAILED."; tail -20 /tmp/spectre-dance-client.log; exit 1
}

echo "Building dance server..."
(cd "$ROOT/games/dance/server" && cargo build --release > /tmp/spectre-dance-server.log 2>&1) || {
  echo "Dance server build FAILED."; tail -20 /tmp/spectre-dance-server.log; exit 1
}

cleanup() { kill "${server_pid:-}" "${vite_pid:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

PORT=8002 "$ROOT/games/dance/server/target/release/dance-server" &
server_pid=$!

cd "$ROOT/games/dance/client"
npm run dev -- --port 5174 > /tmp/spectre-dance-dev.log 2>&1 &
vite_pid=$!

sleep 1.5
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "<lan-ip>")

cat <<EOF

============================================================
Dance server running.
  Lobby:    http://localhost:8002/
  LAN:      http://${LAN_IP}:8002/
  Vite dev: http://localhost:5174/
Press Ctrl+C to stop.
============================================================
EOF

wait
