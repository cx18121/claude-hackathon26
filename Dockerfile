# Spectre — single Railway image hosting all three games behind Caddy.
#
# Layout:
#   /app/games/{boxing,dance,fps-boxing}/client/dist  — per-game built SPAs
#   /app/games/{boxing,dance,fps-boxing}/server/...   — per-game release binaries
#   /etc/caddy/Caddyfile                              — path-prefix router
#   /app/landing.html                                 — root index (healthcheck target)
#   /app/entrypoint.sh                                — launches 3 servers + Caddy
#
# Per-game ports (hardcoded in each server's main.rs): 8001/8002/8003. Caddy
# fronts them on $PORT. Each client is built with --base=/<game>/ so its
# absolute asset paths land back on the right Caddy route.

# ---- Client builds ----
# Each client needs `shared/` (path-aliased as `@shared/*`).

FROM node:24-slim AS boxing-client
WORKDIR /build
COPY shared/ /build/shared/
COPY games/boxing/client/ /build/games/boxing/client/
WORKDIR /build/games/boxing/client
RUN npm ci && npm run build -- --base=/boxing/

FROM node:24-slim AS dance-client
WORKDIR /build
COPY shared/ /build/shared/
COPY games/dance/client/ /build/games/dance/client/
WORKDIR /build/games/dance/client
RUN npm ci && npm run build -- --base=/dance/

FROM node:24-slim AS fps-client
WORKDIR /build
COPY shared/ /build/shared/
COPY games/fps-boxing/client/ /build/games/fps-boxing/client/
WORKDIR /build/games/fps-boxing/client
RUN npm ci && npm run build -- --base=/fps-boxing/

# ---- Rust server builds ----
# Single stage compiles all three game-server binaries. They share the
# engine/ workspace and depend on their plugin crate at games/<game>/plugin/.

FROM rust:1.86-slim AS rust-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY engine/ /build/engine/
COPY games/ /build/games/
RUN cargo build --release --manifest-path games/boxing/server/Cargo.toml \
 && cargo build --release --manifest-path games/dance/server/Cargo.toml \
 && cargo build --release --manifest-path games/fps-boxing/server/Cargo.toml

# ---- Final image ----
# tini supervises PID 1 so SIGTERM reaches all four child processes
# (Caddy + 3 game servers) on Railway shutdown. The Caddy binary comes
# straight from the official Caddy image — apt-installing Caddy on
# debian:slim trips dependency conflicts on `debian-archive-keyring`.

FROM caddy:2.8-alpine AS caddy-bin

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=caddy-bin /usr/bin/caddy /usr/bin/caddy

WORKDIR /app

# Server binaries — kept at the path each server's hardcoded
# client_dist setting expects (games/<game>/client/dist), so the
# already-shipped server code finds its assets unchanged.
COPY --from=rust-builder /build/games/boxing/server/target/release/boxing-server     /app/games/boxing/server/target/release/boxing-server
COPY --from=rust-builder /build/games/dance/server/target/release/dance-server       /app/games/dance/server/target/release/dance-server
COPY --from=rust-builder /build/games/fps-boxing/server/target/release/fps-boxing-server /app/games/fps-boxing/server/target/release/fps-boxing-server

# Client dists
COPY --from=boxing-client /build/games/boxing/client/dist     /app/games/boxing/client/dist
COPY --from=dance-client  /build/games/dance/client/dist      /app/games/dance/client/dist
COPY --from=fps-client    /build/games/fps-boxing/client/dist /app/games/fps-boxing/client/dist

# Static landing + reverse proxy config + entrypoint
COPY deploy/landing.html /app/landing.html
COPY deploy/Caddyfile    /etc/caddy/Caddyfile
COPY deploy/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Railway injects PORT at runtime. Local `docker run` without -e PORT
# falls back to the default in the Caddyfile (:8080).
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/entrypoint.sh"]
