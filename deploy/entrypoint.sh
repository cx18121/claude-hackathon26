#!/bin/sh
# Launch the three per-game servers in the background, then exec Caddy
# in the foreground so PID 1 receives signals correctly. tini (set as
# ENTRYPOINT) forwards SIGTERM to all children at shutdown.
#
# Each server reads $PORT (engine_core/src/lib.rs:47) and falls back to
# its hardcoded value when unset. We pin explicit ports here because
# Railway injects $PORT for Caddy — if that var leaked through, all
# three game servers would try to bind the same port and fight.
set -e
cd /app

env -u PORT PORT=8001 ./games/boxing/server/target/release/boxing-server &
env -u PORT PORT=8002 ./games/dance/server/target/release/dance-server &
env -u PORT PORT=8003 ./games/fps-boxing/server/target/release/fps-boxing-server &

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
