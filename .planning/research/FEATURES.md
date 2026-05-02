# Feature Research

**Domain:** Rust real-time pose-based game engine with plugin trait interface
**Researched:** 2026-05-01
**Confidence:** HIGH (engine/plugin interface design), MEDIUM (Rust trait ergonomics tradeoffs)

---

## Context: What We Are Building

The engine is a 60Hz authoritative WebSocket server. Games are added by implementing a single Rust trait. The boxing game is the first plugin and must prove the interface generalizes. A second game (dance/pose-match) must be buildable from the trait alone, without touching engine internals.

This research answers: what does the trait interface need to expose, what should it demand back, and what is table stakes for the boxing plugin?

---

## Feature Landscape

### Table Stakes (Engine Must Provide These to Be Usable)

Features a plugin author assumes the engine handles. Missing these means the plugin cannot function.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Per-tick pose frames for each player | Plugin needs raw keypoints to do any game logic | LOW | Engine drains input delay buffer, delivers `[PoseKeypoint; 33]` per player per tick |
| RTT-fairness input delay buffer | Without this, fast-network players have structural advantage; every game needs it | MEDIUM | Engine owns the buffer; plugin never sees timestamps directly, only released frames |
| Calibration result per player | Plugin needs reference velocity (or equivalent) to scale any body-relative threshold | LOW | Engine calls `on_calibration_complete(slot, reference_velocity)` after handshake |
| Player join/leave lifecycle hooks | Plugin must initialize and tear down per-player state | LOW | `on_player_join(slot)` / `on_player_leave(slot)` — required for any game |
| Broadcast to all clients | Plugin must be able to push events to overlay and player sockets | LOW | Engine provides a `broadcast(json)` fn passed into tick context, plugin never touches WebSocket directly |
| Room state read access (players connected, round number) | Plugin decisions depend on who is present | LOW | Engine passes `RoomView` (read-only) into every hook |
| Tick number and wall-clock elapsed | Plugin needs time for countdown, round duration, stalemate detection | LOW | Engine passes `TickInfo { tick: u64, elapsed_secs: f64, remaining_secs: f64 }` |
| Round lifecycle ownership in engine | Plugin declares round-over; engine handles broadcast and reset | MEDIUM | Plugin returns `Option<RoundOutcome>` from `on_tick`; engine triggers `MsgRoundEnd`, increments wins, calls `on_round_reset` |
| Warmup window suppression | 3.8s countdown before hit detection is live; every boxing-style game needs this | LOW | Engine zero-clears input buffers during warmup; plugin sees empty frame slices |
| Wire protocol compatibility | Clients are unchanged; Rust engine must produce identical JSON | HIGH | Engine serializes all wire messages; plugin only produces opaque `GameEvent` payloads for the `events` field |

### Table Stakes (Boxing Plugin Must Implement)

Features the boxing game is expected to have. These are the existing Python game's behaviour.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Body-local punch detection | Core game mechanic — existing Python `detect_punch` | HIGH | Wrist speed + height threshold against calibrated `reference_velocity`; 10-frame sliding window |
| Kick detection | Core game mechanic — existing Python `detect_kick` | MEDIUM | Ankle elevation + speed; weaker than punch damage |
| Body region classification | Hit location changes damage; overlay needs region for spark position | MEDIUM | 9 regions: head_chin, head_face, head_throat, torso_upper, torso_lower, block_hand, block_forearm, leg_thigh, leg_shin |
| Guard blocking | Defender with raised wrists blocks head/upper-torso hits | MEDIUM | Existing Python guard zone logic using `_REL_GUARD_HEAD_Y`, `_REL_GUARD_TORSO_Y` |
| Velocity-scaled damage | Harder punch = more damage; calibration scales damage to player's natural speed | MEDIUM | Linear interpolation: 0→base_min, ref_vel→midpoint, 2×ref_vel→base_max |
| HP tracking per player (starting 800) | Existing game balance; KO at 0 HP | LOW | Plugin state owns `hp: [i32; 2]` |
| Hit cooldown (200ms / 12 ticks) | Prevents double-counting same punch | LOW | Per-attacker cooldown tick counter |
| Round-over detection (KO or time expiry) | Match progression | LOW | `_check_round_over` logic: HP=0 wins immediately, time expiry wins by HP |
| Round draw handling | Equal HP at time expiry | LOW | `winner = None` → draw case in `MsgRoundEnd` |
| Max rounds / match winner | Best-of-N structure | LOW | Engine tracks `wins: [u32; 2]`, plugin declares round outcome, engine checks `wins >= max_wins` |
| Calibration-persists-through-rematch fix | Known bug: `reset_for_rematch` currently clears `reference_velocity` | LOW | Bug fix during port — calibration is per-Room lifetime, not per-round |
| Solo / bot mode | Single-player practice; existing Python feature | MEDIUM | Bot injects static neutral pose as P2; scripted random hit timer with difficulty tiers (easy/normal/hard) |

### Differentiators (What Makes the Engine Extensible vs Monolithic)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Associated-type plugin state (`type State`) | Plugin owns its own game state struct with zero engine knowledge; engine stores `Box<dyn Any>` and downcasts only in plugin calls | MEDIUM | Key design choice — avoids engine carrying boxing-specific HP, round number, combo tracker in core |
| Single-trait implementation surface | An LLM or new developer can produce a working game in ~100 lines without reading engine internals | HIGH | Requires discipline: every input a plugin might need must come through context structs, not leaked engine fields |
| Context structs instead of mutable engine ref | `TickContext`, `JoinContext`, `CalibrationContext` passed by value/reference — plugin cannot mutate engine internals | MEDIUM | Forces clean boundary; analogous to Bevy's `PluginContext` approach |
| `GameEvent` enum for plugin output | Plugin returns typed events (hit detected, score changed, round over) rather than raw JSON; engine serializes them | MEDIUM | Keeps JSON wire format in engine; plugin stays ignorant of protocol details |
| `on_round_reset` hook | Plugin clears round-scoped state (HP, combo trackers) without touching match-scoped state (wins, calibration) | LOW | Critical for correct rematch behaviour; absent in current Python (hence the bug) |
| Pose coordinate normalization in engine | Engine delivers keypoints already in a consistent frame (hip-centred, Y-up); plugin never calls `_y_up()` | LOW | Currently Python `hit_detection.py` applies `_y_up` per call; engine should do this once |
| Second game validation (dance/pose-match) | Proves the interface generalizes before claiming it is clean | HIGH | Must implement a non-combat game using same trait; if it requires engine changes, interface is not generic enough |
| SDK documentation + boxing as example | Enables external developers (or Claude) to generate a new game from the trait alone | MEDIUM | Doc quality is what converts "good interface" into "actually usable SDK" |

### Anti-Features (Deliberately NOT in the Plugin Interface)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Plugin-controlled WebSocket send | Plugin might want to send player-specific messages (e.g., `you_were_hit`) | Exposes transport layer internals; plugin becomes coupled to Axum/Tokio types | Engine provides `send_to_player(slot, event)` through context — plugin declares intent, engine handles transport |
| Plugin-visible RTT / timestamp data | Might seem useful for game-specific fairness tuning | RTT fairness is a correctness concern for all games equally; per-game tuning creates unfair play and complexity | Engine owns the delay buffer; plugin never needs raw arrival timestamps |
| Async plugin methods | Rust async traits without `async-trait` crate are unstable/ergonomically awkward; GATs break `dyn Trait` | An async `on_tick` requires `async-trait` crate (boxing allocates per tick) or nightly; breaks object safety | All plugin methods are synchronous; async work (commentary, HTTP) lives in engine services called via `GameEvent` return values |
| Plugin-defined wire message types | Plugin might want custom JSON shapes for its clients | Breaks protocol compatibility; TypeScript clients would need updates per game | Plugin maps its internal events to the existing `game_state.recent_hits` + custom `events` field in `MsgGameState`; engine serializes |
| Commentary logic in plugin | Plugin might want to trigger AI commentary | Commentary is a cross-cutting concern; putting it in plugin couples audio pipeline to game logic | Engine exposes `CommentaryHint` event type that plugins can return; engine decides whether and how to generate commentary |
| Global mutable game registry | A runtime registry where plugins self-register (like Rust `inventory` / `linkme` crate) | Adds significant complexity; not needed when all games are compiled into same binary | Simple enum or `HashMap<&'static str, Box<dyn GamePlugin>>` registered at startup in `main.rs` |
| WASM / scripting plugin loading | Dynamic library loading for plugins at runtime | Out of scope per PROJECT.md; compile-time native Rust keeps hot path zero-cost | All plugins compiled into the binary; trait interface is the boundary, not a `.so` ABI |
| Persistent state across server restart | Plugin might want match history, player ratings | Out of scope per PROJECT.md; no external store | All room state is in-process memory; server restart clears rooms |

---

## Feature Dependencies

```
[Engine: RTT input delay buffer]
    └──required by──> [Boxing: punch/kick detection] (needs ordered, fairness-released frames)
    └──required by──> [Any pose-based game tick]

[Engine: calibration hook (on_calibration_complete)]
    └──required by──> [Boxing: velocity-scaled damage]
    └──required by──> [Boxing: body-relative threshold scaling]

[Boxing: body region classification]
    └──required by──> [Boxing: guard blocking]
    └──required by──> [Boxing: velocity-scaled damage]
    └──required by──> [Engine: HitEvent position for overlay sparks]

[Boxing: HP tracking]
    └──required by──> [Boxing: round-over detection]
    └──required by──> [Engine: round lifecycle broadcast]

[Engine: on_round_reset hook]
    └──required by──> [Bug fix: calibration persists through rematch]
    └──required by──> [Multi-round matches]

[Second game (dance/pose-match)]
    └──validates──> [Plugin trait interface generality]
    └──must not require──> [Engine changes]
```

### Dependency Notes

- **RTT input delay buffer required by punch detection:** The existing Python `compute_cutoff` must be ported to the Rust engine core and be transparent to plugins. The plugin only ever sees already-released frames.
- **`on_round_reset` required by calibration bug fix:** The fix is: calibration lives on `PlayerSlot` (Room lifetime), round-reset lives in `on_round_reset` (round lifetime). Without this hook, plugins either reset calibration on rematch (bug) or carry all state in a single blob.
- **Second game validates interface generality:** A dancing/pose-match game has no HP, no hit detection, no velocity scaling. If implementing it requires adding engine primitives, those primitives belong in the engine. If it fits the same trait, the trait is generic.

---

## MVP Definition

### Launch With (v1 — Engine + Boxing Plugin)

Minimum that validates the engine concept and fixes known bugs.

- [ ] Engine: `GamePlugin` trait with `on_tick`, `on_player_join`, `on_player_leave`, `on_calibration_complete`, `on_round_reset`, `init_state` — synchronous, object-safe
- [ ] Engine: `TickContext` struct carrying released pose frames, tick info, room view, send-to-player fn, broadcast fn
- [ ] Engine: `GameEvent` enum covering at minimum: `Hit { slot, region, damage, position }`, `RoundOver { winner: Option<u8> }`, `SendToPlayer { slot, payload }`
- [ ] Engine: RTT input delay buffer ported to Rust, called before `on_tick`
- [ ] Engine: warmup suppression (zero-clear buffers during 3.8s countdown)
- [ ] Engine: round lifecycle driven by `RoundOver` event (engine handles `MsgRoundEnd`, win counter increment, `on_round_reset` call)
- [ ] Boxing plugin: `detect_punch`, `detect_kick`, guard blocking, region classification, velocity-scaled damage, HP tracking, round-over conditions
- [ ] Boxing plugin: solo/bot mode ported
- [ ] Bug fix: calibration not reset on `on_round_reset` (only HP, cooldown, combo trackers reset)
- [ ] Bug fix: spectator reconnect sends cumulative `MsgGameState` snapshot (engine responsibility, not plugin)

### Add After Validation (v1.x — Second Game + SDK)

Add once boxing game is running on Rust engine and confirmed wire-compatible.

- [ ] Dance/pose-match second game plugin — validates trait generality
- [ ] SDK documentation: trait interface reference + boxing annotated walkthrough
- [ ] Commentary `CommentaryHint` event type for plugin-driven commentary triggers

### Future Consideration (v2+ — AI Generation)

Defer until engine and SDK are proven and a second human-authored game exists.

- [ ] AI game generation: Claude generates a plugin from natural language description
- [ ] Browser-based game IDE / preview tooling

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `GamePlugin` trait definition | HIGH | MEDIUM | P1 |
| `TickContext` / `GameEvent` structs | HIGH | MEDIUM | P1 |
| RTT buffer in Rust engine | HIGH | MEDIUM | P1 |
| Boxing: punch/kick detection port | HIGH | HIGH | P1 |
| Boxing: damage + region + guard | HIGH | MEDIUM | P1 |
| Bug fix: calibration persists rematch | HIGH | LOW | P1 |
| Bug fix: spectator state snapshot on join | MEDIUM | LOW | P1 |
| Warmup window suppression | MEDIUM | LOW | P1 |
| Round lifecycle (RoundOver event → engine) | HIGH | MEDIUM | P1 |
| Solo/bot mode port | MEDIUM | MEDIUM | P2 |
| Dance/pose-match second plugin | HIGH (validates SDK) | HIGH | P2 |
| SDK documentation | HIGH (long-term payoff) | MEDIUM | P2 |
| `CommentaryHint` event type | LOW | LOW | P3 |
| AI game generation | HIGH (stretch goal) | VERY HIGH | P3 |

**Priority key:**
- P1: Required for engine + boxing to be wire-compatible and bug-free
- P2: Required to validate the "extensible engine" claim
- P3: Long-term payoff, defer until P1+P2 proven

---

## Trait Interface Design Notes

These are findings from researching Rust trait patterns that directly constrain feature decisions.

### Object Safety is Non-Negotiable

The engine stores plugins as `Box<dyn GamePlugin>` so multiple game types can coexist at runtime (one per room). This requires the trait to be object-safe:

- **No generic methods** on the trait (e.g., `fn on_tick<S: State>` breaks object safety)
- **No `impl Trait` in return position** (breaks dyn dispatch)
- **No `Self` in return types** (except `Box<Self>` or `&Self`)
- **Associated types are allowed** IF they are concrete per-impl — but if the engine needs to store `Box<dyn GamePlugin>`, associated types must be elided or type-erased

The cleanest solution for plugin-owned state: **no associated type on the trait itself**. Plugin state lives in `Box<dyn Any + Send>` stored by the engine, keyed by room. The trait's `on_tick` receives `&mut dyn Any`, and each plugin impl downcasts it. This is the pattern used by Bevy's resource system and `downcast-rs`.

### No Async Plugin Methods

`async fn` in traits is not object-safe without `async-trait` (which allocates a `Box<dyn Future>` per call — unacceptable in a 60Hz hot path). All plugin methods must be synchronous. Async work (commentary HTTP, ElevenLabs TTS) belongs in engine services triggered by `GameEvent` variants returned from the plugin, not called directly by the plugin.

### Provided Methods for Defaults

Bevy's `Plugin` trait uses provided methods with no-op defaults (`fn ready`, `fn finish`, `fn cleanup`). The `GamePlugin` trait should follow this: only `on_tick` and `init_state` are required; `on_player_join`, `on_player_leave`, `on_calibration_complete`, `on_round_reset` have default no-op implementations. This keeps simple games (e.g., a score counter) minimal.

### Context Structs Over Mutable Engine Ref

Passing `&mut Engine` to plugin methods (as some engines do) leaks internals and makes the interface impossible to document cleanly. The pattern is `TickContext<'_>` — a struct the engine constructs per tick containing only what the plugin is allowed to read or call. This is also consistent with Bevy's `PluginContext`.

---

## Sources

- Bevy `Plugin` trait: https://docs.rs/bevy/latest/bevy/prelude/trait.Plugin.html
- Fyrox plugin trait (lifecycle + `PluginContext`): https://fyrox.rs/blog/post/feature-highlights-0-27/
- ggez `EventHandler` trait: https://docs.rs/ggez/latest/ggez/event/trait.EventHandler.html
- Rust `dyn Trait` vs generics tradeoffs: https://quinedot.github.io/rust-learning/dyn-trait-vs.html
- Object safety (dyn compatibility): https://quinedot.github.io/rust-learning/dyn-safety.html
- `Box<dyn T>` with associated types: https://users.rust-lang.org/t/box-dyn-t-where-t-has-associated-types-that-are-traits/116380
- Turn-based Rust multiplayer: GameState + validate/consume pattern: https://herluf-ba.github.io/making-a-turn-based-multiplayer-game-in-rust-02-game-logic-and-server
- Authoritative multiplayer tick design (Nakama): https://heroiclabs.com/docs/nakama/concepts/multiplayer/authoritative/
- Existing Python game_loop.py, hit_detection.py, damage.py — primary source for boxing feature spec

---

*Feature research for: Rust pose-based game engine with plugin trait interface*
*Researched: 2026-05-01*
