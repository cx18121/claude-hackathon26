# Game Separation Design

## Goal

Restructure the monolithic engine+games codebase into three independently runnable games, each with its own Rust binary, frontend, and lobby. Shared mechanics (WebSocket server, pose normalization, game loop, plugin trait) stay in a common engine library that each game links against.

---

## Repository Structure

```
spectre/
  engine/                        # Cargo workspace — shared library crates only
    Cargo.toml                   # workspace members: engine-core, plugin-trait, boxing-core, + 3 game servers
    engine-core/                 # lib crate: WS server, pose normalization, room manager, game loop
    plugin-trait/                # GamePlugin trait (unchanged)
    boxing-core/                 # shared combat math (unchanged)
  games/
    boxing/
      server/                    # Rust binary: engine-core + boxing-plugin
        Cargo.toml
        src/main.rs
      plugin/                    # boxing-plugin crate (moved from engine/boxing-plugin)
        Cargo.toml
        src/lib.rs
      client/                    # React app: MediaPipe pose capture + PixiJS renderer
        package.json
        vite.config.ts
        src/
    dance/
      server/
        Cargo.toml
        src/main.rs
      plugin/                    # dance-plugin crate (moved from engine/dance-plugin)
        Cargo.toml
        src/lib.rs
      client/                    # React app: MediaPipe pose capture + dance renderer
        package.json
        vite.config.ts
        src/
    fps-boxing/
      server/
        Cargo.toml
        src/main.rs
      plugin/                    # fps-boxing-plugin crate (moved from engine/fps-boxing-plugin)
        Cargo.toml
        src/lib.rs
      client/                    # Three.js app (moved from fps/)
        package.json
        vite.config.ts
        src/
  shared/                        # TypeScript protocol types (unchanged)
  scripts/
    boxing.sh                    # builds boxing client, starts boxing server + Vite
    dance.sh                     # builds dance client, starts dance server + Vite
    fps-boxing.sh                # builds fps-boxing client, starts fps-boxing server + Vite
    dev.sh                       # convenience: runs all 3 scripts in parallel
```

---

## Rust Engine Changes

### engine-core: binary → library

`engine-core` splits into a public library and a thin internal binary (kept for testing).

**Public surface (`engine-core/src/lib.rs`):**

```rust
pub struct EngineConfig {
    pub port: u16,
    pub client_dist: &'static str,  // path to built frontend dist/
    pub game_name: &'static str,    // "boxing" | "dance" | "fps-boxing"
}

pub async fn run(plugin: Arc<dyn GamePlugin + Send + Sync>, config: EngineConfig)
```

Everything currently in `main.rs` that is not plugin-specific moves into `lib.rs`: the Axum router, room manager, WS handlers, game loop, commentator, input delay, broadcast. The lobby HTML multi-game picker is removed.

### Game server binaries (~10 lines each)

```rust
// games/boxing/server/src/main.rs
#[tokio::main]
async fn main() {
    let plugin = BoxingPlugin::new(BoxingConfig::default());
    engine_core::run(Arc::new(plugin), EngineConfig {
        port: 8001,
        client_dist: "games/boxing/client/dist",
        game_name: "boxing",
    }).await;
}
```

Dance and fps-boxing follow the same pattern on ports 8002 and 8003.

### Cargo workspace

The workspace root (`engine/Cargo.toml`) gains the 3 game server crates as members so `cargo build --workspace` builds everything at once. Game plugin crates also join the workspace via path dependencies.

### Lobby per game

Each game owns its lobby UI (room code entry, game-specific branding, styling). The engine still provides the room manager and `/rooms` POST endpoint — each game's frontend calls it against its own server. No cross-game lobby picker exists anywhere in the Rust layer.

---

## Frontend Split

### Boxing client (`games/boxing/client/`)

Merges components from current `mobile/` and `overlay/`:

From `mobile/`: `CameraView`, `CalibrationOverlay`, `AvatarCanvas`, `ConnectionScreen`, `GameScreen`, `HitFlash`, `StatusBar`, `CommentarySubtitle`

From `overlay/`: `PixiCanvas`, `HudLayer`, `ParallaxBackground`, `RoundOverlay`, `WaitingOverlay`, `SettingsPanel`

Adds: game-specific lobby page (room code entry, boxing branding).

### Dance client (`games/dance/client/`)

From `mobile/`: `CameraView`, `CalibrationOverlay`, `ConnectionScreen`, `GameScreen`, `StatusBar`

From `overlay/`: `DanceHud`, `PixiCanvas`, `HudLayer`, `ParallaxBackground`, `RoundOverlay`, `WaitingOverlay`

Adds: game-specific lobby page (dance branding).

### FPS-Boxing client (`games/fps-boxing/client/`)

Straight move of `fps/` as-is. It already integrates pose capture and rendering in one app. Adds: game-specific lobby page.

### Cleanup

`mobile/` and `overlay/` are deleted after the split is verified. Each client references `shared/` protocol types via relative `tsconfig.json` path, same as today.

---

## Scripts and Dev Experience

| Game | Server port | Vite dev port |
|------|-------------|---------------|
| boxing | 8001 | 5173 |
| dance | 8002 | 5174 |
| fps-boxing | 8003 | 5175 |

**Per-game scripts** follow the current `dev.sh` pattern: free ports, build client bundle, start Rust server, start Vite dev server with hot reload.

**`scripts/dev.sh`** runs all 3 in parallel as a convenience wrapper. Each game can also be started independently:

```bash
bash scripts/boxing.sh      # only boxing
bash scripts/dance.sh       # only dance
bash scripts/fps-boxing.sh  # only fps-boxing
```

---

## What Is Not Changing

- `shared/` TypeScript protocol types
- `plugin-trait` GamePlugin interface
- `boxing-core` combat math library
- Room manager, WS protocol, game loop, input delay logic
- MediaPipe pose estimation behavior
- Railway deployment config (out of scope)
