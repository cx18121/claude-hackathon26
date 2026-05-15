# Roadmap: PoseEngine

## Milestones

- ✅ **v1.0 PoseEngine MVP** — Phases 1–9 (shipped 2026-05-10) — [archive](.planning/milestones/v1.0-ROADMAP.md)
- 🚧 **v2.0 First-Person Boxing** — Phases 10–14 (in progress)

## Phases

<details>
<summary>✅ v1.0 PoseEngine MVP (Phases 1–9) — SHIPPED 2026-05-10</summary>

- [x] Phase 1: Engine Core (5/5 plans) — completed 2026-05-02
- [x] Phase 2: Plugin Trait + Boxing (6/6 plans) — completed 2026-05-02
- [x] Phase 3: Second Game + SDK (3/3 plans) — completed 2026-05-03
- [x] Phase 4: Lobby UX (3/3 plans) — completed 2026-05-06
- [x] Phase 5: Mobile Connection UX (1/1 plans) — completed 2026-05-06
- [x] Phase 6: Overlay Fidelity (2/2 plans) — completed 2026-05-10
- [x] Phase 7: Dance Engine + Protocol (3/3 plans) — completed 2026-05-10
- [x] Phase 8: Dance UX Design (1/1 plans) — completed 2026-05-10
- [x] Phase 9: Dance Frontend (4/4 plans) — completed 2026-05-10

</details>

### 🚧 v2.0 First-Person Boxing (In Progress)

**Milestone Goal:** A laptop-native, single-device FPS boxing game where the webcam tracks punches and renders a first-person Three.js view — no phone required.

- [x] **Phase 10: FPSBoxingPlugin** - New Rust crate implementing GamePlugin for fps_boxing rooms
- [x] **Phase 11: Lobby + Room Updates** - Expose fps_boxing in the game picker and room page
- [x] **Phase 12: FPS Client Scaffold** - New fps/ Vite app with WebSocket connection and webcam permission
- [x] **Phase 13: MediaPipe + Calibration** - Webcam pose detection in a Web Worker with calibration step
- [ ] **Phase 14: Three.js Renderer + Game Loop** - Full first-person rendering, hit feedback, and game loop HUD

## Phase Details

### Phase 10: FPSBoxingPlugin
**Goal**: The server can host fps_boxing rooms with authoritative hit detection, HP tracking, and per-tick opponent state broadcast
**Depends on**: Nothing (new crate, no engine changes required)
**Requirements**: FPSP-01, FPSP-02, FPSP-03, FPSP-04
**Success Criteria** (what must be TRUE):
  1. A client can create a room with game_type "fps_boxing" and the server routes it to FPSBoxingPlugin
  2. The server emits MsgFpsState to each player every tick containing opponent's 6 arm landmarks, HP, and round timer
  3. The server emits MsgFpsHit to the receiving player on each confirmed hit with punch type and damage
  4. FPSBoxingPlugin's game_type() returns "fps_boxing" and a Rust test asserts it is not "boxing"
**Plans**: 4 plans
Plans:
- [x] 10-01-PLAN.md — fps_boxing Rust crate scaffold + Cargo workspace registration (FPSP-01)
- [x] 10-02-PLAN.md — Hit detection + damage logic (FPSP-02, FPSP-03)
- [x] 10-03-PLAN.md — HP tracking + MsgFpsState broadcast per tick (FPSP-02, FPSP-04)
- [x] 10-04-PLAN.md — MsgFpsHit dispatch + game_type() test (FPSP-03, FPSP-04)

### Phase 11: Lobby + Room Updates
**Goal**: Players can discover and enter fps_boxing rooms from the existing lobby UI
**Depends on**: Phase 10
**Requirements**: LBY-01, LBY-02
**Success Criteria** (what must be TRUE):
  1. "FPS BOXING" tile is visible on the SPECTRE game picker alongside Boxing and Dance
  2. The room page for an fps_boxing room shows P1/P2 laptop join links and hides the Overlay QR card
**Plans**: TBD
**UI hint**: yes

### Phase 12: FPS Client Scaffold
**Goal**: The fps/ Vite app exists, connects to the server via WebSocket, requests webcam permission, and shows a waiting screen
**Depends on**: Phase 11
**Requirements**: LBY-03, LBY-04, WCI-03
**Success Criteria** (what must be TRUE):
  1. The browser prompts for webcam permission with a clear message before the game view loads
  2. MediaPipe WASM and GPU delegate are pre-warmed on page load before the game can start
  3. A waiting screen is displayed until both players have joined the room
**Plans**: 4 plans
Plans:
- [x] 12-01-PLAN.md — fps/ project scaffold + /fps Axum route + Dockerfile fps-builder stage
- [x] 12-02-PLAN.md — PermissionScreen component (LBY-03) + App.tsx permission→warmup wiring
- [x] 12-03-PLAN.md — useGameSocket copy + WaitingScreen component (LBY-04)
- [x] 12-04-PLAN.md — useWarmup hook + WarmupScreen + pose.worker.ts copy + App.tsx final wiring (WCI-03)
**UI hint**: yes

### Phase 13: MediaPipe + Calibration
**Goal**: The player's webcam pose is tracked off the main thread, filtered for jitter, and calibrated to their arm length before a match starts
**Depends on**: Phase 12
**Requirements**: WCI-01, WCI-02, WCI-04
**Success Criteria** (what must be TRUE):
  1. MediaPipe PoseLandmarker runs in a Web Worker and landmark data reaches the main thread without dropping Three.js frame rate
  2. Raw landmark stream is smoothed by OneEuroFilter — jitter false-positives are eliminated at rest
  3. Player completes an arm-length calibration step (video preview + 3-punch prompt) and receives MsgMatchStart from the server
**Plans**: 3 plans
Plans:
- [x] 13-01-PLAN.md — Install 1eurofilter + implement usePose (workerRef, detection loop) + useOneEuroFilter (99 stateful instances) — WCI-01, WCI-02
- [x] 13-02-PLAN.md — Copy velocity.ts from mobile/ + adapt useCalibration (import path only) + CalibrationScreen (video preview + stage UI) — WCI-04
- [x] 13-03-PLAN.md — Wire App.tsx: usePose + useOneEuroFilter + CalibrationScreen + MsgCalibrationDone send + match phase routing — WCI-01, WCI-02, WCI-04
**UI hint**: yes

### Phase 13.1: Punch Classifier Model (INSERTED)
**Goal**: A trained ONNX punch classifier (<500KB, <2ms inference) distinguishes jab/cross/hook_l/hook_r/guard from MediaPipe landmarks with >85% accuracy across diverse users, integrated into fps/ as usePunchClassifier hook
**Depends on**: Phase 13
**Requirements**: TBD
**Success Criteria** (what must be TRUE):
  1. Temporal MLP or 1D CNN trained on BoxingVI + webcam recordings achieves >85% accuracy across 5 punch classes
  2. Exported ONNX model is <500KB quantized, runs <2ms per inference in onnxruntime-web WASM
  3. usePunchClassifier hook consumes useOneEuroFilter output and returns { type, confidence, speed } at 30fps
  4. Hook vs. cross disambiguation works correctly using MediaPipe z-coordinate
**Plans**: 3 plans
Plans:
- [x] 13.1-01-PLAN.md — ml/ scaffold: requirements.txt, README.md, extract_keypoints.py, record_webcam.py
- [x] 13.1-02-PLAN.md — train.py + export_onnx.py + quantize.py + fps/public/models/ placeholder
- [x] 13.1-03-PLAN.md — onnxruntime-web install + normalizeWindow.ts (2 tests) + usePunchClassifier hook (6 tests)

### Phase 14: Three.js Renderer + Game Loop
**Goal**: Players see a first-person boxing view with animated arms, opponent rendering, hit feedback, and a full game loop HUD
**Depends on**: Phase 13
**Requirements**: FPR-01, FPR-02, FPR-03, FPR-04, HFB-01, HFB-02, HFB-03, HFB-04, GML-01, GML-02, GML-03, GML-04
**Success Criteria** (what must be TRUE):
  1. Player sees their own cartoonish arms in first-person that mirror real-time MediaPipe wrist/elbow positions, depth-separated from the scene
  2. Player arms visually extend/stretch when a punch is thrown; opponent arms are rendered from server-supplied keypoints with lerp smoothing
  3. Camera shakes on incoming hit, HP bar drains smoothly in the HUD, and opponent arm snaps back on a landed punch
  4. Round timer, win counter, and match end screen with rematch option are visible and functional during play
  5. Player can start a solo match against a bot and can raise arms to guard against incoming punches
**Plans**: 5 plans
Plans:
- [ ] 14-01-PLAN.md — Install three@0.184.0; extend useGameSocket; coordinateMap + armGeometry utils; useGameRenderer dual-scene loop; GameRenderer component; App.tsx wiring (FPR-01, FPR-03, FPR-04)
- [ ] 14-01b-PLAN.md — Per-frame GPU latency assertion (pose.worker.ts + usePose.ts); Y-axis sign + OutlineEffect verification spikes (D-15)
- [ ] 14-02-PLAN.md — springPhysics + guardDetection modules; wire spring extension + opponent lerp + guard detection into useGameRenderer (FPR-02, FPR-03, GML-04)
- [ ] 14-03-PLAN.md — useBoxingAudio synthesis; camera shake + opponent snap-back + hit flash wired to MsgFpsHit (HFB-01, HFB-02 partial, HFB-03, HFB-04)
- [ ] 14-04-PLAN.md — GameHud component + CSS; HP bars + timer + win counter + match-end overlay + rematch flow + guard multiplier; human verify checkpoint (HFB-02, GML-01, GML-02, GML-03, GML-04)
**UI hint**: yes

## Progress

| Phase | Plans Complete | Milestone | Status | Completed |
|-------|----------------|-----------|--------|-----------|
| 1. Engine Core | 5/5 | v1.0 | Complete | 2026-05-02 |
| 2. Plugin Trait + Boxing | 6/6 | v1.0 | Complete | 2026-05-02 |
| 3. Second Game + SDK | 3/3 | v1.0 | Complete | 2026-05-03 |
| 4. Lobby UX | 3/3 | v1.0 | Complete | 2026-05-06 |
| 5. Mobile Connection UX | 1/1 | v1.0 | Complete | 2026-05-06 |
| 6. Overlay Fidelity | 2/2 | v1.0 | Complete | 2026-05-10 |
| 7. Dance Engine + Protocol | 3/3 | v1.0 | Complete | 2026-05-10 |
| 8. Dance UX Design | 1/1 | v1.0 | Complete | 2026-05-10 |
| 9. Dance Frontend | 4/4 | v1.0 | Complete | 2026-05-10 |
| 10. FPSBoxingPlugin | 4/4 | v2.0 | Complete | 2026-05-13 |
| 11. Lobby + Room Updates | 1/1 | v2.0 | Complete | 2026-05-13 |
| 12. FPS Client Scaffold | 4/4 | v2.0 | Complete | 2026-05-13 |
| 13. MediaPipe + Calibration | 3/3 | v2.0 | Complete | 2026-05-13 |
| 13.1. Punch Classifier Model | 3/3 | v2.0 | human_needed (scaffold verified; accuracy/latency require training) | - |
| 14. Three.js Renderer + Game Loop | 0/4 | v2.0 | Not started | - |
