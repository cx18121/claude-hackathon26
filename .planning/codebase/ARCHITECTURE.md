<!-- refreshed: 2026-05-02 -->
# Architecture

**Analysis Date:** 2026-05-02

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Client Layer                                       │
├───────────────────────────────────┬─────────────────────────────────────────┤
│         Mobile App (React)        │         Overlay App (React + Pixi.js)   │
│  `mobile/src/`                    │  `overlay/src/`                          │
│  - MediaPipe pose capture         │  - Spectator-only WebSocket              │
│  - Calibration flow               │  - Pixi.js silhouette renderer           │
│  - Sends pose_frame @ 60Hz        │  - HUD, commentary, SFX                  │
└────────────┬──────────────────────┴────────────────┬────────────────────────┘
             │ WS /ws/player/{room}                   │ WS /ws/spectator/{room}
             │ (pose_frame, calibration_done, ping)   │ (read-only)
             ▼                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FastAPI WebSocket Server  `server/`                       │
│                                                                              │
│  main.py          rooms.py          game_loop.py      commentator.py         │
│  (routes/WS)      (RoomManager,     (GameLoop,         (Claude + ElevenLabs  │
│                    RoomState,        60Hz tick,          TTS, async stream)   │
│                    PlayerSlot)       hit detection)                           │
│                                                                              │
│  hit_detection.py   damage.py   input_delay.py   broadcast.py               │
│  (detect_punch,     (region     (RTT fairness    (fan-out to                 │
│   detect_kick)       damage)     cutoff)          spectators)                │
└─────────────────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Shared Type Contract  `shared/protocol.ts`  ←→  `server/protocol.py`       │
│  (generated in sync; wire message types for all three processes)             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| FastAPI app | HTTP routes, WS endpoints, static serving, lifespan | `server/main.py` |
| RoomManager | Room creation, lookup, 6-char code generation | `server/rooms.py` |
| RoomState | Per-room mutable state: players, spectators, game_loop, scores | `server/rooms.py` |
| PlayerSlot | Per-player WS ref, pose buffer, RTT samples, calibration ref_velocity | `server/rooms.py` |
| GameLoop | 60Hz async tick, input delay buffer, round lifecycle | `server/game_loop.py` |
| hit_detection | Body-local punch/kick detection using wrist/ankle speed + position | `server/hit_detection.py` |
| damage | Region-to-damage mapping scaled by attacker reference velocity | `server/damage.py` |
| input_delay | RTT-based fairness cutoff so slower player's frames are held briefly | `server/input_delay.py` |
| broadcast | Fan-out helper — sends one JSON string to all spectator WebSockets | `server/broadcast.py` |
| commentator | Claude (text) + ElevenLabs (TTS) AI commentary engine | `server/commentator.py` |
| protocol (Python) | Pydantic models for all wire messages; parse_mobile_msg dispatcher | `server/protocol.py` |
| protocol (TS) | TypeScript interfaces mirroring the Python models exactly | `shared/protocol.ts` |
| useGameSocket | Mobile WS lifecycle, reconnect, phase state machine | `mobile/src/hooks/useGameSocket.ts` |
| usePose | MediaPipe PoseLandmarker loop (rVFC or rAF) producing PoseKeypoint[] | `mobile/src/hooks/usePose.ts` |
| useCalibration | T-pose → 3-punch → neutral stage machine; emits reference_velocity | `mobile/src/hooks/useCalibration.ts` |
| GameScreen | Orchestrates camera, pose, calibration, pose-frame send loop | `mobile/src/components/GameScreen.tsx` |
| useSpectatorSocket | Overlay WS; routes game_state/pose_update/round events into React state | `overlay/src/hooks/useSpectatorSocket.ts` |
| PixiCanvas | Pixi.js ticker; forward-extrapolates poses and draws silhouettes + sparks | `overlay/src/components/PixiCanvas.tsx` |
| interpolate | Hermite interpolation + linear forward extrapolation of PoseKeypoint[] | `overlay/src/lib/interpolate.ts` |

## Pattern Overview

**Overall:** Event-driven actor model over WebSocket

**Key Characteristics:**
- Server is the single source of truth for game state, scores, hit detection, and round lifecycle
- Mobile clients are pure input devices: they capture pose and stream it; they never do hit detection
- Overlay is a pure rendering client: it has a spectator-only WS and cannot send game messages
- Shared protocol types are generated (`scripts/gen_protocol.py`) so Python and TypeScript stay in sync
- The 60Hz game loop and the pose stream are intentionally decoupled channels: `pose_update` flows at mobile capture rate; `game_state` flows at server tick rate

## Layers

**Transport / Protocol:**
- Purpose: Define all wire message shapes shared between all three processes
- Location: `shared/protocol.ts`, `server/protocol.py`
- Contains: Message interface definitions, union discriminator types
- Depends on: Nothing
- Used by: All three processes

**Server — HTTP/WS Layer:**
- Purpose: Accept connections, manage room lifecycle, route messages
- Location: `server/main.py`
- Contains: FastAPI route handlers, WebSocket handlers for `/ws/player` and `/ws/spectator`, lifespan startup/shutdown, static file serving of built `mobile/dist` and `overlay/dist`
- Depends on: `rooms.py`, `game_loop.py`, `protocol.py`, `broadcast.py`, `qr.py`, `tunnel.py`
- Used by: HTTP clients and WebSocket clients

**Server — Game Domain:**
- Purpose: Implement fight mechanics
- Location: `server/game_loop.py`, `server/hit_detection.py`, `server/damage.py`, `server/input_delay.py`
- Contains: 60Hz async loop, pose-frame input buffers, hit detection algorithms, damage scaling, RTT-fairness cutoff
- Depends on: `rooms.py`, `protocol.py`, `broadcast.py`, `commentator.py`
- Used by: `main.py` (spawns `GameLoop` as asyncio task)

**Server — Room State:**
- Purpose: Hold all mutable per-room data
- Location: `server/rooms.py`
- Contains: `RoomState` dataclass, `PlayerSlot` dataclass, `RoomManager` dict-backed registry
- Depends on: `input_delay.py` (re-exports `record_pong`, `median_rtt`)
- Used by: `main.py`, `game_loop.py`, `broadcast.py`

**Mobile — Capture Layer:**
- Purpose: Drive camera, run MediaPipe, produce PoseKeypoint[] per frame
- Location: `mobile/src/hooks/usePose.ts`, `mobile/src/hooks/useCamera.ts`
- Contains: PoseLandmarker initialization, rVFC/rAF capture loop, GPU delegate
- Depends on: `@mediapipe/tasks-vision`, `@shared/protocol`
- Used by: `GameScreen.tsx`

**Mobile — Calibration Layer:**
- Purpose: Establish per-player reference velocity used by server hit/damage scaling
- Location: `mobile/src/hooks/useCalibration.ts`, `mobile/src/lib/velocity.ts`
- Contains: T-pose stage, 3-punch stage, neutral settle stage; emits `calibration_done` to server
- Depends on: `velocity.ts`, `@shared/protocol`
- Used by: `GameScreen.tsx`

**Mobile — Connection Layer:**
- Purpose: WebSocket lifecycle, reconnect, phase state machine
- Location: `mobile/src/hooks/useGameSocket.ts`
- Contains: WS open/close/reconnect, ping/pong RTT measurement, message dispatch, `connect`/`disconnect`/`playAgain` actions
- Depends on: `@shared/protocol`
- Used by: `App.tsx`

**Overlay — Socket Layer:**
- Purpose: Spectator WS, fan-in of all server messages into React state
- Location: `overlay/src/hooks/useSpectatorSocket.ts`
- Contains: Pose stream (mutated in-place via ref, no re-render), game_state state, round/match lifecycle state, reconnect
- Depends on: `@shared/protocol`
- Used by: `App.tsx`

**Overlay — Render Layer:**
- Purpose: GPU-accelerated silhouette rendering + spark particles
- Location: `overlay/src/components/PixiCanvas.tsx`, `overlay/src/lib/interpolate.ts`, `overlay/src/lib/sparks.ts`
- Contains: Pixi.js Application, per-player layer stacks (shadow/trail/rim/glow/main), forward pose extrapolation, hit spark emitter
- Depends on: `pixi.js`, `useSpectatorSocket.ts`, `interpolate.ts`, `sparks.ts`, `sfx.ts`
- Used by: `App.tsx`

## Data Flow

### Pose Frame Path (mobile → overlay)

1. Camera frame committed → `usePose` runs `detectForVideo` (`mobile/src/hooks/usePose.ts`)
2. `keypoints` state updated → `GameScreen` sends `pose_frame` JSON at 60Hz cap (`mobile/src/components/GameScreen.tsx`)
3. `ws_player` receives `pose_frame` → stores on `slot.latest_pose`, calls `game_loop.add_pose_frame` (`server/main.py:549-551`)
4. `ws_player` also immediately fans out `pose_update` to all spectators (`server/main.py:556-567`)
5. `useSpectatorSocket` receives `pose_update` → mutates `poseStreamRef` in-place, no React re-render (`overlay/src/hooks/useSpectatorSocket.ts:160-179`)
6. Pixi.js ticker reads `poseStreamRef`, calls `extrapolatePosesInto`, calls `drawBoxer` (`overlay/src/components/PixiCanvas.tsx:453-534`)

### Hit Detection Path (server-authoritative)

1. `GameLoop._tick()` runs every ~16.7ms (`server/game_loop.py:275`)
2. `compute_cutoff` determines which frames are old enough to release (RTT fairness) (`server/input_delay.py:32`)
3. Frames drained from `_buffers` into `_processed` deques (`server/game_loop.py:315-319`)
4. `detect_punch` / `detect_kick` run against 10-frame window per attacker (`server/hit_detection.py:220-291`)
5. If hit: `compute_damage` scales by attacker `reference_velocity` and region (`server/damage.py:16`)
6. HP updated, `you_were_hit` sent to defender WS, `HitEvent` added to `recent_hits`
7. `MsgGameState` broadcast to all spectators with `recent_hits` (`server/game_loop.py:399-408`)
8. `PixiCanvas` receives `game_state` → `SparkEmitter.emit` at hit position, SFX plays (`overlay/src/components/PixiCanvas.tsx:596-616`)

### Calibration Path

1. Both players connect → server sends `calibration_start` to both (`server/main.py:526-529`)
2. `useGameSocket` sets phase to `'calibration'` → `GameScreen` activates `useCalibration`
3. `useCalibration` runs T-pose → punches → neutral stages (`mobile/src/hooks/useCalibration.ts`)
4. On complete: `calibration_done` with `reference_velocity` sent to server
5. Once both players calibrated: `GameLoop` created, `MsgMatchStart` broadcast (`server/main.py:582-593`)

### Commentary Path

1. `GameLoop._emit_hit_commentary` classifies hit as `first_blood`/`combo`/`comeback`/`low_hp`/`hit` (`server/game_loop.py:415-479`)
2. `CommentaryEngine.event(kind, payload)` enqueues the event (`server/commentator.py`)
3. `_run_loop` dequeues, calls Claude API with streaming (`claude-haiku-4-5` default)
4. Token deltas broadcast as `commentary_text`; sentence boundaries trigger ElevenLabs TTS
5. Audio chunks broadcast as `commentary_audio` (base64 MP3)
6. `useCommentary` in overlay plays audio + shows subtitle (`overlay/src/hooks/useCommentary.ts`)

**State Management:**
- Server: pure Python dataclasses (`RoomState`, `PlayerSlot`) stored in `RoomManager._rooms` dict — in-process only, no external store
- Mobile: React `useState` in `useGameSocket` hook; pose data flows through `useState` from `usePose`
- Overlay: React state for round/match lifecycle; pose stream kept in `useRef` (mutated in-place) to avoid re-renders on every frame

## Key Abstractions

**RoomState:**
- Purpose: All per-match server-side mutable state
- Examples: `server/rooms.py:28`
- Pattern: Python `@dataclass` with helper methods (`add_spectator`, `reset_for_rematch`)

**PlayerSlot:**
- Purpose: Per-player connection state plus calibration and RTT data
- Examples: `server/rooms.py:17`
- Pattern: Python `@dataclass`; `ws` field is `None` when disconnected

**GameLoop:**
- Purpose: Encapsulates the 60Hz fight loop and all round lifecycle transitions for one room
- Examples: `server/game_loop.py:86`
- Pattern: Long-lived `asyncio.Task`; started when both players calibrate, stopped on match end or both disconnect

**PoseKeypoint:**
- Purpose: Single landmark position (x, y, z, visibility) in MediaPipe world coordinate space (metres, hip-centred)
- Examples: `shared/protocol.ts:7`, `server/protocol.py`
- Pattern: Plain data, same struct in Python (Pydantic) and TypeScript (interface); used throughout the whole pipeline

**MsgGameState:**
- Purpose: Authoritative per-tick snapshot: HP, recent hits, remaining time, high-latency flag
- Examples: `shared/protocol.ts:115`
- Pattern: Server → overlay only; does NOT carry pose data (poses travel via `MsgPoseUpdate` on the fast path)

## Entry Points

**Server startup:**
- Location: `server/main.py:682` (`uvicorn.run`)
- Triggers: `python main.py` or Dockerfile `CMD`
- Responsibilities: Creates default room, optionally starts ngrok tunnel, mounts static SPA builds

**Player WebSocket:**
- Location: `server/main.py:447` (`@app.websocket("/ws/player/{room_code}")`)
- Triggers: Mobile app on connect
- Responsibilities: Slot assignment, reconnect detection, calibration handshake, pose frame routing, disconnect/forfeit handling

**Spectator WebSocket:**
- Location: `server/main.py:659` (`@app.websocket("/ws/spectator/{room_code}")`)
- Triggers: Overlay app on load
- Responsibilities: Subscribe to room broadcast, receive all game messages read-only

**Mobile App:**
- Location: `mobile/src/main.tsx`
- Triggers: Browser load on phone
- Responsibilities: Mount React tree; `App.tsx` reads URL params (`server`, `room`, `slot`)

**Overlay App:**
- Location: `overlay/src/main.tsx`
- Triggers: Browser load on display/projector
- Responsibilities: Mount React tree; `App.tsx` reads URL params (`server`, `room`)

## Architectural Constraints

- **Threading:** Python server is single-threaded asyncio. All game-loop ticks, WebSocket handlers, and commentary streaming share the same event loop. Blocking calls (tunnel startup) are offloaded via `asyncio.to_thread`.
- **Global state:** `room_manager` (module-level `RoomManager`) and `tunnel_manager` are module-level singletons in `server/main.py`. `_active_tasks: set[asyncio.Task]` tracks background tasks for clean shutdown.
- **Circular imports:** `game_loop.py` imports from `rooms.py`; `rooms.py` uses `TYPE_CHECKING` guard to import from `game_loop.py` indirectly (via `object` type annotation on `RoomState.game_loop`) to avoid the cycle.
- **No external state store:** All room state is in-process memory. A server restart clears all active rooms — no persistence, no Redis, no DB.
- **Pose coordinate system:** MediaPipe world landmarks are hip-centred, Y-positive-down. `hit_detection.py` uses a Y-up convention (`_y_up` function negates Y). `PixiCanvas.tsx` keeps Y-positive-down for screen projection.

## Anti-Patterns

### Pose data in game_state

**What happens:** `MsgGameState.poses` field exists in the protocol and was originally used to carry keypoints in the 60Hz tick.
**Why it's wrong:** At 60Hz with 2 players × 33 keypoints, this is ~120 JSON objects/sec through the slow path, adding latency to rendering.
**Do this instead:** Pose data must travel via `MsgPoseUpdate` (sent immediately in `main.py:ws_player` on each `pose_frame` arrival). The `poses` field in `game_state` is sent as empty arrays (`_EMPTY_POSES`) — this is the correct current behaviour in `server/game_loop.py:399`.

### Trusting client-supplied slot number

**What happens:** Mobile sends a `slot` query param and a `join` message body with `player_slot`.
**Why it's wrong:** The server assigns slots based on first available; a client cannot claim a specific occupied slot.
**Do this instead:** Always use `socket.assignedSlot` (set from the server's `joined` response) for any UI or logic that depends on which player you are. See `mobile/src/hooks/useGameSocket.ts:34` and `mobile/src/App.tsx:63`.

## Error Handling

**Strategy:** Log-and-continue on WebSocket send failures; prune dead connections from spectator sets

**Patterns:**
- All `await ws.send_text(...)` calls inside `try/except Exception: pass` — dead sockets are silently dropped
- Dead spectator WebSockets collected in a `dead: set` and removed after broadcast in `broadcast.py:14-23`
- `WebSocketDisconnect` caught at the top of each WS handler's `try/finally`; slot cleanup always runs in `finally`
- Python `log.warning` on bad/unparseable mobile messages; connection is kept open

## Cross-Cutting Concerns

**Logging:** Python `logging` module, `basicConfig(level=INFO)`, format `%(asctime)s %(message)s`. All server modules call `log = logging.getLogger(__name__)`.
**Validation:** Pydantic models for all incoming mobile messages via `parse_mobile_msg` in `server/protocol.py`; TypeScript type assertions on the client (no runtime validation library).
**Authentication:** None — rooms are protected only by the 6-character random code. No user accounts or tokens.

---

*Architecture analysis: 2026-05-02*
