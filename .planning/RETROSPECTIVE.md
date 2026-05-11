# Retrospective: PoseEngine

## Milestone: v1.0 — PoseEngine MVP

**Shipped:** 2026-05-10
**Phases:** 9 | **Plans:** 28

### What Was Built

- Rust Axum + Tokio rewrite of Python game engine — same wire protocol, no client changes
- GamePlugin trait proved by boxing (full hit detection, bot mode) and dance (cosine similarity scoring)
- SPECTRE lobby with QR room cards; mobile fast-join from QR scan
- Dance frontend: DanceHud, beat countdown bar, Pixi.js target pose skeleton, match end screen
- SDK: 800-line developer guide + Rustdoc sufficient for LLM game generation
- 320 new files, ~29,500 Rust LOC + ~6,100 TypeScript LOC

### What Worked

- **Wave-based parallel execution** — Phase 9 Wave 2 ran 3 executor agents in parallel (DanceHud, PixiCanvas, RoundOverlay/mobile); independent file sets meant no merge conflicts on the actual code
- **Design-first before code (Phase 8)** — Full DESIGN.md dance section before any Phase 9 code eliminated ambiguity about skeleton rendering, score display, and match end layout
- **Plugin abstraction** — The GamePlugin trait proved clean enough that DancePlugin had zero engine changes; confirms AI generation will work

### What Was Inefficient

- **Worktree merge management** — CWD drift between Bash tool calls during parallel wave execution caused merge commits to land on worktree branches instead of main; required manual re-merge. Root cause: shell state persisting across tool calls in an unexpected directory.
- **Phase 2 plan count** — ROADMAP showed 5 plans for Phase 2 but the directory had 6 (02-06 was a gap closure added mid-execution). MILESTONES.md total reflects the real count.
- **REQUIREMENTS.md status not updated** — All 67 requirements stayed "Pending" throughout development; traceability table was never updated mid-milestone. Fine at this scale but would hurt a larger team.

### Patterns Established

- `skeletonGfxRef` pattern: Pixi.js objects created inside async init closures must be stored in `useRef` to be accessible from the outer useEffect cleanup
- `dance_snapshot` / `joined` messages handled before `isIncomingMessage` type guard (they are not in the ServerMessage union)
- Phase 8 as a mandatory design phase before any frontend implementation — proved valuable; no rework on Phase 9

### Key Lessons

- Ship the Railway build early in any phase that modifies TypeScript — TypeScript errors that pass `tsc --noEmit` locally (with filtered grep) can still fail the Railway build
- The `void el.offsetWidth` reflow trick for CSS snap-then-drain animations is a reliable, dependency-free pattern worth standardizing
- Parallel worktree execution requires tracking CWD carefully; git operations must always run from repo root

### Cost Observations

- Model mix: ~100% Sonnet 4.6 (executor_model: "sonnet" in config)
- Sessions: ~5 sessions across 15 days
- Notable: Phase 9 executed in a single session with 4 parallel Wave 2 agents

---

## Cross-Milestone Trends

| Metric | v1.0 |
|--------|------|
| Phases | 9 |
| Plans | 28 |
| Duration (days) | 15 |
| Rust LOC | ~29,500 |
| TypeScript LOC | ~6,100 |
| Test count | 270 |
