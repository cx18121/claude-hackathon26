# Shadow Fight Real-Time Game -- Project Plan

## Component Owners

| Person | Plan | Component | Stack |
|--------|------|-----------|-------|
| A | [server.md](server.md) | Game server | Python 3.11, FastAPI, asyncio |
| B | [mobile.md](mobile.md) | Mobile capture client | Vite, React 18, TS, MediaPipe |
| C | [overlay.md](overlay.md) | Overlay renderer | Vite, React 18, TS, PixiJS v8 |

---

## Repo Structure (scaffold at kickoff)

```
/server
  main.py
  game_loop.py
  pose.py
  hit_detection.py
  damage.py
  rooms.py
  protocol.py
  tunnel.py
  qr.py
  requirements.txt
  .env.example
  tests/
/mobile
  (Vite scaffold)
/overlay
  (Vite scaffold)
/shared
  protocol.ts
README.md
scripts/dev.sh
docs/plans/
  project.md   <- you are here
  server.md
  mobile.md
  overlay.md
```

---

## Kickoff (All 3 Together -- Do This Before Splitting)

One person runs these commands. Everyone watches and agrees before moving on.

```bash
# 1. Scaffold monorepo
mkdir -p server/tests mobile overlay shared scripts docs/plans

# 2. Scaffold Vite apps (non-interactive)
cd mobile && npm create vite@latest . -- --template react-ts --yes && cd ..
cd overlay && npm create vite@latest . -- --template react-ts --yes && cd ..

# 3. Server dependencies
cd server && python3 -m venv .venv && source .venv/bin/activate
pip install fastapi uvicorn websockets numpy pydantic python-dotenv qrcode pillow
pip freeze > requirements.txt && cd ..

# 4. Mobile dependencies
cd mobile && npm install @mediapipe/tasks-vision && cd ..

# 5. Overlay dependencies
cd overlay && npm install pixi.js && cd ..
```

Then all three write `shared/protocol.ts` together (see Protocol section below).
Person A mirrors it to `server/protocol.py` as Pydantic models.

**Kickoff is done when:** repo has the full directory structure, both Vite apps build (`npm run build`), server starts (`python server/main.py --help`), and `shared/protocol.ts` is committed.

---

## Shared Protocol (Lock at Kickoff)

Write `shared/protocol.ts` together. This is the canonical message spec. No one changes it unilaterally after kickoff -- open a PR and all three review.

```typescript
// shared/protocol.ts

export interface PoseKeypoint {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

// Mobile -> Server
export interface MsgJoin {
  type: "join";
  room_code: string;
  player_slot: 1 | 2;
}
export interface MsgPoseFrame {
  type: "pose_frame";
  timestamp: number;
  keypoints: PoseKeypoint[];  // always 33
}
export interface MsgCalibrationDone {
  type: "calibration_done";
  reference_velocity: number;
}
export interface MsgPing {
  type: "ping";
  t: number;
}

// Server -> Mobile
export interface MsgJoined {
  type: "joined";
  room_code: string;
  player_slot: 1 | 2;
  opponent_connected: boolean;
}
export interface MsgPong {
  type: "pong";
  t: number;
}
export interface MsgCalibrationStart {
  type: "calibration_start";
}
export interface MsgMatchStart {
  type: "match_start";
}
export interface MsgYouWereHit {
  type: "you_were_hit";
  region: string;
  damage: number;
}

// Server -> Overlay (spectator)
export interface HitEvent {
  player: 1 | 2;
  region: string;
  damage: number;
  position: { x: number; y: number; z: number };
}
export interface MsgGameState {
  type: "game_state";
  tick: number;
  hp: [number, number];
  poses: [PoseKeypoint[], PoseKeypoint[]];
  recent_hits: HitEvent[];
  high_latency: boolean;
}
export interface MsgRoundStart {
  type: "round_start";
  round_number: number;
}
export interface MsgRoundEnd {
  type: "round_end";
  winner: 1 | 2;
  final_hp: [number, number];
}
export interface MsgMatchEnd {
  type: "match_end";
  winner: 1 | 2;
}
```

---

## Development Mocks

B and C must not block on A. Each person keeps a local mock.

**Person B's mock server** (`mobile/mock-server.cjs`): simple Node `ws` server that accepts connections and responds to `join` with `joined`, and to `ping` with `pong`. Echoes pose frames back as `game_state`.

**Person C's mock server** (`overlay/mock-server.cjs`): pushes a synthetic `game_state` every 16ms with slowly rotating keypoints so the renderer can be developed without a real game.

Both mocks are throwaway scripts, not committed to the final codebase.

---

## Checkpoints

Checkpoints are go/no-go gates. All three compare progress before moving to the next sprint. Post a short message in your team channel with your checkpoint status.

### Checkpoint 0: Kickoff Complete

- [ ] A: Repo scaffolded, server starts without error
- [ ] B: Mobile Vite app builds and runs in browser
- [ ] C: Overlay Vite app builds and runs in browser
- [ ] All: `shared/protocol.ts` committed, all three have pulled it

### Checkpoint 1: Sprint 1 Done (end of Sprint 1)

Go criteria -- all three must be true before anyone starts Sprint 2:

- [ ] A: `python server/main.py` prints tunnel URL + QR code. WebSocket client can connect to `/ws/player/{room}` and see connect log. `POST /rooms` returns a code. Pose frames echoed back.
- [ ] B: Mobile browser opens camera, extracts 33 keypoints via MediaPipe, streams `pose_frame` messages to server. Server logs confirm receipt.
- [ ] C: Overlay browser renders a two-panel stick figure skeleton from mock `game_state` data. PixiJS canvas fills the screen.

If A is not done, B and C continue against their mocks. Do not block.

### Checkpoint 2: Sprint 2 Done (end of Sprint 2)

- [ ] A: 60Hz game loop running, hits logged to server console when poses show punch or kick velocity above threshold. RTT measured per player. Input delay applied.
- [ ] B: Calibration flow complete (3 jabs + neutral, `calibration_done` sent). Latency warning shown when server signals high RTT. All server-to-mobile messages handled.
- [ ] C: Both player skeletons render from live `game_state`. HP bars update. Cubic interpolation running between ticks. Hit sparks fire on `recent_hits`.

### Checkpoint 3: Sprint 3 Done (end of Sprint 3)

- [ ] A: Full damage formula live. HP deducted on hits. Round timer (90s). Best-of-3 round flow. `round_start`, `round_end`, `match_end` broadcast correctly.
- [ ] B: All match flow messages handled on mobile. "You were hit" screen flash with region name. Match end screen.
- [ ] C: Round start/end overlays. Match end screen with winner. SFX wired. Parallax background.

### Checkpoint 4: Integration Complete (end of Sprint 4)

- [ ] All: End-to-end match test over Cloudflare tunnel (non-LAN) passes
- [ ] All: Player disconnect mid-match handled gracefully
- [ ] All: `scripts/dev.sh` starts all three locally
- [ ] All: README complete with install steps, run instructions, architecture diagram, challenges section

---

## Integration Sync Points (Mid-Sprint)

These are informal -- no gate, just a quick check when both sides are ready.

| When | Who | What |
|------|-----|------|
| A finishes WS endpoints | A + B | B switches from mock to real server, confirms pose frames arrive |
| A finishes WS endpoints | A + C | C switches from mock to real server, confirms `game_state` renders |
| A finishes RTT loop | A + B | B's ping/pong shows real RTT numbers |
| A broadcasts `recent_hits` | A + C | C fires sparks on real hit events |
| A broadcasts damage + HP | C | C's HP bars reflect real game state |
| B finishes calibration | A + B | A receives `calibration_done`, stores `reference_velocity` |

---

## Constraints (Apply to All Three)

- All WS messages are JSON, no binary frames
- No accounts, no database, rooms are in-memory and ephemeral
- No em dashes in comments, docs, or UI text
- Comments explain why, not what
- Files stay under 500 lines -- split if they grow past that
- Run tests after every code change: `npm test` (mobile/overlay), `pytest server/tests/` (server)
- Never hardcode API keys or credentials

---

## Running the Full Stack Locally

```bash
# Terminal 1 -- server (TUNNEL=false for LAN testing)
cd server && TUNNEL=false python main.py

# Terminal 2 -- mobile
cd mobile && npm run dev

# Terminal 3 -- overlay
cd overlay && npm run dev
```

Or use `bash scripts/dev.sh` once Person A writes it.

Mobile URL for local testing: `http://localhost:5173?server=http://localhost:8000`
Overlay URL: `http://localhost:5174?server=http://localhost:8000&room=<code>`
