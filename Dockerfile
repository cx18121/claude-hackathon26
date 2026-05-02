FROM node:20-slim AS overlay-builder
WORKDIR /overlay
COPY shared/ /shared/
COPY overlay/ ./
RUN npm ci && npm run build

FROM node:20-slim AS mobile-builder
WORKDIR /mobile
COPY shared/ /shared/
COPY mobile/ ./
RUN npm ci && npm run build

# ---- Rust engine build stage ----
FROM rust:1.86-slim AS engine-builder
# Install build dependencies for linking
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /engine
# Copy workspace Cargo files first for layer caching
COPY engine/Cargo.toml ./Cargo.toml
COPY engine/engine-core/Cargo.toml ./engine-core/Cargo.toml
# Create dummy main.rs so cargo can download and cache dependencies
RUN mkdir -p engine-core/src && echo 'fn main() {}' > engine-core/src/main.rs
RUN cargo build --release --manifest-path engine-core/Cargo.toml || true
# Now copy real source
COPY engine/ ./
# Touch main.rs to force rebuild after dependency cache
RUN touch engine-core/src/main.rs && cargo build --release --manifest-path engine-core/Cargo.toml

# ---- Final image ----
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Copy Rust binary
COPY --from=engine-builder /engine/target/release/engine-core ./engine-core
# Copy static assets (same paths as Python server)
COPY --from=overlay-builder /overlay/dist/ ./overlay/dist/
COPY --from=mobile-builder /mobile/dist/ ./mobile/dist/
EXPOSE 8000
CMD ["./engine-core"]
