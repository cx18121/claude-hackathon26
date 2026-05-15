---
phase: 14-three-js-renderer-game-loop
plan: 01b
type: execute
wave: 1
depends_on: []
files_modified:
  - fps/src/workers/pose.worker.ts
  - fps/src/hooks/usePose.ts
  - fps/src/lib/coordinateMap.ts
  - fps/src/hooks/useGameRenderer.ts
autonomous: true
requirements: []

must_haves:
  truths:
    - "pose.worker.ts posts latency_warning each frame detectForVideo exceeds 25ms (per D-15)"
    - "usePose.ts logs each per-frame latency_warning to console without suppression (warnedRef gate removed)"
    - "Y-axis sign direction verified against live webcam before guard detection or arm rendering ships"
    - "OutlineEffect + autoClear=false dual-scene interaction confirmed working without visual corruption"
    - "coordinateMap.ts JSDoc reflects the confirmed Y-axis sign (not assumed)"
    - "No debug spike code present in useGameRenderer.ts after verification"
  artifacts:
    - path: "fps/src/workers/pose.worker.ts"
      provides: "Per-frame latency_warning postMessage when detectForVideo exceeds 25ms (D-15)"
      contains: "latency_warning"
    - path: "fps/src/hooks/usePose.ts"
      provides: "Per-frame console.warn on latency_warning (warnedRef gate removed)"
    - path: "fps/src/lib/coordinateMap.ts"
      provides: "keypointToWorld() with verified Y-axis sign documented in JSDoc"
      contains: "verified"
    - path: "fps/src/hooks/useGameRenderer.ts"
      provides: "OutlineEffect + autoClear=false interaction confirmed in render block comment"
      contains: "OutlineEffect.*verified"
  key_links:
    - from: "fps/src/workers/pose.worker.ts"
      to: "fps/src/hooks/usePose.ts"
      via: "latency_warning postMessage received and surfaced in console per-frame"
      pattern: "latency_warning"
    - from: "fps/src/lib/coordinateMap.ts"
      to: "fps/src/hooks/useGameRenderer.ts"
      via: "keypointToWorld Y-axis sign used for arm positioning and guard detection — correctness confirmed by spike"
      pattern: "keypointToWorld"
---

<objective>
Add per-frame GPU fallback detection in pose.worker.ts (D-15) and run two inline verification spikes — Y-axis sign direction and OutlineEffect + autoClear=false dual-scene compatibility — to resolve the open research questions before downstream plans build on the coordinate transform and render loop.

Purpose: Plans 14-02 and 14-03 depend on the Y-axis sign being correct (guard detection compares wrist.y vs shoulder.y) and on OutlineEffect + autoClear=false being confirmed working. This plan runs in parallel with 14-01 (touches different files: pose.worker.ts, usePose.ts, and verification annotations on coordinateMap.ts and useGameRenderer.ts). Both 14-01 and 14-01b must complete before 14-02 or 14-03 can execute.

Output: pose.worker.ts emitting per-frame latency_warning; usePose.ts surfacing it without suppression; confirmed Y-axis sign in coordinateMap.ts; OutlineEffect compatibility note in useGameRenderer.ts; no debug code remaining.

Note: coordinateMap.ts and useGameRenderer.ts are read from the 14-01 executor's output. If 14-01 is not yet committed, the executor of this plan must wait for those files to exist before running the spikes. In practice both plans run concurrently; if a sequencing conflict occurs, run Task 1 (pose worker) first independently, then Task 2 after 14-01 files are present.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/14-three-js-renderer-game-loop/14-CONTEXT.md
@.planning/phases/14-three-js-renderer-game-loop/14-RESEARCH.md
@.planning/phases/14-three-js-renderer-game-loop/14-PATTERNS.md

<interfaces>
<!-- Contracts the executor needs for both tasks. -->

From fps/src/workers/pose.worker.ts (current structure before Task 1 edit):
```typescript
// detect branch:
const result = landmarker.detectForVideo(msg.bitmap, ts);
// Task 1 adds timing measurement around this call.
// OutMessage union (to extend with latency_warning):
type OutMessage =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'result'; worldLandmarks: PoseKeypoint[] | null; landmarks: PoseKeypoint[] | null };
// Task 1 adds: | { type: 'latency_warning'; elapsedMs: number }
```

From fps/src/hooks/usePose.ts (existing once-only latency warning pattern — Task 1 upgrades this):
```typescript
// Current behavior: warnedRef prevents repeat console.warn after first high-latency frame.
// D-15 requires: per-frame postMessage to main thread (no suppression via warnedRef).
// usePose.ts onmessage must handle the new 'latency_warning' type.
const warnedRef = useRef(false);  // <-- this gate must be removed for per-frame reporting
```

From fps/src/lib/coordinateMap.ts (created by Plan 14-01 Task 2):
```typescript
// keypointToWorld initial assumption (A2):
// returns new THREE.Vector3(-kp.x * scale, -kp.y * scale, -kp.z * scale)
// JSDoc label: "[ASSUMED A2] — verify against live webcam in Plan 14-01b Task 2 spike"
export function keypointToWorld(kp: PoseKeypoint, scale?: number): THREE.Vector3;
export const WORLD_SCALE: number; // = 2.5
```

From fps/src/hooks/useGameRenderer.ts (created by Plan 14-01 Task 3):
```typescript
// Init useEffect creates renderer with: renderer.autoClear = false
// Tick function render sequence:
//   renderer.clear() → renderer.render(worldScene, worldCamera)
//   → renderer.clearDepth() → outlineEffect.render(armsScene, armsCamera)
// Task 2 adds a verification comment to this render block.
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Per-frame GPU latency assertion in pose.worker.ts (D-15)</name>
  <files>fps/src/workers/pose.worker.ts, fps/src/hooks/usePose.ts</files>
  <read_first>
    - fps/src/workers/pose.worker.ts — read the full file; locate the `detectForVideo` call inside the `detect` branch; understand the existing OutMessage union and post() helper
    - fps/src/hooks/usePose.ts — read the full file; locate the `warnedRef` pattern and the `worker.onmessage` handler; understand that the current once-only warning must be upgraded to per-frame
  </read_first>
  <action>
    Modify fps/src/workers/pose.worker.ts — detect branch only; do not touch init or error handling:

    1. Extend the OutMessage union to add a new variant:
       `| { type: 'latency_warning'; elapsedMs: number }`

    2. Inside the `detect` branch, wrap the `detectForVideo` call with timing measurement:
       ```typescript
       const detectStart = performance.now();
       const result = landmarker.detectForVideo(msg.bitmap, ts);
       const elapsedMs = performance.now() - detectStart;
       if (elapsedMs > 25) {
         post({ type: 'latency_warning', elapsedMs });
       }
       ```
       The latency_warning is posted EVERY frame that exceeds 25ms — no suppression flag.
       Place the timing lines around the detectForVideo call only; the rest of the detect branch (worldLandmarks mapping, result post, bitmap close) is unchanged.

    Modify fps/src/hooks/usePose.ts — worker.onmessage handler only:

    1. Remove the `warnedRef` once-only gate. Delete or comment out:
       - `const warnedRef = useRef(false);`
       - The `if (window.length >= LATENCY_WINDOW && !warnedRef.current)` condition
       - `warnedRef.current = true;`
       - The `console.warn(...)` call inside that block
       (The latency rolling-window logic in `latencyWindowRef` may remain as-is or be removed if redundant — executor's discretion.)

    2. Add a new `'latency_warning'` case inside `worker.onmessage`:
       ```typescript
       if (msg.type === 'latency_warning') {
         console.warn(
           `[pose.worker] GPU fallback: detectForVideo took ${(msg as { elapsedMs: number }).elapsedMs.toFixed(0)}ms (threshold 25ms)`,
         );
       }
       ```
       This fires per-frame, not once — the caller sees ongoing GPU fallback in the console without needing to decode rolling-average logic.

    Do not change any other behavior in usePose.ts (loop scheduling, keypoint state, fps counter).
  </action>
  <verify>
    <automated>cd fps && npm run build 2>&1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - fps/src/workers/pose.worker.ts OutMessage union includes `{ type: 'latency_warning'; elapsedMs: number }` — `grep -c "latency_warning" fps/src/workers/pose.worker.ts` returns >= 2 (type definition + post call)
    - The `post({ type: 'latency_warning'` call is inside the detect branch, after `detectForVideo` — `grep -c "elapsedMs" fps/src/workers/pose.worker.ts` returns >= 2 (measurement + post)
    - No suppression flag around the latency_warning post — `grep -c "warnedRef\|warned" fps/src/workers/pose.worker.ts` returns 0
    - fps/src/hooks/usePose.ts handles `msg.type === 'latency_warning'` — `grep -c "latency_warning" fps/src/hooks/usePose.ts` returns >= 1
    - `warnedRef` is no longer used in usePose.ts for suppression — `grep -v "^\s*//" fps/src/hooks/usePose.ts | grep -c "warnedRef.current = true"` returns 0
    - `npm run build` exits 0
  </acceptance_criteria>
  <done>pose.worker.ts posts latency_warning per frame when detectForVideo > 25ms; usePose.ts surfaces it per-frame in console (D-15)</done>
</task>

<task type="auto">
  <name>Task 2: Verification spikes — Y-axis sign + OutlineEffect/autoClear=false</name>
  <files>fps/src/lib/coordinateMap.ts, fps/src/hooks/useGameRenderer.ts</files>
  <read_first>
    - fps/src/lib/coordinateMap.ts — confirm current keypointToWorld Y negation assumption (JSDoc label [ASSUMED A2]); this file is created by Plan 14-01 Task 2 — wait for it to exist before editing
    - fps/src/hooks/useGameRenderer.ts — locate the init useEffect and the tick function to understand where to inject debug sphere and where the OutlineEffect render call is; this file is created by Plan 14-01 Task 3
    - .planning/phases/14-three-js-renderer-game-loop/14-RESEARCH.md — open questions Q1 (Y-axis sign) and Q7 (OutlineEffect + autoClear=false compatibility)
  </read_first>
  <action>
    This task adds two temporary verification steps, runs them against a live webcam, and then resolves the open research questions by committing the correct code with the assumption either confirmed or corrected.

    **Spike A — Y-axis sign direction:**

    In fps/src/hooks/useGameRenderer.ts init useEffect, add a temporary debug sphere:
    ```typescript
    // SPIKE: debug sphere to verify Y-axis sign. Remove after verification.
    const debugGeo = new THREE.SphereGeometry(0.05, 8, 8);
    const debugMat = new THREE.MeshBasicMaterial({ color: 0xff00ff });
    const debugSphere = new THREE.Mesh(debugGeo, debugMat);
    worldSceneRef.current?.add(debugSphere);
    ```
    In the tick function, position the sphere at the nose landmark (landmark index 0) using `keypointToWorld`:
    ```typescript
    // SPIKE: place debug sphere at nose (landmark 0) to verify Y sign
    if (latestKeypointsRef.current && latestKeypointsRef.current.length > 11) {
      const nose = keypointToWorld(latestKeypointsRef.current[0], WORLD_SCALE);
      debugSphere.position.copy(nose);
    }
    ```
    Run `npm run dev`. Load the game page with webcam. Look at the Three.js canvas during calibration/match phase:
    - If the magenta sphere appears ABOVE the rendered arm cylinders (as expected for nose above shoulders): Y sign is CORRECT — `keypointToWorld` negation is correct; no change needed to `coordinateMap.ts`.
    - If the sphere appears BELOW the arms: Y sign is INVERTED — change `keypointToWorld` to `new THREE.Vector3(-kp.x * scale, kp.y * scale, -kp.z * scale)` (remove Y negation) and update the JSDoc to "Y sign verified: worldLandmarks Y is positive-down; negation NOT applied."
    After verifying, remove the debug sphere code from useGameRenderer.ts and commit the corrected (or confirmed) coordinateMap.ts with JSDoc updated to say "verified" instead of "[ASSUMED A2]".

    **Spike B — OutlineEffect + autoClear=false compatibility:**

    The dual-scene render loop uses `renderer.autoClear = false` to manually control clearing between the world and arms passes. OutlineEffect internally calls `renderer.render()` which may interact unexpectedly with autoClear=false.

    Verify with a live render (run concurrently with Spike A while dev server is up):
    - Check the canvas for visual artifacts:
      - No black/blank frames between passes
      - No ghost outlines from the previous frame bleeding into the world scene
      - The arms scene (with OutlineEffect) renders with black outlines visible on the arm cylinders
      - The world scene (with plain renderer.render) shows no outline bleed-through
    - If artifacts appear: consult RESEARCH.md Pitfall 6. Common fix: confirm `renderer.clearDepth()` is present before `outlineEffect.render(armsScene, armsCamera)` (it should be from Plan 14-01 Task 3). If OutlineEffect overrides autoClear internally, set `outlineEffect.autoClear = false` explicitly.
    - Document the result in a comment inside useGameRenderer.ts above the render block:
      `// OutlineEffect + autoClear=false verified: [CONFIRMED/FIXED: describe what changed]`

    After both spikes are verified, ensure:
    1. Debug sphere code is removed from useGameRenderer.ts
    2. coordinateMap.ts JSDoc reflects the confirmed Y sign (contains word "verified")
    3. useGameRenderer.ts render block has the OutlineEffect verification comment
    4. `npm run build` exits 0 with no debug code remaining
  </action>
  <verify>
    <automated>cd fps && grep -v "^\s*//" fps/src/hooks/useGameRenderer.ts | grep -c "debugSphere\|debugGeo\|debugMat" || echo "0"</automated>
  </verify>
  <acceptance_criteria>
    - Debug sphere code is NOT present in fps/src/hooks/useGameRenderer.ts after the spike (grep returns 0 for debugSphere in non-comment lines)
    - fps/src/lib/coordinateMap.ts JSDoc on `keypointToWorld` contains "verified" — `grep -c "verified" fps/src/lib/coordinateMap.ts` returns >= 1
    - fps/src/hooks/useGameRenderer.ts contains "OutlineEffect.*verified" comment in the render block — `grep -c "OutlineEffect.*verified\|verified.*OutlineEffect" fps/src/hooks/useGameRenderer.ts` returns >= 1
    - `npm run build` exits 0
  </acceptance_criteria>
  <done>Y-axis sign confirmed or corrected; OutlineEffect + autoClear=false interaction documented; RESEARCH.md open questions A2 and Q7 resolved</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| pose.worker detectForVideo timing | Wall-clock time measured inside worker; not security-sensitive but must not block the render thread |
| MediaPipe worldLandmarks → coordinateMap | Keypoint coordinates from pose worker used to position debug sphere; values could be NaN/Infinity on ML failure |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-14-01b-01 | Denial of Service | latency_warning floods console on sustained CPU fallback | accept | Console.warn is fire-and-forget; no state accumulation. Log volume is bounded by 60fps. Acceptable for diagnostic visibility per D-15. |
| T-14-01b-02 | Information Disclosure | NaN keypoint used for debug sphere position during spike | accept | Debug sphere is removed before commit; no production exposure. If a NaN keypoint crashes the spike, skip debug sphere positioning for that frame and continue. |
| T-14-01b-03 | Denial of Service | Spike B: OutlineEffect autoClear interaction causes blank frames | mitigate | Document and fix in the same commit (see Spike B action). The fix (explicit clearDepth or outlineEffect.autoClear=false) must be committed before this plan's SUMMARY is written. |
</threat_model>

<verification>
After plan completes:
1. `cd fps && npm run build` exits 0
2. With GPU on CPU fallback: browser console shows `[pose.worker] GPU fallback: detectForVideo took Xms` each frame that exceeds 25ms — not just once
3. `grep -c "debugSphere" fps/src/hooks/useGameRenderer.ts` returns 0
4. `grep -c "verified" fps/src/lib/coordinateMap.ts` returns >= 1
5. `grep -c "OutlineEffect.*verified\|verified.*OutlineEffect" fps/src/hooks/useGameRenderer.ts` returns >= 1
</verification>

<success_criteria>
- pose.worker.ts posts latency_warning per frame (not once) when detectForVideo > 25ms (D-15)
- usePose.ts per-frame console.warn on latency_warning (warnedRef gate removed)
- Y-axis sign verified against live webcam; coordinateMap.ts JSDoc updated with confirmed result
- OutlineEffect + autoClear=false interaction confirmed; comment in useGameRenderer.ts render block
- No debug spike code in any committed file
- npm run build exits 0
</success_criteria>

<output>
After completion, create `.planning/phases/14-three-js-renderer-game-loop/14-01b-SUMMARY.md`
</output>
