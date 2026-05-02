# Pitfalls Research

**Domain:** Rust (Axum + Tokio) real-time WebSocket game server — 60Hz authoritative game loop
**Researched:** 2026-05-01
**Confidence:** HIGH (Tokio/Axum docs), MEDIUM (community patterns), HIGH (codebase-specific from CONCERNS.md audit)

---

## Critical Pitfalls

### Pitfall 1: Holding `std::sync::Mutex` Lock Across `.await` Points

**What goes wrong:**
An async task acquires `std::sync::Mutex` (from `std::sync`, not `tokio::sync`), then hits an `.await` while holding the guard. Tokio may suspend the task and schedule another task on the same worker thread. If that second task also tries to lock the same mutex, it blocks the thread — which prevents the first task from ever being rescheduled to release the lock. The result is a deadlock that does not produce a compiler error (when `MutexGuard` implements `Send`) and can be extremely hard to reproduce in tests.

The Python equivalent — `async with asyncio.Lock()` — is safe because asyncio explicitly yields the lock at the await point. Rust's `std::sync::Mutex` has no such protocol.

**Why it happens:**
`std::sync::Mutex` is the default muscle-memory import. The Tokio documentation itself recommends it for low-contention state, which developers read as "use it everywhere." The guidance only warns against holding it across `.await` in a separate paragraph that is easy to miss.

**How to avoid:**
- Default to `tokio::sync::Mutex` for all state shared across async tasks. Switch to `std::sync::Mutex` only after profiling proves it is a bottleneck and after confirming the lock is never held across `.await`.
- For the room registry (`HashMap<String, RoomState>`), wrap in `tokio::sync::RwLock` since reads (routing incoming WebSocket messages) vastly outnumber writes (room creation/deletion).
- The safest pattern for the hot path: extract all lock-protected operations into non-async helper methods. Acquire, operate, release — all without `.await` inside the critical section. The async caller only awaits after the guard is dropped.

**Warning signs:**
- Server hangs under load but not under light use.
- `tokio-console` shows tasks permanently blocked on a mutex with no thread making progress.
- The room count at hang time is always greater than the Tokio worker thread count.

**Phase to address:** Engine Core (room state + game loop infrastructure). Must be established in the initial skeleton before any game logic is wired in.

---

### Pitfall 2: The `MissedTickBehavior::Burst` Default Causes Catch-Up Avalanche

**What goes wrong:**
`tokio::time::interval` defaults to `MissedTickBehavior::Burst`. If one game tick takes longer than 16.67ms — because a slow WebSocket send, a brief mutex contention spike, or the commentary HTTP call briefly blocks the async executor — Tokio will fire subsequent ticks immediately with zero delay to "catch up". For a 60Hz game loop, missing even 2–3 ticks triggers a burst of 2–3 rapid ticks in a row. This produces a visible stuttering pattern: quiet → burst → quiet → burst, which is worse for gameplay than uniform slight slowdown.

**Why it happens:**
`Burst` is the default because it makes sense for cron-style tasks where catching up is correct. Game loops need `Skip` semantics: if a tick was missed, accept the miss and continue from the next regular interval.

**How to avoid:**
```rust
let mut interval = tokio::time::interval(Duration::from_millis(16)); // ~60Hz
interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
```
Additionally, keep each tick's work budget well under 16ms. Any operation that could take unbounded time (WebSocket send to a slow client, HTTP call) must be done outside the tick via a separate spawned task or a non-blocking channel send.

**Warning signs:**
- Observed tick timestamps cluster in pairs or triples rather than uniform 16ms spacing.
- Player complaints of "lag spikes" that feel double-speed briefly after a pause.
- Tick counter advances faster than wall-clock time over a short window.

**Phase to address:** Engine Core, game loop scaffolding. Set `MissedTickBehavior::Skip` as part of the first working tick loop; verify it in the deterministic tick tests before any game logic.

---

### Pitfall 3: WebSocket `send()` Stalls the Entire Game Loop

**What goes wrong:**
In the Python server, `await ws.send_text(...)` is safe because asyncio's event loop handles TCP flow-control transparently. In Tokio, an `await` on a WebSocket send blocks the current task when the TCP send buffer is full (client is slow or on a congested network). If the game loop task calls `sender.send(msg).await` for each connected player inline, a single slow client can hold up the entire 16ms tick budget — the loop waits for Player 1's TCP buffer to drain before even touching Player 2's send.

**Why it happens:**
The Python pattern of `await ws.send_text()` in a loop translates almost literally to Rust, so developers port it without questioning the concurrency model. In Python it "works" because the single-threaded event loop is already serializing everything; jitter is invisible. In Rust, the multi-threaded Tokio runtime makes stall-on-slow-client visible because other rooms' loops are trying to use the same worker threads.

**How to avoid:**
- Split each WebSocket into `(SplitSink, SplitStream)` at connection time.
- Each player/spectator connection gets a dedicated outbound task that owns its `SplitSink` and reads from an `mpsc::channel` (bounded, capacity ~4 frames).
- The game loop sends to the channel with `try_send` (non-blocking). If the channel is full, the message is dropped and the client is flagged as lagging (not the loop's problem).
- Never call `WebSocket::send().await` directly from the tick loop.

**Warning signs:**
- Tick timestamps become irregular specifically when a client's mobile network degrades.
- `tokio-console` shows the game loop task spending most of its time in a `SinkExt::send` future.
- All rooms exhibit jitter simultaneously when one player's connection degrades.

**Phase to address:** Engine Core, connection management. The outbound-task-per-connection pattern must be in place before broadcasting game state from the tick loop.

---

### Pitfall 4: `Arc<Mutex<RoomState>>` Contention From the Tick Loop and WebSocket Handlers Competing

**What goes wrong:**
The tick loop holds the `RoomState` lock for the full duration of hit detection, state updates, and broadcast preparation. Meanwhile, incoming WebSocket `pose_frame` messages need to append to the per-player input buffer — also inside `RoomState`. Under 60Hz ticks × N rooms, the input handler tasks spend most of their time blocked waiting for the tick loop to release the lock. This does not deadlock, but it creates lock contention that adds jitter to both tick timing and input latency.

The Python server avoids this because asyncio is single-threaded: only one coroutine runs at a time, so the "lock" is the event loop itself.

**How to avoid:**
- Do not put input buffers inside the same lock as the game state. Each player slot should own an `Arc<Mutex<VecDeque<PoseFrame>>>` (or a lockless `crossbeam::ArrayQueue`) that the WebSocket handler writes to, and the tick loop drains without competing for the main room lock.
- Keep the main `RoomState` lock only for the fields the tick loop actually mutates: HP, round number, win counters. Input buffers and WebSocket handles are separate.
- Use `tokio::sync::RwLock` for the room registry (`HashMap<RoomCode, Arc<Room>>`). Room routing (look up a room by code) is a read; room creation/deletion is a write. RwLock allows all rooms to serve incoming connections concurrently.

**Warning signs:**
- CPU usage is high but actual game-logic throughput is low under multi-room load.
- `tokio-console` shows many tasks waiting on the same mutex.
- Adding more rooms degrades per-room tick timing non-linearly (quadratic contention pattern).

**Phase to address:** Engine Core, data model design. Establish the input-buffer-separate-from-game-state invariant in the initial module structure.

---

### Pitfall 5: Dropping a `JoinHandle` Leaks the Game Loop Task

**What goes wrong:**
The Python server calls `game_loop.stop()` to set `running = False`, which terminates the loop. In Tokio, `handle.abort()` cancels a task — but dropping a `JoinHandle` does NOT cancel it. The task continues running in the background with no way to join or abort it. If the room is removed from the registry but the `JoinHandle` is dropped (not aborted), the game loop task runs forever, consuming CPU at 60Hz and holding `Arc` references to the room state — preventing the room from being dropped.

The Python CONCERNS.md already documents the analogous bug: `game_loop.stop()` calls `asyncio.create_task(commentator.stop())` without tracking the task, creating untracked orphan tasks. The Rust version has the same trap with more serious consequences.

**Why it happens:**
Developers coming from Python asyncio expect that destroying an object cancels its background work. Rust's RAII semantics for `JoinHandle` match `std::thread::JoinHandle` (detach on drop), not Python's task model.

**How to avoid:**
- Store each room's game loop `JoinHandle` inside the room struct or a task registry.
- When a room is removed (match over + all connections closed + TTL elapsed), call `handle.abort()` explicitly, then `await handle` (which completes immediately after abort) to flush cleanup.
- Use `tokio_util::task::AbortOnDropHandle` (or a custom wrapper) so that the game loop is automatically cancelled when the room is dropped from the registry.
- The room registry cleanup background task must hold abort handles, not just remove the `Arc<Room>` from the map.

**Warning signs:**
- Memory usage grows monotonically after many games even though the room map is small.
- CPU stays elevated at 60Hz × zombie-room-count after rooms should be idle.
- Reconnecting to an old room code reuses state from a previous game.

**Phase to address:** Engine Core, room lifecycle. The abort-on-drop guarantee must be part of the initial room struct design.

---

### Pitfall 6: Re-introducing the Calibration Reset Bug in the Rust Port

**What goes wrong:**
The Python server has a confirmed bug: `reset_for_rematch` sets `reference_velocity = None`, forcing players through recalibration on every rematch. The issue is documented in `.scratch/calibration-persist/` as "resolved" but the fix is not present in the code. A naive 1-to-1 port of `reset_for_rematch` to Rust will copy the bug.

**Why it happens:**
The Python code explicitly sets `reference_velocity = None` on line 64 of `rooms.py`. The Rust port will likely model `PlayerSlot` similarly, and whoever ports `reset_for_rematch` will port the `None` assignment without noticing the open issue. The bug is silent: it does not crash, it just degrades UX.

**How to avoid:**
- Before porting `reset_for_rematch`, read `.scratch/calibration-persist/` and the rooms.py `reset_for_rematch` function carefully.
- The correct semantics: `reference_velocity` lives on the `PlayerSlot` struct and is set once during calibration handshake. It is NOT reset by `reset_for_rematch`. Only match round state (HP, round number, win counters) resets on rematch.
- Add an explicit test: after a match ends and `reset_for_rematch` is called, `reference_velocity` for both players must remain `Some(...)`.

**Warning signs:**
- After any rematch, clients receive `MsgCalibrationStart`.
- `reference_velocity` is `None` in the game state after `reset_for_rematch` runs.

**Phase to address:** Boxing game plugin, rematch lifecycle. Add the regression test in the same phase as `reset_for_rematch` is implemented.

---

### Pitfall 7: Blocking the Tokio Executor with Synchronous CPU Work in the Tick

**What goes wrong:**
Hit detection involves iterating over 33-keypoint pose frames and computing Euclidean distances (the equivalent of the Python `np.linalg.norm` calls). In Rust, this is fast pure arithmetic — but if hit detection or any per-tick computation takes more than ~1ms synchronously without yielding, it begins to starve other tasks on the same Tokio worker thread. At 60Hz × N rooms, with 2 attack directions per tick, the cumulative CPU time can starve WebSocket I/O tasks.

Tokio's cooperative preemption budget (128 async operations per scheduling cycle) does not help here: pure synchronous CPU computation never hits an `.await`, so the budget is never decremented, and the task never yields.

**Why it happens:**
Hit detection is O(constant) per frame in this game (33 landmarks, simple math). Developers assume it's too fast to matter. The problem emerges at scale — 8+ concurrent rooms, each running hit detection twice per tick.

**How to avoid:**
- For the current game, hit detection is fast enough to run inline in the tick loop. Add `tokio::task::yield_now().await` at the end of the tick (after all computation but before sleeping) to explicitly yield the worker thread to other tasks.
- If hit detection grows (e.g. a physics-heavy game plugin), move it to `tokio::task::spawn_blocking` with a bounded semaphore to prevent the blocking thread pool from growing unboundedly.
- Never use `rayon` inside an async task without explicit bridging; rayon's thread pool will contend with Tokio's.

**Warning signs:**
- `tokio-console` shows the game loop task using 100% of a worker thread with no yield points.
- WebSocket message receive latency increases proportionally to the number of active rooms.
- Adding `tokio::task::yield_now().await` anywhere in the tick immediately reduces latency for other rooms.

**Phase to address:** Engine Core (tick loop design). Establish the yield-at-end-of-tick pattern from day one. Revisit if a CPU-heavy game plugin is added in the second game milestone.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `serde_json::to_string()` per tick per room | Simple, correct | 60Hz × N rooms × per-message allocation; measurable at 10+ rooms | Initial implementation. Pre-serialize `MsgGameState` to `Bytes` and `Arc`-clone for broadcast once frame budget is measured |
| `Arc<Mutex<RoomState>>` with everything inside | Easy to reason about | Contention between tick loop and WebSocket handlers; see Pitfall 4 | Never for input buffers; acceptable for round-state fields |
| `std::sync::Mutex` throughout | Slightly faster uncontended | Deadlock if held across `.await` (see Pitfall 1) | Only after profiling confirms lock is never held across await and the lock-free period is guaranteed |
| Inline `ws.send().await` in tick loop | Direct port of Python pattern | Slow client stalls entire tick; see Pitfall 3 | Never in the tick loop path |
| Single `Arc<RwLock<HashMap>>` for room registry | Simple lookup | RwLock write-lock on room creation blocks all room reads momentarily | Acceptable — room creation is rare. Upgrade to `dashmap` only if profiling shows registry write contention |
| Skip room cleanup TTL in MVP | Simpler code | Python's known memory-growth bug (rooms never removed) re-introduced in Rust; unbounded `Arc` reference counts | Never — implement room cleanup task from the first milestone, even if the TTL is generous |
| Port forfeit timer as bare `tokio::spawn` without abort handle | Direct equivalent of Python's `asyncio.create_task` | Timer fires after room is destroyed, calls `.abort()` on a nonexistent game loop | Never — store `JoinHandle` and abort on room teardown (see Pitfall 5) |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| TypeScript client wire protocol | Assuming `serde` field names match TypeScript exactly; serde renames fields by default if `rename_all` is set | Write a golden-file test that round-trips each message type against the JSON strings in `shared/protocol.ts`; run it in CI |
| ElevenLabs / Anthropic HTTP in commentary | Calling `reqwest::blocking::get()` from an async task | Use `reqwest` async client only; never call blocking reqwest from an async context |
| `tokio::time::sleep` vs `std::thread::sleep` | Porting Python's `asyncio.sleep(0.1)` paused loop as `std::thread::sleep` | Always use `tokio::time::sleep` in async tasks; `std::thread::sleep` blocks the Tokio worker thread |
| `broadcast::channel` for spectator fan-out | Ignoring `RecvError::Lagged` return | Treat `Lagged` as a slow-client signal: log it, optionally disconnect the lagging spectator, never panic |
| Room code generation | Using `rand::random()` which uses a non-CSPRNG | Port the Python security concern: use `OsRng` from the `rand` crate for cryptographically random room codes |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `serde_json::to_string` per broadcast per room per tick | CPU profile shows >5% in serde at 4+ concurrent rooms | Pre-serialize `MsgGameState` once per tick to `Arc<String>` or `Arc<Bytes>`; clone the `Arc` for each send | 4–6 concurrent rooms (same threshold as the Python ceiling, but for different reasons — allocation overhead, not GIL) |
| `broadcast::channel` with large capacity for spectators | Memory grows with number of spectators; slow spectators hold back channel eviction | Use bounded capacity (8–16) and treat `Lagged` as a disconnect trigger | Any spectator whose mobile network drops below 60fps receive rate |
| Unbounded input buffer per player | Malicious or buggy client spams pose_frames; deque fills, legitimate frames are dropped | Mirror the Python `deque(maxlen=180)` as a `VecDeque` with a capacity cap; add per-connection rate limiting in the read task | Any client sending faster than ~3× the game tick rate |
| Running commentary HTTP calls on the Tokio runtime without timeouts | A slow Anthropic API response blocks the commentary task indefinitely; the task holds an `Arc<Room>` reference, preventing room cleanup | Set explicit `reqwest` timeouts (e.g. 5s for commentary); wrap commentary in a `tokio::select!` with a timeout arm | First Anthropic rate-limit event or API latency spike |
| HashMap room registry without TTL cleanup | Memory grows with total games played over the server's lifetime | Implement a background `tokio::time::interval` cleanup task that removes rooms where `match_over == true` and all WebSocket senders are dropped, after a 5-minute TTL | Any server running more than a few hundred games without restart |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Using `rand::thread_rng()` (non-CSPRNG) for room codes | Room codes are guessable under targeted enumeration | Use `rand::rngs::OsRng` for room code generation (ports the Python security recommendation from CONCERNS.md) |
| No `reference_velocity` range validation in calibration handler | Velocity of 0.001 makes every micro-movement a KO; velocity of 100000 makes all strikes miss | Clamp `reference_velocity` to 0.5–15.0 m/s on receipt, exactly as recommended in CONCERNS.md |
| Accepting arbitrary JSON frames without length limit | Client sends a 1MB pose_frame JSON blob; deserialization is slow and allocates heavily | Set `write_buffer_size` on `WebSocketUpgrade` and add a max message size limit in the WebSocket read task |
| No rate limiting on WebSocket message volume | Pose frame spam at 1000fps fills the input buffer (even with `maxlen` cap) and wastes CPU in the read task | Track messages-per-second per connection in the read task; close connections exceeding 3× the expected frame rate |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No server-side state snapshot on spectator reconnect | Overlay resets win counters and shows wrong score after any network blip — this is the confirmed Python bug | Rust server must send `MsgMatchSnapshot` (current HP, round number, win counters) as the first message on any spectator join, before the normal event stream |
| No HP/round snapshot on player reconnect | Reconnected player sees 0 HP until the next `game_state` broadcast | Include current HP and round number in the `MsgMatchStart` sent on player reconnect |
| Countdown synchronization by magic constant | If server `_ROUND_WARMUP` and client countdown drift, hits land during countdown or countdown shows after round is live | Include `live_at` Unix timestamp (seconds since epoch) in `MsgRoundStart`; client syncs countdown to server clock |
| Calibration reset on rematch | Players must recalibrate every rematch; major UX friction after extended play sessions | `reference_velocity` must survive `reset_for_rematch` — see Pitfall 6 |

---

## "Looks Done But Isn't" Checklist

- [ ] **Game loop tick rate:** `tokio::time::interval` is set to 16ms AND `MissedTickBehavior::Skip` is set — verify by checking the actual `interval` initialization site, not just the target duration constant.
- [ ] **Room cleanup:** A background cleanup task exists AND is actually spawned at server startup AND actually calls `handle.abort()` on the game loop — not just removes the room from the HashMap.
- [ ] **WebSocket send path:** The game loop tick function never calls `ws.send().await` directly — verify by searching for `.send(` inside the tick body; all sends must go through bounded mpsc channels.
- [ ] **Wire protocol compatibility:** A golden-file round-trip test exists for every message type in `shared/protocol.ts` — not just that the Rust struct compiles, but that the serialized JSON matches the TypeScript shape byte-for-byte (field names, value types, optional field presence).
- [ ] **Calibration persistence:** A test verifies that `reference_velocity` is `Some(...)` for both players after `reset_for_rematch` is called — not just that the function compiles.
- [ ] **JoinHandle abort:** Every `tokio::spawn` call that starts a game loop or commentary task has its `JoinHandle` stored and aborted on room teardown — grep for `tokio::spawn` and verify each handle is tracked.
- [ ] **`std::sync::Mutex` audit:** No `std::sync::Mutex` guard is held across an `.await` point — add a `#[deny(clippy::await_holding_lock)]` lint or equivalent check in CI.
- [ ] **Spectator snapshot:** The first message sent on spectator WebSocket connect is a state snapshot, not a game event — verified by an integration test that connects a spectator mid-round.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Mutex held across `.await` causing deadlock | HIGH — requires architectural refactor | Audit all `std::sync::Mutex` usage; replace with `tokio::sync::Mutex` or restructure to release guards before `.await`; add `#[deny(clippy::await_holding_lock)]` |
| `MissedTickBehavior::Burst` causing tick avalanche | LOW — single-line fix | Change `interval.set_missed_tick_behavior(MissedTickBehavior::Skip)` |
| Game loop stalled by slow WebSocket send | MEDIUM — requires outbound task refactor | Extract per-connection outbound `mpsc` channel + send task; replace inline `send().await` with `try_send` |
| Calibration bug re-introduced | LOW — one field and one test | Remove `reference_velocity = None` from `reset_for_rematch`; add regression test |
| JoinHandle dropped without abort causing zombie game loops | MEDIUM — requires lifecycle audit | Wrap all spawned task handles in `AbortOnDropHandle` or add explicit abort calls; audit all `tokio::spawn` call sites |
| Room registry memory leak | LOW — add background cleanup task | Implement `tokio::time::interval` cleanup loop with 5-minute TTL on completed/idle rooms |
| Wire protocol field name mismatch | MEDIUM — silent breakage in production | Add golden-file JSON round-trip tests; run TypeScript client tests against the Rust server in integration CI |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-----------------|--------------|
| Mutex held across `.await` (Pitfall 1) | Engine Core — initial module skeleton | Clippy lint `await_holding_lock`; `tokio-console` shows no contended mutex under load |
| `MissedTickBehavior::Burst` (Pitfall 2) | Engine Core — tick loop scaffold | Unit test: 10 ticks with `start_paused = true`; tick timestamps are uniformly spaced even after an artificial 50ms delay |
| WebSocket send stalls tick (Pitfall 3) | Engine Core — connection management | Integration test: connect a zero-read client; verify tick rate of other rooms is unaffected |
| `Arc<Mutex<RoomState>>` contention (Pitfall 4) | Engine Core — data model | Benchmark: 8 concurrent rooms at 60Hz; per-tick latency standard deviation < 2ms |
| `JoinHandle` dropped leaks game loop (Pitfall 5) | Engine Core — room lifecycle | Test: create room, run 3 ticks, drop room from registry; verify no game loop tasks remain in `tokio-console` |
| Calibration reset bug re-introduced (Pitfall 6) | Boxing plugin — rematch lifecycle | Unit test: `reference_velocity` survives `reset_for_rematch` |
| CPU-bound work starves executor (Pitfall 7) | Engine Core — tick loop; re-evaluate for each new game plugin | `tokio-console` task CPU budget; yield-at-end-of-tick pattern in initial loop |
| Wire protocol mismatch | Engine Core — message types | Golden-file tests against `shared/protocol.ts` JSON fixtures; TypeScript client smoketest in CI |
| Room memory leak (from CONCERNS.md) | Engine Core — room lifecycle | Long-running test: create and complete 100 rooms; verify room registry is empty and memory is reclaimed |
| Spectator/player reconnect state loss | Engine Core — connection management + Boxing plugin | Integration test: connect spectator, disconnect, reconnect mid-round; verify win counters match pre-disconnect values |

---

## Sources

- Tokio official docs — shared state: https://tokio.rs/tokio/tutorial/shared-state
- Tokio official docs — `MissedTickBehavior`: https://docs.rs/tokio/latest/tokio/time/enum.MissedTickBehavior.html
- Tokio official docs — `JoinHandle`: https://docs.rs/tokio/latest/tokio/task/struct.JoinHandle.html
- Tokio official docs — `broadcast::channel` lag: https://docs.rs/tokio/latest/tokio/sync/broadcast/index.html
- Tokio official docs — `spawn_blocking`: https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html
- Tokio cooperative preemption: https://tokio.rs/blog/2020-04-preemption
- Tokio testing (paused time): https://tokio.rs/tokio/topics/testing
- Axum WebSocket docs: https://docs.rs/axum/0.8.8/axum/extract/ws/index.html
- Turso blog — Tokio mutex deadlock: https://turso.tech/blog/how-to-deadlock-tokio-application-in-rust-with-just-a-single-mutex
- Cybernetist — Tokio task cancellation patterns: https://cybernetist.com/2024/04/19/rust-tokio-task-cancellation-patterns/
- Alice Ryhl — Actors with Tokio: https://ryhl.io/blog/actors-with-tokio/
- Qovery — Common mistakes with Rust async: https://www.qovery.com/blog/common-mistakes-with-rust-async
- Codebase CONCERNS.md — Python server known issues and performance bottlenecks (primary source for Pitfalls 6 and the UX/security sections)

---
*Pitfalls research for: Rust (Axum + Tokio) real-time WebSocket game server*
*Researched: 2026-05-01*
