# Codebase Concerns

**Analysis Date:** 2026-05-02

## Tech Debt

**Flat server structure — game logic mixed into `game_loop.py`:**
- Issue: `game_loop.py` (479 lines) owns bot scheduling, commentary emission, hit detection dispatch, round/match state transitions, warmup gating, stalemate watching, and combo tracking all in one class. `main.py` (683 lines) owns WebSocket routing, lobby/room HTML, static file serving, reconnect timers, and forfeit logic.
- Files: `server/game_loop.py`, `server/main.py`
- Impact: Hard to test individual concerns in isolation; the server rewrite to Rust (axum) will require unpicking responsibilities that are currently tangled.
- Fix approach: Before the Rust migration, identify clear module boundaries — e.g. separate `match_state.py`, `bot.py`, `forfeit.py`, `lobby.py` — so each maps cleanly to a Rust module.

**`pose.py` is dead code:**
- Issue: `server/pose.py` defines `moving_average_velocity` and `interpolate_poses` but is never imported anywhere in the codebase. The actual velocity math lives in `server/hit_detection.py`.
- Files: `server/pose.py`
- Impact: Misleading to contributors; adds surface area to the planned Rust migration.
- Fix approach: Delete `server/pose.py` or, if `interpolate_poses` is needed for the Rust overlay rendering pipeline, document and wire it up.

**`parse_mobile_msg` rebuilds `TypeAdapter` on every call:**
- Issue: `server/protocol.py:172-174` creates a new `pydantic.TypeAdapter` instance on every inbound message parse. At 60Hz × 2 players = 120 calls/s this adds avoidable object allocation and internal Pydantic schema-rebuild overhead.
- Files: `server/protocol.py`
- Impact: Measurable CPU overhead at sustained frame rates; worsens under load.
- Fix approach: Move `adapter = TypeAdapter(InboundMobileMsg)` to module level so it is built once.

**No room expiry / cleanup:**
- Issue: `RoomManager._rooms` in `server/rooms.py` is a plain dict that grows forever. Rooms are never deleted after a match ends or after extended inactivity. There is no `created_at` age check, no cron-style cleanup, and `remove_room()` is never called from `main.py`.
- Files: `server/rooms.py`, `server/main.py`
- Impact: Long-running server processes will accumulate memory proportional to the number of games played. A restart is required to reclaim it.
- Fix approach: Add a background task that removes rooms where `match_over` is `True` and all player WebSockets have been `None` for more than N minutes, or rooms that have been idle since creation past a TTL.

**Hit-detection thresholds are hardcoded magic constants with acknowledged tuning debt:**
- Issue: `_REL_HEAD_Y = 1.45`, `_REL_TORSO_HI_Y = 0.70`, `_REL_GUARD_HEAD_Y = 1.10`, `PUNCH_THRESHOLD = 40% of ref_vel`, `KICK_THRESHOLD = 55% of ref_vel` were chosen heuristically and the prompt notes they "may need tuning." Block zones (`block_hand`, `block_forearm`) appear in `BASE_DAMAGE` but are never exercised in any real-scenario test.
- Files: `server/hit_detection.py`, `server/damage.py`
- Impact: False positives (phantom hits) and false negatives (missed real strikes) degrade gameplay; block detection accuracy is unvalidated.
- Fix approach: Collect real gameplay traces, add parametrized regression tests for boundary cases, and expose thresholds as config rather than module constants.

---

## Known Bugs

**Calibration resets on rematch (tracked in `.scratch/calibration-persist/`):**
- Symptoms: After a match ends and players request a rematch via `POST /rooms/{code}/rematch`, the server calls `slot.reference_velocity = None` (in `reset_for_rematch`) and then sends `MsgCalibrationStart` to both players, forcing them through the full T-pose → punch → neutral calibration sequence again. The intended behaviour (per `CONTEXT.md`) is that calibration persists for the lifetime of the Room.
- Files: `server/rooms.py:57-67` (`reset_for_rematch`), `server/main.py:427-443` (rematch endpoint)
- Trigger: Any completed match followed by a "Play Again" button press.
- Workaround: None — players must recalibrate every rematch.
- Status: Documented in `.scratch/calibration-persist/issues/01-calibration-resets-on-rematch.md` as "resolved" but the fix is not yet present in the current code. `reset_for_rematch` still sets `reference_velocity = None` on line 64 and the rematch handler still sends `MsgCalibrationStart`.

**`_forfeit_timer` closure captures mutable `room` by reference — late-binding risk:**
- Symptoms: The inner closure `_forfeit_timer(s, r, rc)` at `server/main.py:629` uses default-argument capture (`s=slot_num, r=room, rc=room_code`) which is correct. However the closure then calls `r.game_loop.stop()` and sets `r.match_over = True` without checking whether the room has been reused or a new game loop started. In the rare case where the 30-second window spans a rematch, the timer may cancel the new game loop.
- Files: `server/main.py:629-649`
- Trigger: Player disconnects during a match, opponent triggers a rematch within 30 seconds (unlikely in practice, but possible via the `/rematch` HTTP endpoint).
- Workaround: None currently.

---

## Security Considerations

**No authentication or room access control:**
- Risk: Anyone who knows a 6-character room code can join a room as any slot or spectate. Room codes are generated with `random.choices` (not `secrets.choice`), giving a 36^6 ≈ 2.2 billion code space. Brute-force enumeration is not throttled.
- Files: `server/rooms.py:74-79`, `server/main.py:447-475`
- Current mitigation: Short-lived rooms, local/tunnel deployment model, no sensitive data stored.
- Recommendations: For public-facing deployments, switch room code generation to `secrets.choice`, add server-side rate limiting on the `/ws/player` accept path, and optionally require a host-issued join token.

**No input validation on `reference_velocity` from calibration:**
- Risk: A malicious or buggy client can send `calibration_done` with an arbitrarily large or small `reference_velocity`. Since thresholds scale linearly with `ref`, a `reference_velocity` of 0.001 makes every tiny wrist movement a full-power hit; a value of 10000 makes all attacks miss.
- Files: `server/main.py:572-573`, `server/protocol.py:31-34`
- Current mitigation: Pydantic validates that the field is a `float`, but imposes no range constraint.
- Recommendations: Clamp `reference_velocity` server-side to a sane range (e.g. 0.5–15.0 m/s) upon receipt.

**No rate limiting on WebSocket message volume:**
- Risk: A client that spams `pose_frame` messages faster than the 60Hz game loop can process them will cause the `_buffers` deque to fill (`maxlen=180`), dropping legitimate frames, and may starve the asyncio event loop.
- Files: `server/main.py:535-566`, `server/game_loop.py:98-101`
- Current mitigation: `deque(maxlen=180)` caps buffer growth; asyncio single-threading serializes message processing.
- Recommendations: Track per-connection message rates and disconnect / throttle connections exceeding a threshold.

---

## Performance Bottlenecks

**Commentary `TypeAdapter` + Pydantic serialization in the hot game loop path:**
- Problem: Every 60Hz tick that produces a hit calls `compute_damage`, then `MsgYouWereHit(...).model_dump_json()`, then `MsgGameState(...).model_dump_json()`. Each `model_dump_json()` runs Pydantic's full serialization pipeline.
- Files: `server/game_loop.py:225`, `server/game_loop.py:397-408`
- Cause: Pydantic v2 is fast but the call happens 60 times per second per room. With multiple concurrent rooms the overhead compounds.
- Improvement path: Pre-build a JSON template for `MsgGameState` and use string formatting for the hot fields (tick, hp, remaining_time), as is already done manually in `commentator.py` for commentary messages.

**NumPy array allocation per velocity call in hit detection:**
- Problem: `_velocity()` and `_peak_speed()` in `server/hit_detection.py` allocate new `np.ndarray` objects on every frame during hit detection. At 60Hz × 4 wrists/ankles = 240 numpy allocations/s per room.
- Files: `server/hit_detection.py:67-97`
- Cause: `np.array(...)` and `np.linalg.norm(...)` produce new heap objects each call.
- Improvement path: Rewrite the inner velocity checks using plain Python arithmetic (already used for `_peak_speed` partially); defer NumPy until the Rust migration absorbs this path.

---

## Fragile Areas

**`_BOT_KPS` hardcoded 33-point pose in `game_loop.py`:**
- Files: `server/game_loop.py:49-83`
- Why fragile: The bot pose is a hard-coded list of 33 `PoseKeypoint` literals. If the MediaPipe landmark index schema changes or if a different pose model with a different number of landmarks is adopted, this list silently produces wrong hit results rather than an obvious error.
- Safe modification: Add an assertion `assert len(_BOT_KPS) == 33` and document that the indices must match `hit_detection.py` constants.
- Test coverage: No test verifies bot hit detection against a known pose trajectory.

**`game_loop.stop()` relies on `asyncio.create_task` without error handling:**
- Files: `server/game_loop.py:411-413`
- Why fragile: `stop()` calls `asyncio.create_task(self.commentator.stop())` but does not add the task to `_active_tasks` tracking in `main.py`. If the event loop is closing when `stop()` is called (e.g. during server shutdown), the task will be cancelled with no logging.
- Safe modification: Return the task from `stop()` and track it, or use `asyncio.ensure_future` with an explicit exception handler.

**Overlay `useSpectatorSocket` win counter is duplicated from server state:**
- Files: `overlay/src/hooks/useSpectatorSocket.ts:115`, `overlay/src/hooks/useSpectatorSocket.ts:213-218`
- Why fragile: The overlay derives win totals by listening to `round_end` events and incrementing local state. If the spectator WebSocket reconnects mid-match (which it does, unconditionally on close), wins accumulated before reconnect are lost and the overlay shows wrong win totals for the rest of the match.
- Safe modification: The server should include cumulative win counts in `round_start` or `game_state` messages so the overlay can reconstruct state after a reconnect.

**Countdown synchronization relies on a client-side 3.8s timer matching the server warmup:**
- Files: `server/game_loop.py:28` (`_ROUND_WARMUP = 3.8`), `mobile/src/components/GameScreen.tsx:128-132`
- Why fragile: The client countdown (3 → 2 → 1 → FIGHT at fixed 1s intervals, total 3.8s) and the server warmup gate (`_ROUND_WARMUP = 3.8s`) must stay in sync. If either value drifts (e.g. round trip time causes the server's `round_start` to arrive late), hits during the countdown may still land or the countdown may display past the live point.
- Safe modification: Include a `live_at` Unix timestamp in `MsgRoundStart` so the client can sync its countdown to the server clock rather than relying on a matching magic constant.

---

## Scaling Limits

**Single-process asyncio, no horizontal scaling:**
- Current capacity: One Python process handles all rooms. A 60Hz asyncio loop is CPU-bound; Python's GIL prevents true parallelism even on multi-core hosts.
- Limit: Performance degrades noticeably above ~4–6 concurrent active rooms (estimated based on 60Hz tick, ~2 Pydantic serializations, ~8 `send_text` calls per room per tick).
- Scaling path: The planned Rust rewrite (axum + tokio + rmp-serde) removes the GIL bottleneck and enables horizontal scaling via room sharding or load-balanced instances.

**Cloudflare quick tunnel as sole ingress:**
- Current capacity: Cloudflare quick tunnels (`trycloudflare.com`) are rate-limited and not intended for production traffic.
- Limit: Sustained multi-room sessions may hit Cloudflare's unauthenticated tunnel limits.
- Scaling path: Use a named Cloudflare tunnel with an account, a VPS with direct port forwarding, or a serverless WebSocket relay.

---

## Dependencies at Risk

**`cloudflared` binary assumed present at runtime:**
- Risk: `server/tunnel.py:46-58` calls `cloudflared` as a subprocess. If the binary is absent, the server exits with `SystemExit(1)` rather than falling back gracefully.
- Impact: Docker deployments or CI environments without `cloudflared` fail to start unless `TUNNEL=false` is set.
- Migration plan: Add `cloudflared` to the Dockerfile `RUN` step; ensure `TUNNEL=false` is the default in CI.

**`anthropic` and `httpx` in production server path:**
- Risk: The `commentator.py` module imports `anthropic` and `httpx` at module load. If the Anthropic SDK releases a breaking change, the entire server fails to import regardless of whether commentary is enabled.
- Impact: Any `pip install -r requirements.txt` after an SDK bump with a breaking change breaks startup even when `ANTHROPIC_API_KEY` is unset.
- Migration plan: Move commentary imports to a lazy-import guard inside the `CommentaryEngine.__init__` so the engine can degrade gracefully without the SDK installed.

**Python 3.14 in `.venv` — pre-release:**
- Risk: `server/.venv/lib/python3.14/` indicates the virtualenv was created with CPython 3.14, which is pre-release as of this analysis. Some packages (e.g. `numpy`, compiled extensions) may not have official wheels for 3.14.
- Impact: Reproducibility across developer machines and CI may be inconsistent.
- Migration plan: Pin to Python 3.11 (the stack document targets) in `.python-version` and `pyproject.toml`/`requirements.txt`.

---

## Missing Critical Features

**No spectator reconnect state restoration:**
- Problem: When the overlay (`useSpectatorSocket`) reconnects after a disconnect, it resets `wins`, `gameState`, `roundState` etc. to their initial values. The server sends no snapshot of current match state on spectator join — it only sends subsequent events.
- Blocks: Reliable spectator experience when network is unstable; Arena win counter is wrong after any reconnect.

**No server-side HP or state snapshot for player reconnect:**
- Problem: On player reconnect (`is_reconnect = True`), `main.py` sends `MsgMatchStart` but no current HP, round number, or remaining time. The reconnected player's mobile client shows 0/default state until the next `game_state` broadcast reaches them via the spectator channel (which players don't subscribe to).
- Blocks: Players cannot see their current HP after a reconnect without the server adding a `MsgMatchSnapshot` message type.
- Files: `server/main.py:511-519`

---

## Test Coverage Gaps

**No tests for `commentator.py`:**
- What's not tested: Commentary engine startup/shutdown, event cooldown, priority queue drop logic, the `_run_loop` cancellation path, TTS synthesis fallback when ElevenLabs is unavailable, the `_stream_call` Anthropic error path.
- Files: `server/commentator.py` (367 lines, 0 test coverage)
- Risk: Commentary bugs (leaking tasks, uncaught exceptions stopping the engine silently) go undetected until production.
- Priority: Medium — commentary degrades gracefully, but task leaks in a long-running server can accumulate.

**No tests for `tunnel.py`:**
- What's not tested: URL parsing from cloudflared stdout, timeout behaviour, LAN fallback URL format, subprocess kill-on-timeout.
- Files: `server/tunnel.py`
- Risk: Tunnel startup regressions are only discovered at server launch.
- Priority: Low — failures are immediately visible; fix is fast.

**No tests for bot hit delivery in solo mode:**
- What's not tested: That `_tick_bot` actually fires within its configured interval window, that bot difficulty settings produce the expected damage ranges, that the bot does not fire during the warmup period.
- Files: `server/game_loop.py:231-256`
- Risk: Bot damage changes or interval regressions go unnoticed.
- Priority: Medium.

**No end-to-end test for disconnect/reconnect flow:**
- What's not tested: Player disconnecting mid-match triggers the 30-second forfeit timer; reconnecting within 30 seconds cancels the timer and resumes the game loop; reconnecting after 30 seconds receives the match-end broadcast correctly.
- Files: `server/main.py:593-656`
- Risk: Forfeit/reconnect logic is one of the most stateful paths; bugs here cause stuck matches.
- Priority: High.

**Mobile client has minimal test coverage:**
- What's not tested: `useGameSocket` reconnect path, `normalizeHttpUrl`/`normalizeWsUrl` edge cases, `useCalibration` stage transitions (only `useCalibration.test.ts` exists and covers basic hook wiring), `usePose` error fallback when MediaPipe throws.
- Files: `mobile/src/hooks/useGameSocket.ts`, `mobile/src/hooks/usePose.ts`
- Risk: Regression in WebSocket reconnect or calibration state machine not caught until manual QA.
- Priority: Medium.

---

*Concerns audit: 2026-05-02*
