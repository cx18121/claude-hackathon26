# Phase 14: Three.js Renderer + Game Loop — Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the complete in-game experience for fps_boxing: a first-person Three.js view with live-keypoint-driven arms, opponent rendering, hit feedback (visual + audio), and a full game loop HUD (HP bars, round timer, match end). Everything the player sees and feels while fighting.

</domain>

<decisions>
## Implementation Decisions

### Arm Rendering

- **D-01:** Arms are live-keypoint-driven — shoulder/elbow/wrist positions from `smoothedKeypoints` (already available in App.tsx) drive the 3D geometry each frame. No punch-type classifier needed for animation.
- **D-02:** Geometry approach: Claude's discretion based on what looks most impressive. Reference ARMS for the feel (extendable, rubbery, satisfying), but the final visual should be original — not a carbon copy. Segmented cylinders (upper arm + forearm) are a reasonable baseline.
- **D-03:** Spring physics on arm extension — arms overshoot the wrist target position and settle. Makes punches feel weighty. Use a simple spring integrator (stiffness + damping constants, tuned during implementation).
- **D-04:** Velocity-scaled extension — faster punch = arm stretches further. Use `computeWristPeakSpeed` from `fps/src/lib/velocity.ts` to drive the scale factor.
- **D-05:** Visual style: bold + graphic. Flat color with thick outlines (toon shading). MeshToonMaterial is already in FPR-01 requirements. Strong silhouettes, readable at a glance, cartoonish energy — closer to Street Fighter / Guilty Gear than ARMS exactly.
- **D-06:** Rendering: arms rendered in a depth-separated Three.js scene pass (per FPR-04) so they never clip opponent or background geometry.

### Hit Feel + Feedback

- **D-07:** Camera shake on taking a hit is damage-scaled: small shake for body shots (6-13 dmg), strong shake for head hits (15-25 dmg). Communicates hit region implicitly.
- **D-08:** When player's punch lands: color flash on screen (HFB-04) + opponent arm snaps back (HFB-03) + synthesized impact sound. All three together.
- **D-09:** Sound via Web Audio API — synthesized programmatically (oscillators + noise). No audio assets needed. Punch sound on throw (wrist velocity threshold), impact sound on confirmed hit (`MsgFpsHit` received), blocked sound for `punch_type: "blocked"`.

### Game Loop + HUD

- **D-10:** HUD as HTML overlay on top of the Three.js canvas, not 3D sprites. CSS-animated.
- **D-11:** HP bars: two opposing bars, player's on the left, opponent's on the right. Classic fighting game layout. Color shifts toward red as HP drops below 50%.
- **D-12:** Match end screen: full-screen overlay (slight canvas dim behind it) with bold WIN/LOSE text and a rematch button. Rematch triggers re-calibration flow.
- **D-13:** Round timer displayed prominently between the two HP bars (top center). Counts down from round duration.
- **D-14:** Guard blocking ported from BoxingPlugin — player raises arms to guard position to reduce incoming damage (per GML-04).

### Performance

- **D-15:** GPU delegate for MediaPipe included in Phase 14. Target: 8-15ms inference (from current 40-80ms). Add a per-frame timing assertion in the pose worker to detect silent CPU fallback (flagged blocker in STATE.md).
- **D-16:** Decouple rendering from pose: Three.js runs at 60fps using the last known keypoints + interpolation. MediaPipe runs at 30fps in the existing Web Worker. Arms interpolate smoothly between pose frames.
- **D-17:** OneEuroFilter parameters (min_cutoff=1.0, beta=0.007) should be tuned against live webcam during implementation. Current values are untested defaults.

### Claude's Discretion

- Exact arm geometry (cylinder segments, tube, glove shape) — pick what looks most impressive and most original
- Spring constants (stiffness, damping) — tune during implementation for best feel
- Exact color palette for P1/P2 arms — bold, distinct, not ARMS colors
- Web Audio synth parameters for punch/impact/blocked sounds

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### FPS Client — existing code
- `fps/src/App.tsx` — current screen routing; `showMatch` already mounts `<div id="game-canvas-root" />`. Three.js canvas mounts here.
- `fps/src/hooks/useGameSocket.ts` — `MsgFpsState` (opponent arm landmarks, HP, round_timer) and `MsgFpsHit` (damage, punch_type) parsing. Phase 14 reads these.
- `fps/src/hooks/usePose.ts` — pose hook; `smoothedKeypoints` already flows from here via `useOneEuroFilter`
- `fps/src/lib/velocity.ts` — `computeWristPeakSpeed`, `LANDMARK` constants — needed for velocity-scaled arm extension
- `fps/src/hooks/useOneEuroFilter.ts` — already applied upstream; Phase 14 consumes `smoothedKeypoints` directly

### Wire protocol
- `.claude/worktrees/shared/MsgFpsState.ts` — opponent's 6 arm landmarks + `hp: [number, number]` + `round_timer: number`
- `.claude/worktrees/shared/MsgFpsHit.ts` — `punch_type: string` ("cross" | "body_shot" | "kick" | "blocked") + `damage: number`

### Game rules / damage
- `engine/boxing-core/src/damage.rs` — damage formula: `t = min(1.0, vel / (2 * max(ref, 0.1)))`, region-based base ranges. HP starts at 800.
- `engine/fps-boxing-plugin/src/lib.rs` — `region_to_punch_type()` mapping; hit cooldown logic

### Requirements
- `.planning/REQUIREMENTS.md` — FPR-01..04, HFB-01..04, GML-01..04 are the formal requirements for this phase

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `smoothedKeypoints: PoseKeypoint[] | null` — already available at App level, passed to Phase 14 game component
- `useGameSocket` — already handles `fps_state` and `fps_hit` message types; Phase 14 subscribes to these
- `computeWristPeakSpeed(frames, 'left'|'right')` — drives velocity-scaled arm extension (D-04)
- `LANDMARK` constants in `velocity.ts` — joint indices (LEFT_SHOULDER=11, RIGHT_SHOULDER=12, etc.)

### Established Patterns
- Screen routing via `socket.phase` — `showMatch` is already the condition; Phase 14 mounts inside `<div id="game-canvas-root" />`
- Web Worker for MediaPipe — existing worker in `fps/src/workers/`; GPU delegate optimization targets this worker
- `useRef` for non-reactive game state (Three.js scene, animation frame handle) — consistent with `workerRef` pattern in App.tsx

### Integration Points
- `App.tsx` `showMatch` branch → Phase 14 game component receives `smoothedKeypoints`, `socket`, `videoRef`
- `useGameSocket` emits `fps_state` events → opponent arm rendering
- `useGameSocket` emits `fps_hit` events → hit feedback (shake + flash + sound)
- Socket `send({ type: 'calibration_done', reference_velocity })` → rematch flow reuses existing calibration path

</code_context>

<specifics>
## Specific Ideas

- Visual reference: Street Fighter / Guilty Gear aesthetic for the arms (bold flat color, thick outlines) — NOT a direct ARMS clone
- ARMS is inspiration for the *feel* (spring physics, velocity extension, cartoon energy) only
- Synthesized audio preferred — no asset dependencies

</specifics>

<deferred>
## Deferred Ideas

- Punch type classifier (`usePunchClassifier`) — built in Phase 13.1 but Phase 14 does not call it. Revisit if combo system or per-type damage is added later.
- MediaPipe Holistic (hand landmarks + wrist rotation) — would enable fist orientation detection. Deferred; adds computational cost and changes data format everywhere.
- WebRTC transport — lower latency than WebSocket. Not worth it until GPU delegate is in and baseline latency is measured.
- AI Commentary — already deferred to v3 in PROJECT.md

</deferred>

---

*Phase: 14-Three.js Renderer + Game Loop*
*Context gathered: 2026-05-14*
