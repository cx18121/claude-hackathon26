# Person B: Mobile Client Plan

**Stack:** Vite, React 18, TypeScript, @mediapipe/tasks-vision  
**Directory:** `/mobile`  
**Reference:** [project.md](project.md) for checkpoints and protocol

Tell Claude Code: "Work through the tasks in this file in order. Complete each task fully before moving to the next. Run the verification step after each task. Use the mock server during Sprint 1 and 2 until the real server is ready."

---

## Before You Start

1. Pull the repo and confirm kickoff is done (Checkpoint 0 in project.md)
2. `cd mobile && npm install`
3. Copy `shared/protocol.ts` into `mobile/src/protocol.ts` (symlink is fine if your OS supports it, copy if not)
4. Start your mock server (see below) so you are not blocked on Person A

---

## Mock Server for Local Development

Create `mobile/mock-server.cjs` (throwaway, not committed to final codebase):

```javascript
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ port: 8001 });

wss.on('connection', (ws) => {
  console.log('mock: client connected');
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.type === 'join') {
      ws.send(JSON.stringify({ type: 'joined', room_code: 'MOCK01', player_slot: msg.player_slot, opponent_connected: false }));
      setTimeout(() => ws.send(JSON.stringify({ type: 'calibration_start' })), 500);
    }
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
    }
    if (msg.type === 'calibration_done') {
      setTimeout(() => ws.send(JSON.stringify({ type: 'match_start' })), 1000);
    }
  });
});
console.log('Mock server on ws://localhost:8001');
```

Run with: `node mobile/mock-server.cjs`

Switch to the real server when Person A signals Checkpoint 1 is done.

---

## CV Rigging Conventions (Reference -- Read Before Coding)

This section is the canonical reference for how pose data is structured throughout the system. The mobile client produces this data; the server consumes it; the overlay renders from it. All three components must agree.

### Coordinate system

MediaPipe `worldLandmarks` returns 3D points in **meters**, relative to the subject's hip midpoint:
- `+X` = subject's right (their right shoulder is at +X)
- `+Y` = down (gravity direction)
- `+Z` = away from camera (subject's back is at +Z, chest at -Z)

Right-handed: `right × up = forward` (where up = -Y, forward = -Z in MediaPipe's frame, but we recompute a per-player basis below).

### MediaPipe 33-landmark index map

Only the indices used by hit detection and rendering are listed; full list at https://developers.google.com/mediapipe/solutions/vision/pose_landmarker.

```
0   nose                  23  left_hip      24  right_hip
11  left_shoulder         25  left_knee     26  right_knee
12  right_shoulder        27  left_ankle    28  right_ankle
13  left_elbow            29  left_heel     30  right_heel
14  right_elbow           31  left_foot     32  right_foot
15  left_wrist            17-22 hand sub-landmarks (pinky/index/thumb, both sides)
16  right_wrist
```

"Left" and "right" are from the **subject's** perspective, not the camera's.

### Bone hierarchy (used by overlay rig and server pose math)

```
hip_center (root, midpoint of 23 and 24)
├── spine        -> shoulder_center (midpoint of 11 and 12) -> nose [0]
├── left_arm     -> 11 -> 13 -> 15  (shoulder, elbow, wrist)
├── right_arm    -> 12 -> 14 -> 16
├── left_leg     -> 23 -> 25 -> 27  (hip, knee, ankle)
└── right_leg    -> 24 -> 26 -> 28
```

The overlay should render bones as line segments between these pairs. The same list is the canonical reference the server uses to derive bone-length skeleton metrics during calibration.

### Per-player body basis (computed from shoulders and hips)

Each player has an orthonormal frame derived from their pose:

```
right    = normalize(right_shoulder - left_shoulder)
up_temp  = normalize(mid_shoulders - mid_hips)
forward  = normalize(cross(right, up_temp))     // points out of the chest
up       = normalize(cross(forward, right))      // re-orthogonalize
```

This basis is what makes the system orientation-invariant. To express attacker's wrist position in defender's local space (which the server's hit detection needs):

```
local_wrist = defender_basis_inverse * (attacker_wrist - defender_hip_center)
```

Where `defender_basis_inverse` is a 3x3 rotation built from the defender's `(right, up, forward)`.

### Visibility filtering

Each landmark has `visibility ∈ [0, 1]`. Treat below 0.5 as unreliable.
- Hit detection: drop frames where any of {wrists 15/16, hips 23/24, shoulders 11/12} have visibility < 0.5
- Overlay: hide bones where either endpoint has visibility < 0.3 (avoid drawing flailing limbs from occlusion noise)

### Z-axis caveat

MediaPipe's z is estimated from monocular depth -- inherently noisy (~5-10cm RMS error). Practical implications:
- Velocity computation: dominated by x/y movement; z noise rarely flips a punch threshold
- Hit detection: use larger capsule radii (8-12cm) to absorb z error
- Overlay: cubic interpolation between ticks visually smooths z jitter

### Smoothing

Apply per-landmark EMA on the **mobile sender** (closer to source = better smoothing):
```
smoothed[i] = prev[i] * (1 - alpha) + raw[i] * alpha
```
Recommended alpha: **0.5** for hackathon. Lower (0.3) for smoother but laggier; higher (0.7) for responsive but jittery.

The server does not smooth -- mobile output is treated as ground truth.

### Frame rate

Mobile target: 30fps capture, 30fps send (throttle if MediaPipe runs faster). Server target: 60Hz tick (interpolates between 30fps pose updates using `interpolate_poses`).

If MediaPipe drops below 30fps on a slow phone, **send every frame anyway** -- the server has interpolation and missing frames degrade gracefully. Just make sure all dt math uses real frame timestamps, not assumed 1/30.

---

## Sprint 1: Camera + MediaPipe + WebSocket

Goal: Mobile browser opens camera, runs MediaPipe at 30fps, streams pose frames to server, and shows connection status.

### Task 1.1 -- App shell (`mobile/src/App.tsx`)

Replace the Vite default with a minimal app shell:

```
App
  ConnectionScreen (shown when not connected)
    ServerUrlInput
    RoomCodeInput
    SlotPicker (1 or 2)
    ConnectButton
  GameScreen (shown when connected)
    CameraView
    CalibrationOverlay (shown during calibration)
    StatusBar
```

Read initial server URL and room code from query params:
```typescript
const params = new URLSearchParams(window.location.search);
const defaultServer = params.get('server') ?? localStorage.getItem('serverUrl') ?? '';
const defaultRoom = params.get('room') ?? '';
```

Persist server URL to localStorage on successful connect.

No CSS frameworks. Use a single `mobile/src/app.css` with minimal styles: dark background (#111), white text, large tap targets (min 48px), system font stack.

**Verify:** `npm run dev` -- browser shows connection screen with inputs.

### Task 1.2 -- Camera access (`mobile/src/hooks/useCamera.ts`)

Create a React hook:

```typescript
// useCamera(videoRef: RefObject<HTMLVideoElement>): {
//   stream: MediaStream | null;
//   error: string | null;
//   ready: boolean;
// }
//
// On mount:
//   navigator.mediaDevices.getUserMedia({
//     video: {
//       facingMode: { ideal: 'environment' },  // rear camera on phones
//       width: { ideal: 640 },
//       height: { ideal: 480 },
//       frameRate: { ideal: 30 }
//     },
//     audio: false
//   })
//   Assign stream to videoRef.current.srcObject
//   Set ready = true when videoRef fires 'loadedmetadata'
//
// Error cases to handle:
//   NotAllowedError -> "Camera permission denied. Allow camera access and reload."
//   NotFoundError   -> "No camera found on this device."
//   Generic         -> "Could not open camera: {error.message}"
//
// Cleanup: stop all tracks on unmount
```

Show the video element in `CameraView` with `style={{ transform: 'scaleX(-1)' }}` to mirror it for a natural selfie view.

**Verify:** Camera opens in mobile browser (or desktop with webcam). Video shows in the browser.

### Task 1.3 -- MediaPipe pose (`mobile/src/hooks/usePose.ts`)

Create a React hook:

```typescript
// usePose(videoRef: RefObject<HTMLVideoElement>, cameraReady: boolean): {
//   keypoints: PoseKeypoint[] | null;   // null until first detection
//   fps: number;
// }
//
// On cameraReady = true:
//   Load PoseLandmarker from @mediapipe/tasks-vision:
//     const vision = await FilesetResolver.forVisionTasks(
//       "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
//     );
//     const landmarker = await PoseLandmarker.createFromOptions(vision, {
//       baseOptions: {
//         modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
//         delegate: "GPU"
//       },
//       runningMode: "VIDEO",
//       numPoses: 1
//     });
//
//   Run inference loop using requestAnimationFrame:
//     const result = landmarker.detectForVideo(videoRef.current, performance.now());
//     if (result.worldLandmarks[0]) {
//       // worldLandmarks gives 3D coordinates in meters, relative to hips
//       setKeypoints(result.worldLandmarks[0].map(lm => ({
//         x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility ?? 0
//       })));
//     }
//
//   Track fps: count frames per second with a rolling counter
//
// Use worldLandmarks (3D, meter-scale) NOT normalizedLandmarks (2D, pixel-scale)
```

Important: `PoseLandmarker.createFromOptions` is async. Show a "Loading pose model..." message while it loads.

**Verify:** With camera open, `keypoints` updates at ~30fps. Log keypoints[0] (NOSE) to console -- z should be near 0, x/y in roughly [-1, 1].

### Task 1.4 -- WebSocket client (`mobile/src/hooks/useGameSocket.ts`)

Create a React hook:

```typescript
// useGameSocket(serverUrl: string, roomCode: string, playerSlot: 1 | 2): {
//   status: 'disconnected' | 'connecting' | 'connected' | 'error';
//   opponentConnected: boolean;
//   phase: 'lobby' | 'calibration' | 'match' | 'ended';
//   lastHit: { region: string; damage: number } | null;
//   highLatency: boolean;
//   rttMs: number;
//   send: (msg: object) => void;
//   connect: () => void;
//   disconnect: () => void;
// }
//
// On connect():
//   Open WebSocket to {serverUrl}/ws/player/{roomCode}
//   On open: send Join message { type: 'join', room_code: roomCode, player_slot: playerSlot }
//   On message: parse JSON, dispatch to handlers
//   On close/error: set status = 'error' or 'disconnected'
//
// Message handlers:
//   'joined'           -> status = 'connected', store opponentConnected
//   'pong'             -> compute RTT = performance.now() - msg.t, update rttMs
//   'calibration_start' -> phase = 'calibration'
//   'match_start'      -> phase = 'match'
//   'you_were_hit'     -> setLastHit, clear after 1500ms
//   'round_end'        -> (store for display)
//   'match_end'        -> phase = 'ended'
//
// Ping loop: send { type: 'ping', t: performance.now() } every 500ms while connected
// Auto-reconnect: on unexpected close, wait 2s and retry up to 5 times
```

**Verify:** Connect to mock server. Console shows `joined` received, phase changes to `calibration` after 500ms.

### Task 1.5 -- Pose streaming (wire it all together in `mobile/src/App.tsx`)

When `status === 'connected'` and `phase` is `'calibration'` or `'match'`:
- Every time `keypoints` updates from `usePose`:
  - Apply EMA smoothing per-landmark (alpha=0.5) to reduce MediaPipe jitter (especially on z)
  - Send the message defined by the locked `shared/protocol.ts`:
    ```typescript
    send({
      type: 'pose_frame',
      timestamp: performance.now() / 1000,
      keypoints                              // 33 smoothed worldLandmarks
    });
    ```
- Throttle to 30fps: only send if at least 33ms have passed since last send (track with a ref).
- Send pose_frames during BOTH calibration and match. The server needs them during calibration to derive per-player skeleton metrics (see Sprint 2). It will ignore them during pre-match phases other than calibration.

**Do not extend `pose_frame` with extra fields.** The server can compute `hip_center`, body basis, and any per-frame derived geometry from the raw 33 keypoints itself. Keeping this message minimal protects the locked protocol and keeps mobile responsibilities small.

Show a small status bar in `GameScreen`:
```
Status bar content:
  Left: connection dot (green=connected, yellow=connecting, red=error)
  Center: room code
  Right: RTT in ms, fps
  Warning banner (red strip) if highLatency: "High latency -- match may feel laggy"
```

**Checkpoint 1 deliverable:** Mobile browser opens camera, pose extracts, frames transmit. Switch from mock server to Person A's server and confirm frames appear in server logs.

---

## Sprint 2: Calibration Flow

> **Division of responsibility for calibration**
>
> Mobile drives the **UX** (T-pose -> punches -> neutral) and computes **only one thing it sends**: `reference_velocity` (the average peak wrist velocity during the 3 punches).
>
> The mobile client streams raw `pose_frame` messages throughout calibration. The server receives them and is responsible for:
> - Deriving skeleton bone lengths from the T-pose window
> - Deriving the player's match-time body basis from the neutral window
> - Cross-validating arm-bone lengths against punch-peak frames
> - Storing all derived metrics on its `PlayerSlot`
>
> The protocol stays as defined in `shared/protocol.ts` -- `MsgPoseFrame` is `{ type, timestamp, keypoints }` and `MsgCalibrationDone` is `{ type, reference_velocity }`. Nothing more is sent from mobile. See `docs/plans/server-todo.md` for the math the server must implement.

The mobile-side flow drives the user through three stages so the server's buffered frames cleanly correspond to T-pose / punch / neutral data:

| Stage | UX goal | Signal mobile provides |
|-------|---------|------------------------|
| **T-pose** (1-2s stable hold) | Player stands still, arms wide | Stage marker -- mobile transitions when 30 stable frames captured |
| **3 punches** | Player throws full-speed punches | Stage marker + per-peak velocity (mobile counts peaks for UX feedback and computes `reference_velocity` to send at the end) |
| **Neutral** (2s stillness in fight stance) | Player holds fight stance | Stage marker -- mobile transitions when stillness detected for 60 consecutive frames |

Server learns which window corresponds to which stage purely from the stage transitions (see Task 2.3 -- the calibration hook sends a small `calibration_stage` notification at each transition, which the server uses to slice its frame buffer). This is a pre-existing message in `MsgCalibrationStart` family; if not, mobile can simply send `{ type: 'calibration_stage', stage: 'tpose' | 'punches' | 'neutral' }` -- coordinate with Person A whether to add this small marker (much simpler than expanding `pose_frame`) or to time-slice on the server using punch-peak detection alone.

### Task 2.1 -- Velocity computation (`mobile/src/lib/velocity.ts`)

```typescript
// Frame = { keypoints: PoseKeypoint[]; t: number }   // t = capture timestamp in ms

// computeWristVelocity(frames: Frame[], wrist: 'left' | 'right'): number
//   frames: last 3 pose frames (oldest first)
//   landmark index: left wrist = 15, right wrist = 16
//   dt = (frames[2].t - frames[0].t) / 1000     // SECONDS, real elapsed time
//   if dt <= 0 or fewer than 3 frames: return 0
//   velocity = distance(frames[2][idx], frames[0][idx]) / dt
//   Returns magnitude in m/s

// Do NOT hardcode 30fps. MediaPipe drops frames on slower phones; using a fixed
// 1/30 dt overestimates velocity by up to 50% under load and breaks calibration.

// This mirrors the server's pose.py logic -- keep them in sync.
```

### Task 2.2 -- Calibration hook (`mobile/src/hooks/useCalibration.ts`)

This hook is purely UX state -- it drives the on-screen instructions and signals stage transitions to the server. All bone-length / basis math lives server-side.

```typescript
// useCalibration(frames: Frame[], phase: string, send: (msg) => void): {
//   stage: 'idle' | 'tpose' | 'punches' | 'neutral' | 'done';
//   punchesRecorded: number;        // 0, 1, 2, 3
//   tposeProgress: number;          // 0..1, fraction of stable hold captured
//   referenceVelocity: number | null;
//   instruction: string;
// }
//
// Stages:
//   'idle': wait for phase === 'calibration'
//     On entry, send { type: 'calibration_stage', stage: 'tpose' } so the
//     server starts buffering the T-pose window.
//
//   'tpose': stable-pose detection
//     Prompt: "Stand facing the camera, arms straight out (T-pose). Hold still."
//     Track stability locally with a simple metric:
//       - keypoint movement < 0.05 m between consecutive frames for 30 frames
//       - shoulder, elbow, wrist, hip visibility > 0.5 on each of those frames
//     When 30 stable frames captured -> advance.
//     On exit, send { type: 'calibration_stage', stage: 'punches' }.
//     If 5 seconds pass without 30 stable frames, show "Adjust position and try again"
//     and stay in this stage.
//
//   'punches': detect 3 punch peaks
//     Use real-dt computeWristVelocity (from velocity.ts).
//     A punch peak: velocity crosses above 1.5 m/s, then drops back below 0.8 m/s.
//     Record peak velocity each time. After 3 peaks, advance.
//     On exit, send { type: 'calibration_stage', stage: 'neutral' }.
//
//   'neutral': 2 seconds of stillness
//     Stillness: wrist velocity < 0.2 m/s for 60 consecutive frames.
//     On exit, advance to 'done'.
//
//   'done': send calibration_done
//     referenceVelocity = average of the 3 punch peak velocities
//     send({ type: 'calibration_done', reference_velocity: referenceVelocity })
//     This matches the locked protocol exactly. No skeleton or basis is sent --
//     the server has been buffering pose_frames the whole time and derives those
//     from its own buffer using the stage markers above.
//
// Instruction text:
//   'idle'    -> "Waiting for server..."
//   'tpose'   -> "Stand facing camera, arms out wide. Hold still. ({tposeProgress*100|0}%)"
//   'punches' -> "Throw 3 punches at full speed! ({punchesRecorded}/3)"
//   'neutral' -> "Hold a fighting stance, still..."
//   'done'    -> "Calibrated! Get ready to fight."
```

> Mobile is intentionally simple here: it only counts punches, detects stillness, and sends three stage markers + one `calibration_done`. All meter-scale geometry (bone lengths, body basis, hitbox scaling) is the server's responsibility. See `docs/plans/server-todo.md`.

### Task 2.3 -- Calibration UI (`mobile/src/components/CalibrationOverlay.tsx`)

Overlay displayed on top of the camera view during calibration. Different visuals per stage:

```
'tpose':
  Silhouette T-pose guide centered on screen (semi-transparent SVG outline).
  Instruction text above: "Match the pose"
  Progress ring around silhouette filling 0..100% as stable frames accumulate.
  Tip text below: "Stand 2m from camera, full body visible."

'punches':
  Large instruction: "Throw 3 punches at full speed! (N/3)"
  Three punch icons in a row, fill green as each peak is detected.
  Brief green ring pulse on every detected peak.

'neutral':
  Instruction: "Hold a fighting stance, still..."
  Countdown ring (2 seconds).

'done':
  Fade overlay out over 500ms, then show "Fight!".
```

**Verify:** Run calibration with mock server.
- Stage transitions logged in mock-server console: `tpose` -> `punches` -> `neutral` -> `calibration_done`.
- T-pose stage completes within ~5 seconds.
- 3 punch peaks detected; `calibration_done` sent with non-zero `reference_velocity`.

---

## Sprint 3: Match Feedback + Polish

### Task 3.1 -- Hit feedback (`mobile/src/components/HitFlash.tsx`)

When `lastHit` is set:
- Flash the screen with a semi-transparent red overlay
- Show the hit region name and damage number in large text
- Auto-clear after 1500ms

```typescript
// Props: { hit: { region: string; damage: number } | null }
// Animation: CSS transition opacity 0 -> 0.6 -> 0 over 1.5s
```

### Task 3.2 -- Round and match messages (handle in `useGameSocket`)

Add handlers for:
- `round_start`: store `roundNumber`, reset any per-round state, show "Round {N}" flash
- `round_end`: show "Round over" with winner and HP
- `match_end`: set `phase = 'ended'`, show match end screen

### Task 3.3 -- Match end screen (`mobile/src/components/MatchEndScreen.tsx`)

```
Full-screen overlay
Winner text: "You win!" or "You lose!" (large, bold)
"Play again" button -> sends a "reset" intention (for now, just reload the page)
```

### Task 3.4 -- Polish

- Portrait-only: add `<meta name="orientation" content="portrait">` and a CSS warning if landscape detected
- Prevent screen sleep: call `navigator.wakeLock.request('screen')` on connect, release on disconnect
- Visual side indicator: small banner at top showing "Player 1" or "Player 2" in the player's color
- On WebSocket error: show error message with "Retry" button instead of a blank screen

---

## Sprint 4: Integration Testing

### Task 4.1 -- Switch to real server

Point the mobile client at Person A's server (via Cloudflare tunnel) and verify:
- Connect and join room with real room code
- Pose frames appear in server logs at ~30fps
- Calibration flow completes end-to-end
- `match_start` received after both players calibrate

### Task 4.2 -- Two-device test

Use two physical phones (or one phone + one desktop with webcam):
- Both connect to same room, different slots
- Verify `opponent_connected: true` message arrives on both
- Both calibrate, verify `match_start` on both
- Throw punches and verify `you_were_hit` messages arrive

### Task 4.3 -- Latency test

Use browser DevTools Network to throttle to "Slow 3G" on one device.
Verify:
- High latency banner appears when RTT > 150ms (server signals this)
- Pose frames still stream (may drop frames, that is OK)

---

## File Summary

```
mobile/
  src/
    App.tsx
    app.css
    protocol.ts         (copy from shared/)
    hooks/
      useCamera.ts
      usePose.ts
      useGameSocket.ts
      useCalibration.ts
    lib/
      velocity.ts
    components/
      ConnectionScreen.tsx
      GameScreen.tsx
      CameraView.tsx
      CalibrationOverlay.tsx
      StatusBar.tsx
      HitFlash.tsx
      MatchEndScreen.tsx
  mock-server.cjs       (throwaway, do not commit)
  index.html
  vite.config.ts
  tsconfig.json
  package.json
```

## Verification Commands

```bash
# Sprint 1
npm run dev
# Open in browser, confirm camera opens, check console for keypoints

# Sprint 2 (with mock server)
node mock-server.cjs &
# Open mobile app pointing at ws://localhost:8001
# Throw punches, confirm calibration_done logged in mock server

# Sprint 3 (with real server)
# Use Person A's server URL from their Checkpoint 1 output

# Sprint 4
npm run build  # must succeed with no TypeScript errors
```
