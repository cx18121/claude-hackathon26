---
phase: 09-dance-frontend
plan: 01
subsystem: overlay
tags: [react, websocket, typescript, dance, game-type-routing]

requires:
  - phase: 07-dance-engine-protocol
    provides: MsgJoined.game_type, MsgDanceBeat, MsgDanceScore types in shared/protocol.ts

provides:
  - useSpectatorSocket exports gameType ('boxing' | 'dance' | null), danceScores [number, number], danceBeat object
  - App.tsx conditionally renders HudLayer (boxing) or DanceHud (dance) based on gameType
  - danceBeatRef MutableRefObject passed to PixiCanvas for ticker-side beat access
  - gameType and danceScores threaded to RoundOverlay

affects: [09-02-dance-hud, 09-03-skeleton, 09-04-match-end-mobile]

tech-stack:
  added: []
  patterns:
    - "game-type routing: gameType state from MsgJoined drives conditional HUD render in App.tsx"
    - "ref-from-state bridge: useRef + useEffect to keep danceBeatRef.current in sync without Pixi re-renders"
    - "raw type-string check for non-union messages: parsed.type === 'joined' handled before console.warn without modifying IncomingMessage union"

key-files:
  created: []
  modified:
    - overlay/src/hooks/useSpectatorSocket.ts
    - overlay/src/App.tsx

key-decisions:
  - "Handle 'joined' via raw type-string check (parsed.type === 'joined') rather than adding MsgJoined to ServerMessage union — avoids modifying the union type and keeps the spectator hook's type narrowing intact"
  - "gameType stays null until MsgJoined arrives — neither HUD renders during this window (overlay shows only Pixi canvas + waiting overlay)"
  - "danceBeat passed to PixiCanvas via MutableRefObject (same pattern as poseStreamRef) to avoid React re-renders in the Pixi hot path"

patterns-established:
  - "Pattern: gameType-conditional HUD rendering — {gameType === 'boxing' && <HudLayer>} / {gameType === 'dance' && <DanceHud>}"
  - "Pattern: stable ref from state for hot-path consumers — useRef(state) + useEffect(() => { ref.current = state }, [state])"

requirements-completed: [DIMPL-01]

duration: 2min
completed: 2026-05-10
---

# Phase 09 Plan 01: Dance WebSocket State Wiring Summary

**useSpectatorSocket gains gameType/danceScores/danceBeat state from four new message handlers; App.tsx conditionally routes to DanceHud vs HudLayer based on gameType, with danceBeatRef passed to PixiCanvas.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-10T21:08:15Z
- **Completed:** 2026-05-10T21:10:15Z
- **Tasks:** 2/2
- **Files modified:** 2

## Accomplishments

### Task 1: Add dance state to useSpectatorSocket

Modified `overlay/src/hooks/useSpectatorSocket.ts`:
- Added `MsgDanceBeat` and `MsgDanceScore` imports from `@shared/protocol`
- Extended `SpectatorSocketState` interface with `gameType`, `danceScores`, `danceBeat`
- Added three `useState` declarations for the new fields
- Inserted four message handlers before `console.warn`: `joined`, `dance_beat`, `dance_score`, `dance_snapshot`
- Added `setDanceScores([0, 0])` and `setDanceBeat(null)` to `rematch_start` handler
- Extended return object to include all three new fields

### Task 2: Game-type routing in App.tsx + danceBeatRef plumbing

Modified `overlay/src/App.tsx`:
- Added `useEffect` to import list
- Added `DanceHud` import (will resolve after 09-02 creates the component)
- Destructured `gameType`, `danceScores`, `danceBeat` from `useSpectatorSocket`
- Created `danceBeatRef` via `useRef(danceBeat)` + `useEffect` to keep it current
- Replaced unconditional `<HudLayer>` with `{gameType === 'boxing' && <HudLayer>}` / `{gameType === 'dance' && <DanceHud>}`
- Added `gameType` and `danceScores` props to `<RoundOverlay>`
- Added `danceBeatRef` prop to `<PixiCanvas>`

## Verification

- TypeScript compiles with zero errors (no DanceHud/PixiCanvas prop errors expected at this stage — both are clean)
- `useSpectatorSocket` return shape includes `gameType`, `danceScores`, `danceBeat`
- App.tsx conditional branch: only one HUD at a time; neither when `gameType` is null

## Commits

| Hash | Task | Description |
|------|------|-------------|
| 1204b4e | Task 1 | feat(09-01): add dance state fields and message handlers to useSpectatorSocket |
| 554d66a | Task 2 | feat(09-01): add game-type routing and danceBeatRef plumbing in App.tsx |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — no hardcoded values or placeholder data introduced. `gameType` starts as `null` (correct pre-joined state). `danceScores` starts as `[0, 0]` (correct initial state, not a UI stub).

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced. The `joined` handler applies the T-09-01-01 mitigation (type guard: only `'boxing' | 'dance'` accepted; unknown strings leave `gameType` as `null`).

## Self-Check: PASSED

- overlay/src/hooks/useSpectatorSocket.ts: FOUND
- overlay/src/App.tsx: FOUND
- Commit 1204b4e: FOUND
- Commit 554d66a: FOUND
