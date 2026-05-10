# Phase 6: Overlay Fidelity - Context

**Gathered:** 2026-05-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 6 makes the running overlay match DESIGN.md exactly. Two workstreams:

1. **Achafont restoration** — recover `Achafont.ttf` from git history (commit `4de2977`), add `@font-face` to overlay CSS. The CSS already references `font-family: 'Achafont'` in ~5 places; the file and declaration are simply missing.

2. **Design spec audit** — systematically compare every DESIGN.md spec against the live `overlay/src/index.css` and overlay components. Correct all deviations: colors, borders, layout, typography, and animation timing. Goal: no visible gap between the running overlay and the spec.

**Scope**: `overlay/src/` only. Engine-served HTML (Rust room pages) is not touched in this phase.

</domain>

<decisions>
## Implementation Decisions

### Spec precision — tokenization policy
- **D-01:** The policy is **full tokenization**: every opacity variant, blur value, and derived color in the overlay CSS must be a named CSS custom property in `:root`, not an inline `oklch(from var(--gold) l c h / X)` expression. Define explicit tokens like `--gold-border`, `--gold-dim`, `--accent-commentary-border`, `--bg-commentary` etc.
- **D-02:** Token values must match DESIGN.md spec exactly (e.g., Level 1 elevation border = `--gold` at **20%** opacity, not 18%; commentary backdrop = `blur(6px)`, not 8px). The token definition is the canonical value — fix the value at definition time.
- **D-03:** After tokenization, all inline magic numbers are replaced by `var(--token-name)` references. No raw oklch/opacity expressions left in rule bodies.

### Achafont scope
- **D-04:** Overlay only. `overlay/public/fonts/Achafont.ttf` (and `Achafout.ttf` if present) recovered from git history. `@font-face` declaration added to `overlay/src/index.css`.
- **D-05:** Engine-served HTML pages (Rust `main.rs` room page) are not touched. The DESIGN.md note about "lobby game title" using Achafont is deferred.

### Motion spec coverage
- **D-06:** Full coverage — all DESIGN.md gaps including animation timing. Audit existing `@keyframes` and `transition` / `animation` declarations against the DESIGN.md Motion section. Correct wrong values AND implement missing animations that DESIGN.md specifies.
- **D-07:** DESIGN.md Motion spec to audit: hit flash (50ms appear, 220ms exponential-out decay), round flash (scale 0.9→1, 160ms ease-out-quart, hold 1.5s, fade 350ms), KO slam (scale 2.2→0.95→1, 480ms `cubic-bezier(0.34,1.15,0.64,1)`), screen shake on heavy hit (translate only, 380ms, 5 keyframes, exponential decay), UI overlays (150ms ease-out-quart appear, 120ms ease-in disappear), HP bar drain (100ms linear, no ease).

### Claude's Discretion
- Token naming convention for new properties (e.g., `--gold-border` vs `--border-gold-structural`)
- Order of token definitions in `:root`
- Whether to split tokens into a dedicated `:root` block or co-locate near first use

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design system (primary spec)
- `DESIGN.md` — the authoritative spec for every visual and motion element in the overlay. Sections: Color (tokens + rules), Typography (Achafont vs Inter, type scale), Elevation (4 levels — Level 1 is the HUD structural target), Motion (all animation timings), Components (HP Bar, Win Dots, Commentary Bar, Buttons, Status Pill).

### Overlay source (primary target)
- `overlay/src/index.css` — the full overlay stylesheet. Phase 6 performs a systematic audit of this file against DESIGN.md and corrects every deviation.
- `overlay/src/components/HudLayer.tsx` — HP bars, timer, round number, win dots, connection indicator.
- `overlay/src/components/RoundOverlay.tsx` — countdown (3-2-1-FIGHT!), round end, match end. Uses Achafont for display text.
- `overlay/src/components/CommentarySubtitle.tsx` — commentary bar, tag, text, blinking cursor.

### Font recovery
- Git commit `4de2977` — contains `overlay/public/fonts/Achafont.ttf` and `overlay/public/fonts/Achafout.ttf`. Recover via `git show 4de2977:overlay/public/fonts/Achafont.ttf`.

### Requirements
- `.planning/REQUIREMENTS.md` — OVERLAY-01 through OVERLAY-04 are the Phase 6 requirement list.

</canonical_refs>

<code_context>
## Existing Code Insights

### Current State (from codebase scout)
- `overlay/src/index.css` already contains `font-family: 'Achafont', Inter, sans-serif` in 5+ CSS rules but **no `@font-face` declaration** and **no font file** — font silently falls through to Inter.
- HP track border: `1px solid oklch(from var(--gold) l c h / 0.18)` — should be 0.20 per Level 1 elevation spec.
- Commentary backdrop: `backdrop-filter: blur(8px)` — should be `blur(6px)` per DESIGN.md.
- Commentary blinking cursor: `.commentary-cursor` with `animation: commentary-blink 0.7s steps(2, jump-none) infinite` — spec says `steps(2)` at 0.7s, close but `jump-none` needs verification.
- Token system is already OKLCH-based and well-structured; the audit is adding opacity-variant tokens, not redesigning the palette.

### Established Patterns
- All color tokens use OKLCH — new opacity variant tokens should follow the same convention: `--gold-border: oklch(from var(--gold) l c h / 0.20)`.
- CSS custom properties defined in `:root` in `overlay/src/index.css` — add new tokens there.
- Component-level CSS classes in the same `index.css` file (no CSS modules used).

### Integration Points
- `@font-face` declaration in `overlay/src/index.css` `:root` block — font-family name must match exactly what's already referenced (`'Achafont'`).
- `overlay/public/fonts/` — create directory, add recovered TTF file(s).

</code_context>

<specifics>
## Specific Ideas

- Token names should be semantically meaningful, not purely descriptive: `--gold-border` (what it's used for) rather than `--gold-20pct` (what it encodes).
- The audit should proceed section-by-section through DESIGN.md — Color → Typography → Elevation → Motion → Components — to ensure nothing is skipped.

</specifics>

<deferred>
## Deferred Ideas

- Achafont on engine-served HTML (room page `SPECTRE` title) — DESIGN.md mentions "lobby game title" should use Achafont; deferred to a future Phase 4 polish pass.

</deferred>

---

*Phase: 6-Overlay Fidelity*
*Context gathered: 2026-05-10*
