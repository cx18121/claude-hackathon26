# Person A: Server Plan

**Stack:** Python 3.11, FastAPI, uvicorn, asyncio, numpy, pydantic v2, qrcode, python-dotenv  
**Directory:** `/server`  
**Reference:** [project.md](project.md) for checkpoints and protocol

Tell Claude Code: "Work through the tasks in this file in order. Complete each task fully before moving to the next. Run the verification command after each task to confirm it works."

---

## Before You Start

1. Pull the repo and confirm kickoff is done (Checkpoint 0 in project.md)
2. Activate the venv: `cd server && source .venv/bin/activate`
3. Confirm `shared/protocol.ts` is committed -- mirror it to `server/protocol.py` as your first task

---

## Sprint 1: Server Skeleton + Tunnel + QR

Goal: `python main.py` prints a public tunnel URL and QR code. A WebSocket client can connect and you see it logged. Pose frames are echoed back.

### Task 1.1 -- Protocol models (`server/protocol.py`)

Create `server/protocol.py`. Mirror every message type from `shared/protocol.ts` as a Pydantic v2 BaseModel.

```python
# Key models needed:
# Inbound (from mobile): Join, PoseFrame, CalibrationDone, Ping
# Outbound (to mobile): Joined, Pong, CalibrationStart, MatchStart, YouWereHit
# Outbound (to overlay): GameState, HitEvent, RoundStart, RoundEnd, MatchEnd

# PoseKeypoint must have: x, y, z, visibility (all float)
# Use model_validator or Field defaults where needed
```

Use `model_config = ConfigDict(frozen=True)` for inbound messages.

**Verify:** `python -c "from protocol import PoseFrame; print('ok')"` prints `ok`.

### Task 1.2 -- Room state (`server/rooms.py`)

Create `server/rooms.py`.

```python
# RoomState dataclass:
#   code: str  (6-char alphanumeric)
#   players: dict[int, PlayerSlot]  # slot 1 and 2
#   created_at: float

# PlayerSlot dataclass:
#   ws: WebSocket | None
#   latest_pose: PoseFrame | None
#   reference_velocity: float | None
#   connected: bool
#   rtt_ms: float  # median RTT, updated by ping loop

# RoomManager:
#   _rooms: dict[str, RoomState]
#   create_room() -> str  (generate 6-char code, store, return code)
#   get_room(code) -> RoomState | None
#   remove_room(code) -> None
#   list_rooms() -> list[str]

# Room codes: uppercase alphanumeric, random.choices from string.ascii_uppercase + digits
# Keep it simple -- no expiry logic yet
```

**Verify:** `python -c "from rooms import RoomManager; rm = RoomManager(); code = rm.create_room(); print(code)"` prints a 6-char code.

### Task 1.3 -- Tunnel subprocess (`server/tunnel.py`)

Create `server/tunnel.py`.

```python
# TunnelManager:
#   process: subprocess.Popen | None
#   public_url: str | None
#
#   start(port: int) -> str:
#     Spawns: cloudflared tunnel --url http://localhost:{port}
#     Streams stdout line by line until it finds:
#       "Your quick Tunnel has been created! Visit it at: https://...trycloudflare.com"
#     Parses the URL from that line with a regex
#     Returns the URL
#     If cloudflared is not found (FileNotFoundError), prints install hints:
#       macOS:   brew install cloudflared
#       Linux:   apt install cloudflared
#       Windows: winget install cloudflared
#     Then raises SystemExit(1)
#
#   stop():
#     Terminates the subprocess, waits up to 3 seconds, then kills if still alive

# Fallback: if TUNNEL=false env var, skip cloudflared.
# Instead, get the LAN IP (socket.gethostbyname(socket.gethostname())) and
# return http://{lan_ip}:{port}
```

Timeout waiting for the URL: 30 seconds. If no URL found in that time, raise `RuntimeError("cloudflared did not emit a URL within 30s")`.

**Verify:** `TUNNEL=false python -c "from tunnel import TunnelManager; import asyncio; t = TunnelManager(); print(t.get_lan_url(8000))"` prints a local IP.

### Task 1.4 -- QR code printer (`server/qr.py`)

Create `server/qr.py`.

```python
# print_startup_info(public_url: str, room_code: str) -> None:
#   Prints to stdout:
#     1. A blank line
#     2. "=== SHADOW FIGHT SERVER READY ==="
#     3. "Public URL: {public_url}"
#     4. "Room code:  {room_code}"
#     5. ""
#     6. "Share this URL with your opponent:"
#     7. "  {public_url}/join?room={room_code}"
#     8. ""
#     9. "Open the overlay at:"
#     10. "  {public_url}/overlay?server={public_url}&room={room_code}"
#     11. ""
#     12. "Scan to join on mobile:"
#     13. A terminal QR code encoding {public_url}/join?room={room_code}
#
# Use qrcode library with ASCII renderer:
#   qr = qrcode.QRCode()
#   qr.add_data(join_url)
#   qr.make(fit=True)
#   qr.print_ascii(invert=True)
```

**Verify:** `python -c "from qr import print_startup_info; print_startup_info('https://example.trycloudflare.com', 'ABC123')"` prints the block with a QR code.

### Task 1.5 -- FastAPI app (`server/main.py`)

Create `server/main.py`. This is the entry point.

```python
# Load .env with python-dotenv at module top
# Settings from env:
#   PORT = int(os.getenv("PORT", "8000"))
#   TUNNEL = os.getenv("TUNNEL", "true").lower() != "false"

# FastAPI app with:
#   GET /  -> landing page (plain HTML string, not a file)
#             Shows: server status, room code, join URL, basic instructions
#   POST /rooms -> creates a room, returns {"code": "ABC123"}
#   WS /ws/player/{room_code} -> player connection (see below)
#   WS /ws/spectator/{room_code} -> spectator connection (see below)

# On startup (lifespan context manager):
#   1. Create one room automatically (store code in app.state.default_room)
#   2. Start tunnel (or LAN fallback)
#   3. Print startup info + QR code
#   4. Store tunnel manager in app.state for clean shutdown

# On shutdown (lifespan):
#   tunnel.stop()

# WS /ws/player/{room_code}:
#   On connect: validate room exists, find an open slot, assign player, log "Player {slot} connected to room {code}"
#   If room full (both slots taken): close WS with code 4000 and message "room full"
#   Read loop: parse JSON, log message type and player slot
#   For now: echo pose_frame messages back as-is (will be replaced in Sprint 2)
#   On disconnect: mark slot as disconnected, log "Player {slot} disconnected"

# WS /ws/spectator/{room_code}:
#   On connect: validate room exists, log "Spectator connected to room {code}"
#   Keep connection open, do not close it
#   (Game loop will push game_state to spectators in Sprint 2)
#   On disconnect: log "Spectator disconnected"

# Run with: uvicorn main:app --host 0.0.0.0 --port {PORT}
# When run as __main__: call uvicorn.run() programmatically
```

Store active WebSocket connections per room in the RoomState. Use a set of spectator connections: `spectators: set[WebSocket]`.

**Verify:**
```bash
python main.py &
sleep 2
curl -s http://localhost:8000/
curl -s -X POST http://localhost:8000/rooms
# Connect via wscat or websocat and confirm logs appear
kill %1
```

**Checkpoint 1 deliverable:** `python main.py` shows tunnel URL, room code, and QR code in terminal. A browser navigating to the URL sees the landing page. A WebSocket client connecting to `/ws/player/{code}` is logged on the server.

Also create `.env.example`:
```
PORT=8000
TUNNEL=true
```

---

## Sprint 2: Game Loop + Velocity + RTT

### Task 2.1 -- Pose math (`server/pose.py`)

Create `server/pose.py`.

```python
# PoseKeypoint = simple dataclass: x, y, z, visibility

# moving_average_velocity(frames: list[list[PoseKeypoint]], landmark_idx: int) -> np.ndarray:
#   frames is a deque of the last 3 pose frames (oldest first)
#   Returns the 3D velocity vector of landmark_idx between frame[-1] and frame[-3]
#   Velocity = (pos[-1] - pos[-3]) / (2 * frame_dt)   where frame_dt = 1/30 s
#   If fewer than 3 frames available, return np.zeros(3)

# interpolate_poses(a: list[PoseKeypoint], b: list[PoseKeypoint], t: float) -> list[PoseKeypoint]:
#   Linearly interpolate all 33 keypoints by factor t in [0, 1]
#   Used by game loop to fill frames between 30fps pose updates at 60Hz tick

# landmark indices for relevant joints (MediaPipe 33-point model):
#   WRIST_LEFT  = 15
#   WRIST_RIGHT = 16
#   ANKLE_LEFT  = 27
#   ANKLE_RIGHT = 28
#   NOSE        = 0
#   LEFT_HIP    = 23
#   RIGHT_HIP   = 24
```

**Verify:** `python -c "from pose import moving_average_velocity; print('ok')"` prints `ok`.

### Task 2.2 -- Hit detection (`server/hit_detection.py`)

Create `server/hit_detection.py`.

```python
# Region enum (string values match protocol):
#   BLOCK_HAND, BLOCK_FOREARM
#   LEG_THIGH, LEG_SHIN
#   TORSO_LOWER, TORSO_UPPER
#   HEAD_FACE, HEAD_CHIN, HEAD_THROAT

# Capsule hitbox per region (defined in normalized pose space, relative to opponent torso center):
#   Each capsule: center offset (x, y, z), radius, half-length, axis direction
#   Define these as constants -- exact values are approximate, tune during integration

# detect_punch(attacker_poses: deque, defender_poses: deque) -> HitResult | None:
#   Computes wrist velocity for both wrists (left=15, right=16)
#   If velocity magnitude > PUNCH_THRESHOLD (start with 2.0 m/s):
#     Project wrist position into defender's hitbox space
#     Test against each hitbox capsule (point-to-capsule distance)
#     If inside any capsule, return HitResult(region, velocity_magnitude, position)
#   Return None if no hit

# detect_kick(attacker_poses: deque, defender_poses: deque) -> HitResult | None:
#   Same logic for ankles (left=27, right=28)
#   KICK_THRESHOLD = 2.5 m/s

# HitResult dataclass: region: str, velocity: float, position: tuple[float, float, float]

# PUNCH_THRESHOLD and KICK_THRESHOLD should be module-level constants (easy to tune)
```

**Verify:** `python -c "from hit_detection import detect_punch, Region; print('ok')"` prints `ok`.

### Task 2.3 -- Damage formula (`server/damage.py`)

Create `server/damage.py`.

```python
# BASE_DAMAGE: dict[str, tuple[int, int]] -- region -> (min, max)
#   "block_hand":     (2, 4)
#   "block_forearm":  (2, 4)
#   "leg_thigh":      (3, 5)
#   "leg_shin":       (3, 5)
#   "torso_lower":    (6, 9)
#   "torso_upper":    (9, 13)
#   "head_face":      (15, 20)
#   "head_chin":      (20, 25)
#   "head_throat":    (20, 25)

# compute_damage(region: str, limb_velocity: float, reference_velocity: float) -> int:
#   base_min, base_max = BASE_DAMAGE[region]
#   scale = limb_velocity / max(reference_velocity, 0.1)  # avoid div by zero
#   raw = base_min + (base_max - base_min) * (scale - 1.0)
#   return int(max(base_min, min(base_max, round(raw))))
#
# If reference_velocity is None (player not calibrated yet), use 3.0 as default

# Tests belong in server/tests/test_damage.py
```

**Verify:** `python -c "from damage import compute_damage; print(compute_damage('head_face', 3.0, 3.0))"` prints a number in [15, 20].

### Task 2.4 -- RTT measurement (add to `server/rooms.py`)

Add to `PlayerSlot`:
```python
ping_times: list[float]  # rolling last 10 ping timestamps sent
rtt_samples: list[float]  # last 10 RTT measurements in ms
```

Add to `server/rooms.py`:
```python
# median_rtt(slot: PlayerSlot) -> float:
#   Returns median of rtt_samples, or 0 if no samples

# record_pong(slot: PlayerSlot, original_t: float) -> float:
#   Computes RTT = (now - original_t) * 1000
#   Appends to rtt_samples (keep last 10)
#   Returns RTT in ms
```

In `main.py` WS player handler, after sending `joined`:
- Start a background task that sends `{"type": "ping", "t": time.time()}` every 500ms
- When a `pong` arrives from client, call `record_pong` to update the sample

### Task 2.5 -- Game loop (`server/game_loop.py`)

Create `server/game_loop.py`.

```python
# GameLoop:
#   room: RoomState
#   tick: int = 0
#   running: bool = False
#
#   async def run():
#     target_dt = 1 / 60
#     while running:
#       t0 = asyncio.get_event_loop().time()
#       await tick()
#       elapsed = asyncio.get_event_loop().time() - t0
#       await asyncio.sleep(max(0, target_dt - elapsed))
#
#   async def tick():
#     self.tick += 1
#     # 1. Apply input delay: hold each player's pose frames by max(rtt_a, rtt_b)
#     #    Use a deque per player with timestamps; only process frames old enough
#     # 2. Detect hits for player 1 attacking player 2, and vice versa
#     # 3. Apply damage, update HP
#     # 4. Check round end conditions (HP <= 0 or timer expired)
#     # 5. Build game_state message
#     # 6. Broadcast to all spectators in room
#     # 7. Send you_were_hit to struck player's mobile WS
#
#   Input delay logic:
#     max_rtt = max(median_rtt(slot1), median_rtt(slot2))
#     delay_s = max_rtt / 1000
#     Only use pose frames where frame.timestamp <= now - delay_s

# Start game loop when both players in a room send calibration_done
# One GameLoop instance per room, stored in RoomState

# high_latency flag in game_state: True if max_rtt > 150ms
```

Start `GameLoop.run()` as an asyncio background task when match starts.

**Verify:** With two mock WebSocket clients (one per player slot), connect them and send a few pose frames. Server console should log hit detections at 60Hz. Spectators should receive `game_state` JSON.

---

## Sprint 3: Match Flow + Calibration

### Task 3.1 -- Round and match state (add to `server/rooms.py`)

Add to `RoomState`:
```python
hp: list[int]          # [100, 100]
round_number: int      # 1, 2, or 3
wins: list[int]        # [0, 0] -- rounds won per player
round_start_time: float | None
match_over: bool
```

### Task 3.2 -- Round timer and round flow (add to `server/game_loop.py`)

In the game loop tick:
```
- If round_start_time is None, set it on first tick of the round
- Remaining time = 90 - (now - round_start_time)
- Include remaining_time in game_state broadcast
- If remaining_time <= 0:
    Whoever has more HP wins the round
    If tied, round is a draw (no win credited to either)
- If a player HP reaches 0: that player loses the round
- On round end:
    Broadcast round_end {winner, final_hp}
    If a player has 2 wins: match over, broadcast match_end {winner}
    Otherwise: reset HP to [100, 100], increment round_number, broadcast round_start
```

### Task 3.3 -- Calibration handling (update `server/main.py`)

In the WS player handler, when `calibration_done` arrives:
- Store `reference_velocity` on the player's slot
- If both players have `reference_velocity` set, broadcast `match_start` to both mobile clients and start the game loop

When first player connects, send `calibration_start` immediately.
When second player connects, send `calibration_start` to them too.

### Task 3.4 -- Serve overlay as static files

In `main.py`, add:
```python
from fastapi.staticfiles import StaticFiles
app.mount("/overlay", StaticFiles(directory="../overlay/dist", html=True), name="overlay")
```

This lets the host serve the overlay to the remote player from the same tunnel URL. Only mount if `../overlay/dist` exists.

---

## Sprint 4: Integration + Hardening

### Task 4.1 -- Tests (`server/tests/`)

Write pytest tests for:
- `test_damage.py`: damage formula edge cases (zero velocity, very high velocity, each region)
- `test_rooms.py`: create room, fill slots, disconnect handling
- `test_hit_detection.py`: synthetic pose data that should and should not trigger hits
- `test_game_loop.py`: one tick with two pose frames, verify game_state structure

Run: `pytest server/tests/ -v`

### Task 4.2 -- Graceful shutdown

On `SIGINT` / `Ctrl-C`:
- Stop all running game loops
- Close all WebSocket connections cleanly
- Stop tunnel subprocess
- Log "Server shut down cleanly"

Use FastAPI's lifespan context for setup/teardown. Use `asyncio.gather` to cancel background tasks.

### Task 4.3 -- `scripts/dev.sh`

Write `scripts/dev.sh`:
```bash
#!/usr/bin/env bash
set -e
# Start server in background
cd server && TUNNEL=false source .venv/bin/activate && python main.py &
SERVER_PID=$!
# Start mobile dev server
cd mobile && npm run dev &
MOBILE_PID=$!
# Start overlay dev server
cd overlay && npm run dev &
OVERLAY_PID=$!
# On exit, kill all
trap "kill $SERVER_PID $MOBILE_PID $OVERLAY_PID" EXIT
wait
```

### Task 4.4 -- Disconnect recovery

If a player WebSocket disconnects during a match:
- Pause the game loop (stop ticking but keep state)
- Broadcast a message to spectators: `{"type": "player_disconnected", "player": N}`
- If the player reconnects with the same slot within 30 seconds, resume
- If 30 seconds pass with no reconnect, forfeit the match to the other player

### Task 4.5 -- End-to-end tunnel test

Test with a real Cloudflare tunnel:
1. `TUNNEL=true python main.py`
2. Share the URL with a teammate on a different network
3. Teammate opens the mobile client URL on their phone
4. Confirm pose frames arrive on server from outside LAN
5. Confirm overlay renders on the host's laptop

Document any issues found.

---

## Verification Commands (Run Before Each Checkpoint)

```bash
# Sprint 1
python -c "from protocol import PoseFrame, GameState; print('protocol ok')"
python -c "from rooms import RoomManager; rm = RoomManager(); print(rm.create_room())"
TUNNEL=false python main.py &  sleep 2  curl localhost:8000/  kill %1

# Sprint 2
python -c "from pose import moving_average_velocity; print('pose ok')"
python -c "from damage import compute_damage; print(compute_damage('head_face', 3.0, 3.0))"
pytest server/tests/ -v

# Sprint 3 (manual)
# Two browser tabs, each opening the mobile client on different slots
# One calibrates and starts a match, other sees match_start

# Sprint 4
pytest server/tests/ -v
bash scripts/dev.sh  # confirm all three start without errors
```
