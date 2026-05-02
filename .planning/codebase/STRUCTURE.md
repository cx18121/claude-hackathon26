# Codebase Structure

**Analysis Date:** 2026-05-02

## Directory Layout

```
claude-hackathon26/              # repo root
├── server/                      # Python FastAPI backend
│   ├── main.py                  # HTTP routes, WS endpoints, static serving, lifespan
│   ├── game_loop.py             # 60Hz GameLoop, round lifecycle, bot logic
│   ├── hit_detection.py         # detect_punch / detect_kick using body-local pose math
│   ├── damage.py                # Region-to-damage table, velocity scaling
│   ├── input_delay.py           # RTT-fairness cutoff, record_pong, median_rtt
│   ├── rooms.py                 # RoomState, PlayerSlot dataclasses, RoomManager
│   ├── broadcast.py             # broadcast_to_spectators fan-out helper
│   ├── commentator.py           # Claude + ElevenLabs AI commentary engine
│   ├── protocol.py              # Pydantic wire message models, parse_mobile_msg
│   ├── pose.py                  # Pose utility helpers
│   ├── qr.py                    # QR code generation for room setup page
│   ├── tunnel.py                # ngrok TunnelManager for local dev
│   ├── requirements.txt         # Python dependencies
│   ├── pytest.ini               # pytest config
│   └── tests/                   # Server unit tests
│       ├── test_damage.py
│       ├── test_game_loop.py
│       ├── test_hit_detection.py
│       ├── test_physics_polish.py
│       ├── test_rooms.py
│       ├── test_sprint1.py
│       ├── test_sprint2.py
│       └── test_sprint3.py
│
├── shared/                      # Cross-process contract (TypeScript only)
│   └── protocol.ts              # Generated TS interfaces for all wire messages
│
├── mobile/                      # React app — phone input client
│   ├── src/
│   │   ├── App.tsx              # Root: reads URL params, mounts ConnectionScreen or GameScreen
│   │   ├── main.tsx             # React entry point
│   │   ├── app.css              # Global styles
│   │   ├── index.css            # Base reset
│   │   ├── components/
│   │   │   ├── GameScreen.tsx   # Orchestrates camera + pose + calibration + send loop
│   │   │   ├── ConnectionScreen.tsx  # Pre-connection form (server URL, room code, slot)
│   │   │   ├── CalibrationOverlay.tsx
│   │   │   ├── CameraView.tsx
│   │   │   ├── HitFlash.tsx
│   │   │   ├── MatchEndScreen.tsx
│   │   │   ├── PoseOverlay.tsx
│   │   │   ├── AvatarCanvas.tsx
│   │   │   └── StatusBar.tsx
│   │   ├── hooks/
│   │   │   ├── useGameSocket.ts  # WebSocket lifecycle, reconnect, phase state machine
│   │   │   ├── usePose.ts        # MediaPipe PoseLandmarker capture loop
│   │   │   ├── useCalibration.ts # T-pose → punch → neutral calibration state machine
│   │   │   └── useCamera.ts      # getUserMedia camera setup
│   │   ├── lib/
│   │   │   ├── skeleton.ts       # Skeleton drawing helpers
│   │   │   └── velocity.ts       # Wrist velocity computation, TimedFrame type
│   │   └── test/                 # Vitest test files
│   │       ├── AvatarCanvas.test.tsx
│   │       ├── useCalibration.test.ts
│   │       ├── useGameSocket.test.ts
│   │       ├── skeleton.test.ts
│   │       └── velocity.test.ts
│   ├── public/                   # Static assets served by Vite
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
│
├── overlay/                      # React app — display/projector spectator client
│   ├── src/
│   │   ├── App.tsx              # Root: mounts all overlay layers, reads URL params
│   │   ├── main.tsx             # React entry point
│   │   ├── index.css            # Global styles
│   │   ├── components/
│   │   │   ├── PixiCanvas.tsx        # Pixi.js silhouette renderer + spark emitter
│   │   │   ├── HudLayer.tsx          # HP bars, timer, round number, connection indicator
│   │   │   ├── RoundOverlay.tsx      # 3-2-1-FIGHT! countdown, round end, match end screens
│   │   │   ├── WaitingOverlay.tsx    # Pre-match lobby (waiting for players)
│   │   │   ├── ParallaxBackground.tsx
│   │   │   ├── CommentarySubtitle.tsx
│   │   │   └── SettingsPanel.tsx     # Audio settings (commentary on/off, volume)
│   │   ├── hooks/
│   │   │   ├── useSpectatorSocket.ts  # Spectator WS, all server message routing
│   │   │   └── useCommentary.ts       # Commentary audio/subtitle playback
│   │   └── lib/
│   │       ├── interpolate.ts    # Hermite interpolation + forward extrapolation of poses
│   │       ├── sfx.ts            # Sound effect playback (hit_light, hit_heavy)
│   │       ├── skeleton.ts       # Skeleton drawing helpers (shared with mobile pattern)
│   │       └── sparks.ts         # SparkEmitter Pixi particle system
│   ├── public/
│   │   └── sfx/                  # Audio assets (.ogg / .mp3)
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
│
├── scripts/
│   ├── gen_protocol.py           # Generates shared/protocol.ts from server/protocol.py
│   ├── dev.sh                    # Local dev launcher
│   ├── tunnel.sh                 # Tunnel helper
│   └── tailscale.sh              # Tailscale network helper
│
├── docs/
│   ├── agents/                   # Agent skill docs (issue-tracker, domain, triage)
│   └── plans/                    # Historical planning documents
│
├── .planning/
│   └── codebase/                 # Codebase map documents (this directory)
│
├── .scratch/                     # Local issue tracker (markdown files)
├── Dockerfile                    # Multi-stage: overlay → mobile → python server
├── railway.toml                  # Railway deployment (dockerfile builder)
├── CONTEXT.md                    # Domain context document
├── DESIGN.md                     # Design notes
└── PRODUCT.md                    # Product specification
```

## Directory Purposes

**`server/`:**
- Purpose: The entire game backend. A single Python process serving HTTP, WebSocket, and static files.
- Contains: FastAPI app, game domain logic, AI commentary
- Key files: `main.py` (router), `game_loop.py` (core loop), `rooms.py` (state), `hit_detection.py` (physics)

**`shared/`:**
- Purpose: Single source of truth for wire protocol types shared between server and both frontends
- Contains: `protocol.ts` — generated by `scripts/gen_protocol.py` from `server/protocol.py`
- Key files: `protocol.ts`
- Note: NEVER edit `protocol.ts` by hand. Edit `server/protocol.py` and regenerate.

**`mobile/src/hooks/`:**
- Purpose: All stateful logic for the mobile client
- Contains: Socket lifecycle, MediaPipe pose loop, calibration state machine, camera setup

**`mobile/src/components/`:**
- Purpose: React UI components for the mobile client
- Contains: Screens (Connection, Game, MatchEnd) and sub-components (Camera, Calibration, HitFlash)

**`mobile/src/lib/`:**
- Purpose: Pure utility functions with no React dependency
- Contains: `velocity.ts` (wrist speed math), `skeleton.ts` (drawing helpers)

**`overlay/src/hooks/`:**
- Purpose: All stateful logic for the overlay spectator client
- Contains: Spectator WebSocket handler, commentary playback hook

**`overlay/src/components/`:**
- Purpose: React UI components for the overlay display
- Contains: Pixi.js canvas wrapper, HUD, round/match overlays, settings

**`overlay/src/lib/`:**
- Purpose: Pure utility functions (no React dependency) for rendering math
- Contains: `interpolate.ts` (pose extrapolation), `sfx.ts` (audio), `sparks.ts` (particles)

**`server/tests/`:**
- Purpose: Python unit tests for server game logic
- Contains: pytest test files covering damage, hit detection, game loop, rooms
- Note: Sprint-named files (`test_sprint1.py` etc.) are cumulative regression suites

**`scripts/`:**
- Purpose: Developer tooling
- Contains: Protocol code generation, dev server launcher, tunnel helpers

## Key File Locations

**Entry Points:**
- `server/main.py:682`: Server startup (`uvicorn.run`)
- `mobile/src/main.tsx`: Mobile React root
- `overlay/src/main.tsx`: Overlay React root

**Protocol Definition:**
- `server/protocol.py`: Pydantic models (authoritative source)
- `shared/protocol.ts`: Generated TypeScript mirror — run `python scripts/gen_protocol.py` to regenerate

**Core Game Logic:**
- `server/game_loop.py`: 60Hz loop, round transitions, hit processing, bot logic
- `server/hit_detection.py`: `detect_punch`, `detect_kick` public API
- `server/damage.py`: `compute_damage` public API
- `server/input_delay.py`: `compute_cutoff` public API

**WebSocket Handlers:**
- `server/main.py:447`: `ws_player` — player connection handler
- `server/main.py:659`: `ws_spectator` — spectator connection handler

**Rendering:**
- `overlay/src/components/PixiCanvas.tsx`: Pixi.js silhouette renderer (hot path)
- `overlay/src/lib/interpolate.ts`: Pose extrapolation math

**Calibration:**
- `mobile/src/hooks/useCalibration.ts`: Client-side calibration state machine
- `mobile/src/lib/velocity.ts`: Wrist velocity calculations used during calibration

## Naming Conventions

**Files:**
- Python server: `snake_case.py` (e.g., `game_loop.py`, `hit_detection.py`)
- TypeScript components: `PascalCase.tsx` (e.g., `PixiCanvas.tsx`, `GameScreen.tsx`)
- TypeScript hooks: `useCamelCase.ts` (e.g., `useGameSocket.ts`, `useSpectatorSocket.ts`)
- TypeScript utilities: `camelCase.ts` (e.g., `interpolate.ts`, `sfx.ts`, `velocity.ts`)
- Test files (Python): `test_<module>.py`
- Test files (TypeScript): `<Module>.test.tsx` or `<module>.test.ts`

**Directories:**
- Python modules: flat in `server/` (no subdirectories beyond `tests/`)
- TypeScript: `components/`, `hooks/`, `lib/` pattern used in both `mobile/src/` and `overlay/src/`

**Message Types:**
- Python Pydantic classes: `Msg<PascalCase>` (e.g., `MsgPoseFrame`, `MsgGameState`)
- TypeScript interfaces: same `Msg<PascalCase>` names

## Where to Add New Code

**New server game mechanic (hit type, damage modifier, etc.):**
- Implementation: `server/hit_detection.py` (detection) and/or `server/damage.py` (damage)
- Integration: call from `server/game_loop.py:_process_attacker`
- Tests: `server/tests/test_hit_detection.py` or `server/tests/test_damage.py`

**New wire message type:**
- Define Pydantic model in `server/protocol.py`
- Add to `parse_mobile_msg` if mobile-originated
- Regenerate TypeScript: `python scripts/gen_protocol.py`
- This updates `shared/protocol.ts` automatically

**New mobile UI screen or component:**
- Component: `mobile/src/components/<ComponentName>.tsx`
- Stateful logic: `mobile/src/hooks/use<FeatureName>.ts`
- Pure utilities: `mobile/src/lib/<featureName>.ts`

**New overlay visual effect or UI layer:**
- Component: `overlay/src/components/<ComponentName>.tsx`
- Rendering util: `overlay/src/lib/<featureName>.ts`
- If it needs server data: add handler in `overlay/src/hooks/useSpectatorSocket.ts`

**New mobile test:**
- Location: `mobile/src/test/<subject>.test.ts(x)`
- Framework: Vitest (`vitest run`)

**New server test:**
- Location: `server/tests/test_<module>.py`
- Framework: pytest (`pytest` from `server/` directory)

## Special Directories

**`.planning/codebase/`:**
- Purpose: Codebase map documents consumed by GSD planning and execution commands
- Generated: By `/gsd-map-codebase`
- Committed: Yes

**`.scratch/`:**
- Purpose: Local issue tracker (markdown files, see `docs/agents/issue-tracker.md`)
- Generated: By GSD agent tooling
- Committed: Yes

**`mobile/dist/`, `overlay/dist/`:**
- Purpose: Vite production build output; served by FastAPI as static files under `/mobile` and `/overlay`
- Generated: Yes (`npm run build` in each app directory)
- Committed: No (gitignored); the Dockerfile builds them in CI

**`server/__pycache__/`:**
- Generated: Yes (Python bytecode)
- Committed: No

---

*Structure analysis: 2026-05-02*
