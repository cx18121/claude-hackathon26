# Phase 6: Overlay Fidelity - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-10
**Phase:** 06-overlay-fidelity
**Areas discussed:** Spec precision level, Achafont scope, Motion spec coverage

---

## Spec precision level

| Option | Description | Selected |
|--------|-------------|----------|
| Fix to exact spec | Every number in DESIGN.md is intentional — fix all deviations | |
| Fix visually noticeable only | Leave small deviations that look identical in practice | |
| Fix named values, not magic numbers | Correct hardcoded values where tokens should be used | |
| **Tokenize everything** | Define new custom properties for every opacity/blur variant | ✓ |

**User's choice:** "just make everything tokenized" — full tokenization with explicit custom properties for each variant.

**Notes:** Follow-up clarified that opacity variants should be new custom properties (e.g., `--gold-border`, `--gold-dim`) rather than inline oklch functions. Token values must match DESIGN.md spec exactly at definition time.

---

## Achafont scope

| Option | Description | Selected |
|--------|-------------|----------|
| Overlay only | Overlay React app only; Rust-served HTML pages not touched | ✓ |
| Overlay + engine HTML pages | Also update room page HTML in main.rs | |
| Overlay only, but note the gap | Fix overlay, log engine HTML as known deviation | |

**User's choice:** Overlay only.

**Notes:** Engine-served HTML (room pages in Rust main.rs) are Phase 4's responsibility. Clean scope boundary.

---

## Motion spec coverage

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — all DESIGN.md gaps including motion | Full audit including animation timing | ✓ |
| Static/visual structure only | Colors, borders, fonts, layout only | |
| Motion audit only if animations already exist | Don't implement missing animations | |

**User's choice:** Full coverage — all DESIGN.md gaps including motion.

**Notes:** Both wrong values AND missing animations are in scope.

---

## Claude's Discretion

- Token naming convention for new CSS custom properties
- Order of token definitions in `:root`
- Whether to split new tokens into a dedicated block or co-locate near first use

## Deferred Ideas

- Achafont on engine-served HTML (room page `SPECTRE` title) — DESIGN.md mentions "lobby game title" should use Achafont; out of scope for Phase 6, deferred to future Phase 4 polish.
