---
phase: 14-three-js-renderer-game-loop
plan: 03
subsystem: fps-renderer
tags: [hit-feedback, camera-shake, web-audio, snap-back, hit-flash, fps-boxing]
dependency_graph:
  requires: [14-01, 14-01b, 14-02]
  provides:
    - fps/src/hooks/useBoxingAudio.ts (useBoxingAudio hook — playThrow, playImpact, playBlocked)
    - shakeStateRef + worldCameraBaseRef in useGameRenderer (Eiserloh trauma-decay camera shake)
    - triggerFlashRef returned from useGameRenderer (wired by GameRenderer to #hit-flash DOM)
  affects:
    - fps/src/hooks/useGameRenderer.ts (hit detection, camera shake, snap-back, audio trigger, flash trigger)
    - fps/src/components/GameRenderer.tsx (hit-flash div, CSS keyframe, triggerFlash wiring)
tech_stack:
  added: []
  patterns:
    - Eiserloh trauma-decay camera shake (trauma² quadratic, decay -2.0/s, worldCamera only)
    - lazy AudioContext (created on first play call — browser autoplay policy compliance)
    - fire-and-forget Web Audio synthesis (no cached buffers, GC handles cleanup)
    - object-reference comparison for hit deduplication (lastFpsHitRef tracks last processed MsgFpsHit)
    - CSS class toggle with forced reflow for re-triggerable keyframe animation
    - ref-callback wiring pattern (triggerFlashRef set by GameRenderer useEffect after mount)
key_files:
  created:
    - fps/src/hooks/useBoxingAudio.ts
  modified:
    - fps/src/hooks/useGameRenderer.ts
    - fps/src/components/GameRenderer.tsx
decisions:
  - "Lazy AudioContext in useRef (not useEffect) — created on first play call, satisfies browser autoplay policy"
  - "Object reference comparison for MsgFpsHit deduplication — avoids JSON.stringify overhead in 60fps loop"
  - "triggerFlashRef wired via GameRenderer useEffect — decouples DOM flash from Three.js loop without prop threading"
  - "Snap-back target clones shoulder positions for both elbow and wrist — full retraction in 3 frames"
  - "snapBackActiveRef blocks opponent target updates from MsgFpsState during snap-back phase"
metrics:
  duration_minutes: 20
  completed_date: "2026-05-15T05:17:12Z"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
---

# Phase 14 Plan 03: Hit Feedback — Camera Shake + Flash + Audio Summary

Camera shake (Eiserloh trauma-decay on worldCamera only), opponent arm snap-back (lambda=80 for 3 frames), 120ms white screen flash (#hit-flash CSS keyframe), and synthesized Web Audio sounds (impact + blocked) all firing together on each new MsgFpsHit received.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Create useBoxingAudio hook with lazy AudioContext and three synthesis functions | 3bc227f |
| 2 | Camera shake + opponent snap-back in useGameRenderer; hit flash in GameRenderer | 127ccc7 |

## What Was Built

**Task 1 — useBoxingAudio Hook:**
- `ctxRef = useRef<AudioContext | null>(null)` — AudioContext created lazily in `getCtx()` on first play call. Satisfies browser autoplay policy (no AudioContext at startup).
- `playThrow()`: 150ms bandpass-filtered white noise burst (800Hz, Q=0.5, gain 0.3→0.001).
- `playImpact(damage)`: damage-scaled sine oscillator (120+intensity×80 Hz → 40Hz over 100ms) plus highpass noise crack (2000Hz cutoff, 50ms). Gain 0.6+intensity×0.4 → 0.001 over 150ms.
- `playBlocked()`: triangle oscillator 300→150Hz over 80ms, gain 0.4→0.001 over 120ms.
- No `useCallback` needed — all functions close over the stable `ctxRef`.

**Task 2 — Hit Feedback Integration:**
- `shakeStateRef { trauma }` and `worldCameraBaseRef` added to useGameRenderer.
- `lastFpsHitRef` tracks previously processed MsgFpsHit by object reference (deduplication without stringify).
- `snapBackActiveRef` + `snapBackFramesRef` (3 frames) for snap-back lerp boost.
- `triggerFlashRef` returned from hook; GameRenderer sets DOM implementation after mount.
- Hit detection block in tick: new hit → add trauma (capped 1.0, T-14-03-01) → retract opponent target → snapBack=true → play audio → trigger flash.
- Camera shake: `trauma² * MAX_TRANSLATE_SHAKE(0.05) * random` on worldCamera.position.x/y; `trauma² * MAX_ROTATION_SHAKE(0.02) * random` on worldCamera.rotation.z. `armsCamera` is untouched.
- Opponent target update skipped while `snapBackActiveRef=true` (prevents MsgFpsState from overriding snap-back target).
- GameRenderer: `<div id="hit-flash">` + `hit-flash-anim` CSS keyframe (120ms, opacity 0.8→0). Re-trigger via remove class → `void el.offsetWidth` → add class.

## Deviations from Plan

None — plan executed exactly as written.

Pre-existing: `three` package was not installed in node_modules at wave start (same state as prior waves). Installed via `npm install three@^0.184.0 --no-save` to enable build verification. This is not a regression — prior plan summaries indicate the same workaround.

## Threat Mitigations Applied

| Threat ID | Mitigation |
|-----------|-----------|
| T-14-03-01 | `trauma = Math.min(1.0, trauma + Math.min(0.6, damage/40))` — double-capped: per-hit addition capped at 0.6, accumulator capped at 1.0. Server cannot cause unbounded shake regardless of damage value. |
| T-14-03-02 | Accepted — fire-and-forget synthesis nodes. AudioContext built-in node limit (~64 Chrome) drops audio on rapid hits; not a crash risk. |
| T-14-03-03 | Accepted — only `"blocked"` branch routes to playBlocked(); all other punch_type values fall through to playImpact(). Unexpected strings from server do not execute untrusted code. |
| T-14-03-04 | Accepted — AudioContext created lazily inside first play call, triggered by game event after player has already interacted with the page (calibration completed). |

## Known Stubs

None introduced by this plan. Previously documented stubs (peakSpeed/4.0 threshold, forearm scale factor, shoulder anchor position) are unchanged from Plan 14-02.

## Self-Check: PASSED

Files created:
- fps/src/hooks/useBoxingAudio.ts: FOUND (3bc227f)

Files modified:
- fps/src/hooks/useGameRenderer.ts: FOUND (127ccc7)
- fps/src/components/GameRenderer.tsx: FOUND (127ccc7)

Commits:
- 3bc227f: FOUND
- 127ccc7: FOUND

Build: `npx vite build` exits 0, 39 modules transformed.
