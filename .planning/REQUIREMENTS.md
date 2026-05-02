# Requirements: PoseEngine

**Defined:** 2026-05-01
**Core Value:** The engine must make it trivially easy to add a new pose-based game by implementing a well-defined plugin interface — without touching the engine core or understanding its internals.

## v1 Requirements

### Engine Core

- [ ] **ENG-01**: WebSocket server exposes `/ws/player/{room_code}` and `/ws/spectator/{room_code}` endpoints using Axum + Tokio
- [ ] **ENG-02**: Room registry uses DashMap with 6-char alphanumeric code generation; rooms created on demand
- [ ] **ENG-03**: Each room runs as an independent Tokio task (actor model) exclusively owning all per-room state; no cross-room shared mutexes
- [ ] **ENG-04**: 60Hz game loop driven by `tokio::time::interval` with `MissedTickBehavior::Skip` inside the room actor's `select!` loop
- [ ] **ENG-05**: Each player connection has a dedicated outbound Tokio task with a bounded `mpsc` channel; game loop never calls `ws.send().await` directly
- [ ] **ENG-06**: RTT input delay buffer (fairness cutoff) ported from Python `input_delay.py`; plugin receives only already-released frames in each tick
- [ ] **ENG-07**: Pose data fan-out: `MsgPoseUpdate` broadcast to spectators immediately on frame arrival, independent of game loop tick rate
- [ ] **ENG-08**: Two broadcast channels per room — fast path for pose updates, slow path for game state and lifecycle events
- [ ] **ENG-09**: 3.8-second warmup window zeroes the input buffer; plugin receives empty frame slices during warmup
- [ ] **ENG-10**: Round lifecycle managed by engine: on `RoundOver` event from plugin, engine broadcasts `MsgRoundEnd`, increments win counter, calls `on_round_reset`
- [ ] **ENG-11**: Calibration handshake: engine calls `on_calibration_complete(slot, reference_velocity)` after both players submit; game loop starts once both are calibrated
- [ ] **ENG-12**: Static file serving of `mobile/dist` at `/mobile` and `overlay/dist` at `/overlay` (same paths as Python server)
- [ ] **ENG-13**: Joinable Tokio task handles tracked with abort-on-drop guarantee; no zombie game loop tasks after room teardown

### Protocol

- [ ] **PROTO-01**: All wire message types modelled in Rust with `serde_json` using `#[serde(tag = "type")]`; field names, discriminators, and optional fields match `shared/protocol.ts` exactly
- [ ] **PROTO-02**: Golden-file roundtrip tests: each message type serialized in Rust and compared to reference JSON fixtures; suite runs in CI
- [ ] **PROTO-03**: `shared/protocol.ts` kept in sync with Rust models; generation script updated or replaced

### Plugin Trait

- [ ] **PLUG-01**: `GamePlugin` trait defines: `init_state() -> Box<dyn Any + Send>`, `on_tick(&self, ctx: &mut TickContext, state: &mut dyn Any) -> Vec<GameEvent>`, plus `on_player_join`, `on_player_leave`, `on_calibration_complete`, `on_round_reset` with default no-op implementations
- [ ] **PLUG-02**: `TickContext` struct carries: released pose frames per player slot, `TickInfo { tick, elapsed_secs, remaining_secs }`, `RoomView` (read-only player count/slot state), and helper methods for broadcasting and sending to individual players
- [ ] **PLUG-03**: `GameEvent` enum covers at minimum: `Hit { attacker, defender, region, damage, position }`, `RoundOver { winner: Option<u8> }`, `SendToPlayer { slot, payload }`, `CommentaryHint { kind, payload }`
- [ ] **PLUG-04**: Plugin state stored as `Box<dyn Any + Send>` per room in the engine; each plugin downcasts it in its own methods — engine never inspects plugin state
- [ ] **PLUG-05**: Trait is fully object-safe (`Box<dyn GamePlugin + Send>` usable); all methods synchronous (no `async fn`)
- [ ] **PLUG-06**: Engine delivers pose keypoints normalized to hip-centred Y-up coordinates before passing to plugin; plugin never calls coordinate transforms

### Boxing Plugin

- [ ] **BOX-01**: Punch detection: wrist speed exceeds calibrated threshold over a 10-frame sliding window; direction and height classify as valid punch
- [ ] **BOX-02**: Kick detection: ankle elevation + speed exceeds calibrated threshold
- [ ] **BOX-03**: Body region classification: 9 regions (head_chin, head_face, head_throat, torso_upper, torso_lower, block_hand, block_forearm, leg_thigh, leg_shin)
- [ ] **BOX-04**: Guard blocking: defender with wrists above guard threshold blocks head/upper-torso hits
- [ ] **BOX-05**: Velocity-scaled damage: damage scales linearly with attacker velocity relative to calibrated `reference_velocity`
- [ ] **BOX-06**: HP tracking: 800 HP per player; round over when HP reaches 0 (KO) or 90-second timer expires (decision by HP)
- [ ] **BOX-07**: Hit cooldown: 12-tick (200ms) per-attacker lockout after each hit to prevent double-counting
- [ ] **BOX-08**: Round draw handling: equal HP at time expiry produces a draw outcome
- [ ] **BOX-09**: Multi-round match: engine-tracked win counter; match ends when a player reaches `max_wins`
- [ ] **BOX-10**: Solo/bot mode: server-injected static pose for P2 slot with scripted random hit timer; three difficulty tiers (easy/normal/hard)

### Bug Fixes

- [ ] **FIX-01**: Calibration persists through rematch — `reference_velocity` stored on `PlayerSlot` for the Room lifetime; `on_round_reset` clears only round-scoped state (HP, cooldown counters, combo trackers)
- [ ] **FIX-02**: Spectator reconnect state restoration — on spectator WebSocket connect, engine sends a snapshot of current HP, wins, round number, and elapsed time before the client enters the live broadcast stream

### Reference Game

- [ ] **GAME2-01**: A second game plugin (dance scoring, pose-match, or equivalent non-combat game) implemented using the `GamePlugin` trait
- [ ] **GAME2-02**: Second game requires zero changes to engine code; any trait additions needed to support it are considered interface bugs

### SDK

- [ ] **SDK-01**: `GamePlugin` trait and all context/event types documented with Rustdoc; method-level documentation explains intent and lifetime guarantees
- [ ] **SDK-02**: Boxing plugin serves as an annotated worked example in the repository README or developer guide
- [ ] **SDK-03**: README explains how to add a new game in concrete steps (implement trait, register plugin, done)

---

## v2 Requirements

### Commentary

- **COMM-01**: AI commentary engine ported to Rust — Claude API integration via `reqwest` (raw Messages API or `async-anthropic` crate) producing streamed text tokens
- **COMM-02**: ElevenLabs TTS integration — commentary text chunks sent to ElevenLabs, audio chunks broadcast as `commentary_audio` messages
- **COMM-03**: Commentary triggered by `CommentaryHint` events returned from plugins; commentary engine is a separate Tokio task isolated from game loop
- **COMM-04**: Commentary priority queue and cooldown logic ported from Python (prevents rapid-fire commentary)

### AI Game Generation

- **AI-01**: Claude generates a `GamePlugin` implementation from a plain-English game description (deferred until SDK is proven)

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| WASM / dynamic plugin loading | Compile-time native Rust is sufficient; runtime plugin loading adds significant complexity |
| Async plugin methods | Breaks object safety; `async-trait` allocates per call at 60Hz; all side effects via returned `GameEvent` |
| Plugin-visible WebSocket types | Transport layer internals stay in engine; plugin uses `send_to_player` / `broadcast` helpers |
| User accounts / authentication | 6-char room code model retained; security model unchanged from Python |
| Horizontal scaling / room sharding | Single-process Tokio is sufficient for current use case |
| Persistent state (match history, ratings) | No external store; server restart clears all rooms |
| Browser-based game IDE | Deferred until AI generation is tackled |
| TypeScript client changes | Mobile and overlay apps are unchanged; engine must speak existing wire protocol |
| Python server kept running in parallel | Full cutover on completion; no hybrid deployment |

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ENG-01 | Phase 1 | Pending |
| ENG-02 | Phase 1 | Pending |
| ENG-03 | Phase 1 | Pending |
| ENG-04 | Phase 1 | Pending |
| ENG-05 | Phase 1 | Pending |
| ENG-06 | Phase 1 | Pending |
| ENG-07 | Phase 1 | Pending |
| ENG-08 | Phase 1 | Pending |
| ENG-09 | Phase 1 | Pending |
| ENG-10 | Phase 1 | Pending |
| ENG-11 | Phase 1 | Pending |
| ENG-12 | Phase 1 | Pending |
| ENG-13 | Phase 1 | Pending |
| PROTO-01 | Phase 1 | Pending |
| PROTO-02 | Phase 1 | Pending |
| PROTO-03 | Phase 1 | Pending |
| FIX-02 | Phase 1 | Pending |
| PLUG-01 | Phase 2 | Pending |
| PLUG-02 | Phase 2 | Pending |
| PLUG-03 | Phase 2 | Pending |
| PLUG-04 | Phase 2 | Pending |
| PLUG-05 | Phase 2 | Pending |
| PLUG-06 | Phase 2 | Pending |
| BOX-01 | Phase 2 | Pending |
| BOX-02 | Phase 2 | Pending |
| BOX-03 | Phase 2 | Pending |
| BOX-04 | Phase 2 | Pending |
| BOX-05 | Phase 2 | Pending |
| BOX-06 | Phase 2 | Pending |
| BOX-07 | Phase 2 | Pending |
| BOX-08 | Phase 2 | Pending |
| BOX-09 | Phase 2 | Pending |
| BOX-10 | Phase 2 | Pending |
| FIX-01 | Phase 2 | Pending |
| GAME2-01 | Phase 3 | Pending |
| GAME2-02 | Phase 3 | Pending |
| SDK-01 | Phase 3 | Pending |
| SDK-02 | Phase 3 | Pending |
| SDK-03 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 39 total
- Mapped to phases: 39/39
- Unmapped: 0

---
*Requirements defined: 2026-05-01*
*Last updated: 2026-05-01 — traceability populated after roadmap creation*
