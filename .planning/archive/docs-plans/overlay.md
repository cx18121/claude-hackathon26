# Person C: Overlay Renderer Plan

**Stack:** Vite, React 18, TypeScript, pixi.js v8  
**Directory:** `/overlay`  
**Reference:** [project.md](project.md) for checkpoints and protocol

Tell Claude Code: "Work through the tasks in this file in order. Complete each task fully before moving to the next. Use the mock server during Sprint 1 and 2 until the real server is ready."

---

## Before You Start

1. Pull the repo and confirm kickoff is done (Checkpoint 0 in project.md)
2. `cd overlay && npm install pixi.js`
3. Copy `shared/protocol.ts` into `overlay/src/protocol.ts`
4. Start your mock game state server (see below)

---

## Contracts with Person A (server) and Person B (mobile)

The overlay does not redefine any schema or endpoint owned by A or B. Treat the sibling plan files as the source of truth and import generated types from `shared/protocol.ts` -- never redeclare them locally. If a runtime payload appears to drift from `project.md`, fix the consumer, not the schema.

- **Inbound (server -> overlay):** WebSocket spectator endpoint at `{serverUrl}/ws/spectator/{roomCode}`. See [`server.md`](server.md) Task 1.5 (lines 167-177) for endpoint contract and [`server.md`](server.md) Task 2.5 (line 342) for the broadcast point in the game loop. Message schemas (`MsgGameState`, `MsgRoundStart`, `MsgRoundEnd`, `MsgMatchEnd`, `HitEvent`, `PoseKeypoint`) are defined in [`project.md`](project.md) "Shared Protocol" (lines 77-164).
- **Outbound (overlay -> server):** none. The spectator socket is read-only -- no `Join`, no `Ping`, no client messages. If you find yourself wanting to send something, push the requirement back to A so it lands in `server.md` and `project.md` first.
- **Pose coordinate convention:** mobile streams MediaPipe world coordinates -- x is left/right, y is up (negative y = up), z is depth. Overlay flips y for screen rendering. See [`mobile.md`](mobile.md) Task 1.3 for the upstream definition.
- **Production hosting:** Person A serves `overlay/dist` as static files at `/overlay` per [`server.md`](server.md) Task 3.4 (line 401). The build output must be a self-contained static bundle -- no dev-server-only imports.
- **Project-level checkpoints:** overlay deliverables map to [`project.md`](project.md) Checkpoint 1 (line 189) and Checkpoint 4 (line 211).

---

## Mock Server for Local Development

Create `overlay/mock-server.cjs` (throwaway, not committed to final codebase):

```javascript
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ port: 8002 });

// 33 keypoints in roughly neutral standing pose (MediaPipe world coordinates)
// x=left/right, y=up/down (negative=up in MediaPipe), z=depth
const neutral = Array.from({ length: 33 }, (_, i) => ({
  x: (Math.random() - 0.5) * 0.3,
  y: -0.5 + i * 0.04,
  z: 0,
  visibility: 1
}));

function jitter(poses) {
  return poses.map(p => ({ ...p, x: p.x + (Math.random() - 0.5) * 0.01 }));
}

wss.on('connection', (ws) => {
  console.log('mock: spectator connected');
  ws.send(JSON.stringify({ type: 'round_start', round_number: 1 }));
  let tick = 0;
  const interval = setInterval(() => {
    ws.send(JSON.stringify({
      type: 'game_state',
      tick: tick++,
      hp: [100 - Math.floor(tick / 60), 100],
      poses: [jitter(neutral), jitter(neutral)],
      recent_hits: tick % 90 === 0 ? [{ player: 2, region: 'head_face', damage: 15, position: { x: 0.1, y: -0.8, z: 0 } }] : [],
      high_latency: false,
      remaining_time: 90 - tick / 60
    }));
  }, 16); // ~60fps
  ws.on('close', () => clearInterval(interval));
});
console.log('Mock spectator server on ws://localhost:8002');
```

Run with: `node overlay/mock-server.cjs`

---

## Sprint 1: PixiJS Canvas + Skeleton Rendering

Goal: Laptop browser renders two stick figure silhouettes from `game_state` pose data. The canvas is full-screen and the skeletons update in real time.

### Task 1.1 -- App shell (`overlay/src/App.tsx`)

Replace the Vite default. The overlay has no user input -- it just connects and renders.

```typescript
// Read connection params from query string:
const params = new URLSearchParams(window.location.search);
const serverUrl = params.get('server') ?? 'ws://localhost:8002';
const roomCode = params.get('room') ?? 'MOCK01';

// App renders:
//   <PixiCanvas /> -- full screen, z-index 0
//   <HudLayer />   -- React DOM overlay for HP bars, timer, text (z-index 1, pointer-events: none)
```

The PixiJS canvas handles all animation. The HUD (HP bars, timer, round overlays) can be React DOM elements absolutely positioned over the canvas, since they do not need per-frame GPU rendering.

**Verify:** `npm run dev` -- browser shows a black full-screen canvas.

### Task 1.2 -- WebSocket spectator client (`overlay/src/hooks/useSpectatorSocket.ts`)

```typescript
// useSpectatorSocket(serverUrl: string, roomCode: string): {
//   gameState: MsgGameState | null;
//   roundState: { number: number; phase: 'waiting' | 'active' | 'ended' } | null;
//   matchWinner: 1 | 2 | null;
//   connected: boolean;
// }
//
// Connects to: {serverUrl}/ws/spectator/{roomCode}
// On message, parse JSON and route by type:
//   'game_state'           -> setGameState
//   'round_start'          -> setRoundState({ number, phase: 'active' })
//   'round_end'            -> setRoundState({ ..., phase: 'ended' }), brief display
//   'match_end'            -> setMatchWinner
//   'player_disconnected'  -> setDisconnectBanner({ player: N }); auto-clear on next game_state
//                             (broadcast by server -- see server.md line 459. Treat as transient.)
//
// Unknown message types: log and ignore. The server may add new types -- never crash on them.
//
// Auto-reconnect on disconnect: wait 1s, retry indefinitely (spectators are stateless)
// Use ws:// if serverUrl starts with http://, wss:// if https://
```

**Verify:** Connect to mock server. `gameState` updates at ~60fps. Log `hp` values to confirm they change.

### Task 1.3 -- MediaPipe skeleton connections

Create `overlay/src/lib/skeleton.ts`:

```typescript
// CONNECTIONS: [number, number][]
// The 35 bone pairs from the MediaPipe 33-point pose model
// Reference: https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
//
// Key connections:
//   Face: 0-1, 1-2, 2-3, 3-7, 0-4, 4-5, 5-6, 6-8
//   Torso: 11-12, 11-23, 12-24, 23-24
//   Left arm: 11-13, 13-15, 15-17, 15-19, 15-21, 17-19
//   Right arm: 12-14, 14-16, 16-18, 16-20, 16-22, 18-20
//   Left leg: 23-25, 25-27, 27-29, 27-31, 29-31
//   Right leg: 24-26, 26-28, 28-30, 28-32, 30-32
//
// Export the full list as a typed constant array
```

### Task 1.4 -- PixiJS canvas and skeleton renderer (`overlay/src/components/PixiCanvas.tsx`)

```typescript
// PixiCanvas: React component that owns the PixiJS Application
//
// On mount:
//   const app = new Application();
//   await app.init({
//     background: '#1a1a2e',
//     resizeTo: window,
//     antialias: true,
//     resolution: window.devicePixelRatio || 1,  // sharp on retina/4K
//     autoDensity: true,                         // CSS size stays in logical px
//   });
//   containerRef.current.appendChild(app.canvas);
//
// Create two Graphics objects -- one per player -- added to stage
// On each animation frame (app.ticker.add), call drawSkeleton for each player
//
// drawSkeleton(gfx: Graphics, keypoints: PoseKeypoint[], side: 'left' | 'right'):
//   gfx.clear()
//   Project 3D keypoints to 2D screen space:
//     Player 1 occupies left half [0, W/2], Player 2 occupies right half [W/2, W]
//     x_screen = half_offset + keypoint.x * scale (flip x for player 2 to face center)
//     y_screen = H * 0.5 + keypoint.y * scale      (y is up in MediaPipe, down in screen)
//     scale = H * 0.4  (tune this to make the figure fill ~40% of screen height)
//   Draw filled circles for each keypoint (radius 6, color 0x000000 -- black silhouette)
//   Draw lines for each connection (lineStyle 4, color 0x000000)
//   Fill the silhouette by drawing the hull as a filled polygon (optional for Sprint 1, add if time permits)
//
// Props: { poses: [PoseKeypoint[], PoseKeypoint[]] | null }
// If poses is null, draw nothing (show black canvas)
```

**Checkpoint 1 deliverable:** Two stick figures appear on screen and update in real time from the mock server's jittered neutral pose.

---

## Sprint 2: Two-Player Rendering + Interpolation + HUD

### Task 2.1 -- Cubic interpolation (`overlay/src/lib/interpolate.ts`)

The server sends `game_state` at 60Hz but the browser runs at ~60fps. Interpolation smooths over jitter.

```typescript
// interpolatePoses(
//   prev: PoseKeypoint[],
//   next: PoseKeypoint[],
//   t: number  // 0 to 1
// ): PoseKeypoint[]
//   Cubic (Hermite) interpolation between prev and next for each keypoint
//   For each keypoint i:
//     x = hermite(prev[i].x, next[i].x, t)
//     y = hermite(prev[i].y, next[i].y, t)
//     z = hermite(prev[i].z, next[i].z, t)
//   visibility: linear interpolation
//
// hermite(a, b, t):
//   Simple cubic: t * t * (3 - 2 * t) smoothstep is fine for this use case
//   return a + (b - a) * (t * t * (3 - 2 * t))
```

In `PixiCanvas`, track the last two `game_state` messages and compute `t` as:
```
if (lastTickTime == null) t = 1            // first frame: render the latest pose as-is
else t = (performance.now() - lastTickTime) / expectedTickInterval
t = Math.max(0, Math.min(1, t))            // clamp -- guards against NaN/Infinity
```

Use `interpolatePoses` to compute the displayed pose on each animation frame.

### Task 2.2 -- HUD: HP bars and timer (`overlay/src/components/HudLayer.tsx`)

React DOM overlay (not PixiJS), absolutely positioned over the canvas.

```
Layout:
  Top bar (full width, height 60px):
    Left 40%:  Player 1 HP bar
    Center 20%: Round timer (large digits, countdown from 90)
    Right 40%: Player 2 HP bar (fills right-to-left)
  
  HP bar:
    Background: dark gray rectangle
    Fill: gradient from green (100%) to yellow (50%) to red (0%)
    HP number inside the bar
    Player label above: "P1" / "P2"

Round number indicator: small text below the timer "Round 1 / 3"
```

```typescript
// Props: { hp: [number, number]; remainingTime: number; round: number }
// remainingTime: show as "1:23" (minutes:seconds)
// HP fill width: hp[i] / 100 * 100%
// Color: hsl interpolation, 120deg at 100hp -> 60deg at 50hp -> 0deg at 0hp
```

**Verify:** HP bars show and update from mock server data. Timer counts down.

### Task 2.3 -- Hit sparks (`overlay/src/lib/sparks.ts` + wired into PixiCanvas)

```typescript
// SparkEmitter: manages particle effects in PixiJS
//
// Fields:
//   container: Container  (added to stage above skeleton layer)
//   particles: Particle[]
//
// Particle: { x, y, vx, vy, alpha, radius, color }
//
// emit(x: number, y: number, damage: number):
//   Count = 8 + Math.floor(damage / 3)   (more particles for harder hits)
//   Each particle:
//     angle = random 0..2pi
//     speed = 2 + Math.random() * 4
//     vx = cos(angle) * speed
//     vy = sin(angle) * speed
//     alpha = 1.0
//     radius = 3 + Math.random() * 4
//     color: 0xFFCC00 (yellow-orange spark)
//   Push to particles array
//
// update(dt: number):  called each ticker frame
//   For each particle:
//     x += vx * dt * 60
//     y += vy * dt * 60
//     vy += 0.15 * dt * 60    (gravity)
//     alpha -= 0.03 * dt * 60
//   Remove particles where alpha <= 0
//   Redraw all particles using Graphics
//
// In PixiCanvas: call emit() for each entry in recent_hits, projecting 3D position to screen
// Deduplicate: track last processed tick number, only emit for new ticks
```

### Task 2.4 -- Round overlay (`overlay/src/components/RoundOverlay.tsx`)

Shown briefly (2 seconds) at round start and round end:

```
Round start: large centered text "ROUND {N}" fading in then out
Round end: "ROUND {N} WINNER: PLAYER {N}" with final HP
Match end: full-screen "PLAYER {N} WINS THE MATCH" with a restart hint
```

```typescript
// Use CSS transitions: opacity 0 -> 1 -> 0
// Timing: 0.3s fade in, hold 1.4s, 0.3s fade out
// Controlled by roundState.phase from useSpectatorSocket
```

---

## Sprint 3: Sound + Background + Polish

### Task 3.1 -- Sound effects (`overlay/src/lib/sfx.ts`)

Download 4-6 CC0 audio files from freesound.org. Save to `overlay/public/sfx/`. Suggested searches: "punch impact", "kick whoosh", "crowd cheer", "bell ding".

```typescript
// SfxPlayer: preloads and plays sounds
//
// sounds: Map<string, HTMLAudioElement>
//
// preload(name: string, path: string): void
//   try {
//     const a = new Audio(path);
//     a.addEventListener('error', () => console.warn(`sfx missing: ${path}`));
//     a.load();
//     sounds.set(name, a);
//   } catch (e) { console.warn('sfx preload failed', name, e); }
//
// play(name: string, volume = 1.0): void
//   const src = sounds.get(name);
//   if (!src) return;                            // missing asset -- silent no-op
//   const sound = src.cloneNode(true) as HTMLAudioElement;
//   sound.volume = volume;
//   sound.play().catch(() => {});                // ignore autoplay policy errors
//
// Rule: SFX failures must never block rendering or throw into the React tree.
//
// Sounds to preload:
//   'hit_light'   -> punch sound (for damage < 10)
//   'hit_heavy'   -> heavier hit sound (for damage >= 10)
//   'round_bell'  -> play on round_start
//   'round_end'   -> play on round_end
//   'match_win'   -> play on match_end
//
// Wire into PixiCanvas: call sfx.play() when processing recent_hits
// Wire into RoundOverlay: call sfx.play('round_bell') when round_start received
```

Note: browsers block audio before user gesture. Add a "Click to start audio" button on first load that does `AudioContext.resume()` and is dismissed after one click.

### Task 3.2 -- Parallax background (`overlay/src/components/ParallaxBackground.tsx`)

Three CSS layers, scrolling at different speeds based on a `tick` prop:

```typescript
// Layer 1 (far): dark gradient sky, very slow scroll (1px per 10 ticks)
// Layer 2 (mid): silhouette cityscape PNG or SVG, medium scroll (1px per 5 ticks)
// Layer 3 (near): ground plane, static
//
// Implement as three absolutely positioned divs with backgroundPosition updating
// or as three PixiJS sprites if preferred (keep it simple)
//
// Colors match Shadow Fight 2 aesthetic: deep navy/purple, dark orange accent
// Default (CSS-only, no external assets needed):
//   Sky: linear-gradient(to bottom, #0d0d1a 0%, #1a0d2e 60%, #2d1b4e 100%)
//   Ground: solid #0d0d0d
//   Midground: repeating-linear-gradient with some city block shapes
//
// Optional upgrade: the repo ships /background.png at the root (1536x1024).
//   Copy it into overlay/public/background.png at kickoff and use it as the
//   midground sprite (object-fit: cover, opacity ~0.85, scrolled via
//   background-position-x = -(tick / 5) % imageWidth). If the file is absent,
//   fall through to the CSS-only midground above -- no hard dependency.
```

If you opt into the PNG, also drop the optional repo-provided font (`a-charming-font.zip`, committed in `09012f2`) into `overlay/public/fonts/` and wire it via `@font-face` for the round-banner text in `RoundOverlay`. System fonts are an acceptable fallback -- treat custom fonts as polish.

### Task 3.3 -- Silhouette fill (upgrade skeleton renderer)

Instead of just lines and dots, fill the silhouette black:

```typescript
// In drawSkeleton, after drawing joints:
//   Compute convex hull of the keypoint positions using a simple Graham scan or gift wrapping
//   draw as a filled black polygon
//   Then redraw joint circles and bone lines on top
//
// Or simpler approach: draw each body segment as a filled capsule (rectangle + two semicircles)
// Segment thickness: proportional to the bone length * 0.3
// This gives the Shadow Fight 2 look without computing a hull
```

The capsule approach is strongly recommended -- it is simpler to implement and looks better.

### Task 3.4 -- High-latency warning

When `gameState.high_latency === true`:
```
Show a yellow banner at the bottom of screen:
"High latency detected -- match may feel laggy"
Auto-hide when high_latency returns false
```

---

## Sprint 4: Integration Testing

### Task 4.1 -- Switch to real server

Point overlay at Person A's server. Replace `ws://localhost:8002` with the Cloudflare tunnel URL.

Verify:
- Connects to `/ws/spectator/{code}`
- Receives `game_state` at 60Hz from a real match
- HP bars reflect real damage
- Sparks fire on real hits

### Task 4.2 -- Full match rendering test

With all three components running (server + two mobile clients + overlay):
- Watch a full match from start (calibration) through round end
- Verify round transitions (overlay, timer, HP reset)
- Verify match end screen appears with correct winner

### Task 4.3 -- Performance check

The overlay must run at 60fps on a laptop. Check with browser DevTools:
- PixiJS renderer should not show dropped frames
- Garbage collection should not spike (avoid per-frame allocations in the draw loop)
- If `interpolatePoses` is allocating a new array every frame, move to an in-place update pattern

### Task 4.4 -- Build and serve

```bash
npm run build
# Person A mounts overlay/dist at /overlay on the server
# Test by navigating to https://<tunnel>/overlay?server=...&room=...
```

---

## File Summary

```
overlay/
  src/
    App.tsx
    protocol.ts          (copy from shared/)
    hooks/
      useSpectatorSocket.ts
    lib/
      skeleton.ts
      interpolate.ts
      sparks.ts
      sfx.ts
    components/
      PixiCanvas.tsx
      HudLayer.tsx
      RoundOverlay.tsx
      ParallaxBackground.tsx
  public/
    sfx/
      hit_light.mp3
      hit_heavy.mp3
      round_bell.mp3
      round_end.mp3
      match_win.mp3
  mock-server.cjs        (throwaway, do not commit)
  index.html
  vite.config.ts
  tsconfig.json
  package.json
```

## Verification Commands

```bash
# Sprint 1
node mock-server.cjs &
npm run dev
# Open http://localhost:5174?server=ws://localhost:8002&room=MOCK01
# Two stick figures should appear and move

# Sprint 2
# Same as above -- verify HP bars, sparks fire every 90 ticks

# Sprint 3
# Verify silhouette fill, SFX plays, parallax scrolls

# Sprint 4
npm run build     # must succeed, no TS errors
# Point at real server, run full match test
```

### End-to-End Acceptance (cross-referenced)

Tie each milestone back to the project-wide checkpoints in [`project.md`](project.md):

- **Sprint 1 done** -- maps to [`project.md`](project.md) Checkpoint 1 (line 189). Two stick figures rendered from mock `game_state`. Smoke test:
  ```bash
  node overlay/mock-server.cjs &
  npm --prefix overlay run dev &
  curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5174   # expect 200
  # Open http://localhost:5174?server=ws://localhost:8002&room=MOCK01 -- two skeletons within ~2s
  ```
- **Sprint 2 done** -- HUD + interpolation + sparks visible against mock server.
- **Sprint 3 done** -- SFX, parallax, silhouette fill, latency banner all wired.
- **Sprint 4 done / full match** -- maps to [`project.md`](project.md) Checkpoint 4 (line 211). Run with Person A's server + two mobile clients (Person B). Confirm: round transitions, HP reset between rounds, match-end overlay shows the correct winner, no dropped frames in DevTools Performance panel during a 90s round.

If a contract appears mismatched against `shared/protocol.ts`, stop and resync with Person A before patching locally -- spec drift is the failure mode this section exists to prevent.
