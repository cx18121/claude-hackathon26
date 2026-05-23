#!/usr/bin/env bash
# Starts all three games in parallel. Each game can also be started independently:
#   bash scripts/boxing.sh
#   bash scripts/dance.sh
#   bash scripts/fps-boxing.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  echo "Stopping all games..."
  kill "${boxing_pid:-}" "${dance_pid:-}" "${fps_pid:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

bash "$ROOT/scripts/boxing.sh" &
boxing_pid=$!

bash "$ROOT/scripts/dance.sh" &
dance_pid=$!

bash "$ROOT/scripts/fps-boxing.sh" &
fps_pid=$!

wait
