# Requirements: PoseEngine v2.0

**Defined:** 2026-05-12
**Core Value:** The engine must make it trivially easy to add a new pose-based game by implementing a well-defined plugin interface — without touching the engine core or understanding its internals.

## v2.0 Requirements

### Server Plugin

- [ ] **FPSP-01**: Player can start an fps_boxing room that routes to the new FPSBoxingPlugin (game_type = "fps_boxing")
- [ ] **FPSP-02**: FPSBoxingPlugin reuses BoxingPlugin hit detection logic (shared crate dependency, no duplication)
- [ ] **FPSP-03**: Server sends each player a per-tick MsgFpsState containing opponent's 6 arm landmarks, HP values, and round timer
- [ ] **FPSP-04**: Server sends MsgFpsHit to the receiving player on each confirmed hit with punch type and damage data

### Webcam Input

- [ ] **WCI-01**: Player's pose is tracked from laptop webcam via MediaPipe PoseLandmarker running in a Web Worker (off main thread)
- [ ] **WCI-02**: Raw landmark stream is smoothed with OneEuroFilter before punch detection to eliminate jitter false-positives
- [ ] **WCI-03**: MediaPipe WASM and GPU delegate are pre-warmed on page load before the game can be started
- [ ] **WCI-04**: Player completes a brief arm-length calibration step before entering a match (normalizes reach to player's real dimensions)

### First-Person Rendering

- [ ] **FPR-01**: Player sees their own arms in first-person, rendered as cartoonish MeshToonMaterial arms that mirror real-time MediaPipe wrist/elbow positions
- [ ] **FPR-02**: Player arms visually extend/stretch when a punch is thrown (Arms-style extendable arm animation)
- [ ] **FPR-03**: Opponent's arms are rendered in the scene using server-supplied keypoints from MsgFpsState, with lerp smoothing between ticks
- [ ] **FPR-04**: Player arms are rendered in a depth-separated Three.js scene pass so they never clip opponent or scene geometry

### Hit Feedback

- [ ] **HFB-01**: Player's camera shakes when they take a hit
- [ ] **HFB-02**: HP bar drains smoothly in the HUD when a hit lands
- [ ] **HFB-03**: Opponent's arm visibly snaps back when the player's punch connects
- [ ] **HFB-04**: A brief color flash appears on screen when the player successfully lands a punch

### Game Loop

- [ ] **GML-01**: Round timer and round win counter are visible in the first-person HUD during play
- [ ] **GML-02**: A match end screen is shown when a player's HP reaches zero, with a rematch option
- [ ] **GML-03**: Player can start a solo match against a bot opponent (reuses existing bot logic from BoxingPlugin)
- [ ] **GML-04**: Player can raise arms into a guard pose to block incoming punches (ported from BoxingPlugin)

### Lobby

- [ ] **LBY-01**: FPS Boxing appears as a selectable tile on the SPECTRE game picker alongside Boxing and Dance
- [ ] **LBY-02**: Room page for fps_boxing mode hides the Overlay QR card and shows P1/P2 laptop join links instead
- [ ] **LBY-03**: Browser webcam permission is requested with a clear prompt before the player enters the game view
- [ ] **LBY-04**: A waiting screen is shown until both players have joined the room

## Future Requirements

### Commentary

- **COMM-01**: AI commentator delivers real-time audio commentary during matches
- **COMM-02**: Commentary reacts to specific events (big hit, low HP, round end)
- **COMM-03**: Commentary voice is configurable
- **COMM-04**: Commentary can be muted in settings

### AI Game Generation

- **AI-01**: Developer can prompt an LLM with GAME-SDK.md to generate a new GamePlugin implementation in one shot

## Out of Scope

| Feature | Reason |
|---------|--------|
| Phone as input device for FPS mode | FPS mode is laptop-only; phone streaming is for the existing boxing and dance games |
| Spectator overlay for FPS mode | Each player's laptop is their display; no separate observer screen |
| Full body opponent rendering | Research confirmed arms-only is sufficient and avoids 3D character art pipeline |
| HolisticLandmarker | Google's web/JS guide is "coming soon" — use PoseLandmarker only |
| Streaming all 33 landmarks for opponent | Only 6 arm landmarks needed; full payload is ~5× larger with no visual benefit |
| Horizontal scaling / room sharding | Single-process Tokio sufficient for current use |
| User accounts / authentication | 6-char room code model retained |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FPSP-01 | — | Pending |
| FPSP-02 | — | Pending |
| FPSP-03 | — | Pending |
| FPSP-04 | — | Pending |
| WCI-01 | — | Pending |
| WCI-02 | — | Pending |
| WCI-03 | — | Pending |
| WCI-04 | — | Pending |
| FPR-01 | — | Pending |
| FPR-02 | — | Pending |
| FPR-03 | — | Pending |
| FPR-04 | — | Pending |
| HFB-01 | — | Pending |
| HFB-02 | — | Pending |
| HFB-03 | — | Pending |
| HFB-04 | — | Pending |
| GML-01 | — | Pending |
| GML-02 | — | Pending |
| GML-03 | — | Pending |
| GML-04 | — | Pending |
| LBY-01 | — | Pending |
| LBY-02 | — | Pending |
| LBY-03 | — | Pending |
| LBY-04 | — | Pending |

**Coverage:**
- v2.0 requirements: 24 total
- Mapped to phases: 0 (populated by roadmapper)
- Unmapped: 24 ⚠

---
*Requirements defined: 2026-05-12*
*Last updated: 2026-05-12 after initial definition*
