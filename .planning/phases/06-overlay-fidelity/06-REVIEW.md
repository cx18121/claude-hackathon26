---
phase: 06-overlay-fidelity
reviewed: 2026-05-09T00:00:00Z
depth: standard
files_reviewed: 1
files_reviewed_list:
  - overlay/src/index.css
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: fixed
fixed_at: 2026-05-10
---

# Phase 06: Code Review Report

**Reviewed:** 2026-05-09
**Depth:** standard
**Files Reviewed:** 1
**Status:** issues_found

## Summary

`overlay/src/index.css` is a single-file stylesheet for the game overlay UI, covering the HUD, parallax background, animations, match-end screen, settings panel, and commentary subtitle. The colour system is built entirely on `oklch` with relative colour syntax (`oklch(from var(...))`). Three blockers were found: a grid placement bug that makes the stats divider invisible, a z-index collision between the waiting overlay and the HUD layer, and a systemic browser-support gap in the relative colour syntax with no fallback values. Four warnings cover missing Firefox slider thumb styling, a mixed logical/physical property inconsistency on the HP fill, the suppressed range-input focus outline with no replacement, and the absence of `prefers-reduced-motion` guards on several infinite animations.

---

## Critical Issues

### CR-01: `.match-stats-sep` missing `grid-column: 2` — separator is invisible

**File:** `overlay/src/index.css:389`

**Issue:** The `.match-stats` grid declares `grid-template-columns: 1fr 1px 1fr`. The two `.match-stats-col` children auto-place into columns 1 and 3. `.match-stats-sep` is given `grid-row: 1` but no `grid-column`, so the CSS auto-placement algorithm assigns it to the next available cell — column 1, row 1 — which is already occupied by `.match-stats-col-p1`. The separator element is stacked behind the left content column and never occupies the `1px` centre column it was designed for. The visual divider between the two stat columns is absent at runtime.

**Fix:**
```css
.match-stats-sep {
  background: var(--gold-sep);
  grid-row: 1;
  grid-column: 2;   /* explicitly place in the 1px centre track */
}
```

---

### CR-02: `.waiting-overlay` shares `z-index: 2` with `.hud-layer` — rendering order is ambiguous

**File:** `overlay/src/index.css:138` and `overlay/src/index.css:498`

**Issue:** `.hud-layer` is assigned `z-index: 2` (line 138). `.waiting-overlay` is also assigned `z-index: 2` (line 498). When both elements are present in the DOM simultaneously (e.g., a race between the waiting screen disappearing and the HUD appearing), the element that appears later in the DOM wins the stacking contest. Neither the CSS nor any comment documents the intended order. If the waiting overlay is rendered after the HUD layer in the DOM tree, it will cover the HUD entirely, hiding health bars and the timer even though the game has started. The intended stack is: parallax(0) → pixi(1) → HUD(2) → round-flash(3) → match-end(4) → audio-unlock(5), and the waiting overlay should sit between pixi and HUD, i.e., z-index 2 with HUD at 3+, or the waiting overlay should be given a distinct value.

**Fix:** Assign `.waiting-overlay` `z-index: 2` and promote the HUD and all layers above it by one:

```css
/* Revised layer stack */
.hud-layer           { z-index: 3; }   /* was 2 */
.match-end-overlay   { z-index: 5; }   /* was 4 */
.round-flash         { z-index: 4; }   /* was 3 */
.audio-unlock        { z-index: 6; }   /* was 5 */
.settings-anchor     { z-index: 41; }  /* stays above audio-unlock */
.commentary-subtitle { z-index: 31; }  /* stays above hud-layer */

/* waiting-overlay stays at 2 — hidden behind HUD once game starts */
.waiting-overlay { z-index: 2; }
```

Alternatively, keep `.waiting-overlay` at `z-index: 2` and `.hud-layer` at `z-index: 3`.

---

### CR-03: CSS relative colour syntax (`oklch(from var(...))`) has no fallback — full colour system fails silently in unsupported browsers

**File:** `overlay/src/index.css:22–27` (custom property definitions) and throughout (lines 214, 314, 323, 350, 437, 450, 474, 485, 512, 594, 602, 625, 640, 641, 662, 692, 772)

**Issue:** The entire semantic colour token system (`--gold-border`, `--gold-sep`, `--gold-footer-rule`, `--bg-commentary`, `--accent-commentary-border`, `--accent-commentary-tag-border`) uses CSS relative colour syntax — `oklch(from var(--x) l c h / alpha)`. This is supported only in Chrome 119+, Safari 16.4+, Firefox 128+, and Edge 119+. There are no `@supports` guards and no fallback values. In unsupported environments, every derived token resolves to the initial value (`transparent` for `color`, `black` for border colours, etc.), which means borders and background tints for the HP bar, commentary bar, settings panel, and rematch button all disappear. Because this syntax is also used inline (e.g., line 437 `.rematch-btn { background: oklch(from var(--accent) l c h / 0.14) }`), any browser that rejects it will fall through to no background.

**Fix:** Add explicit fallback values before each relative-colour usage, or wrap with `@supports`:

```css
/* Option A — per-declaration fallback (works anywhere) */
.rematch-btn {
  background: oklch(44% 0.22 22 / 0.14);                  /* fallback: hard-coded */
  background: oklch(from var(--accent) l c h / 0.14);     /* progressive enhancement */
}

/* Option B — block fallback for the custom properties */
:root {
  --gold-border: oklch(78% 0.11 85 / 0.20);               /* static fallback */
}

@supports (color: oklch(from red l c h)) {
  :root {
    --gold-border: oklch(from var(--gold) l c h / 0.20);  /* dynamic override */
  }
}
```

---

## Warnings

### WR-01: Firefox slider thumb is unstyled — settings volume/FX sliders render inconsistently

**File:** `overlay/src/index.css:698–713`

**Issue:** The `.settings-slider` range input has custom thumb styling only for WebKit (`::webkit-slider-thumb`). Firefox uses `::moz-range-thumb`. Without it the slider thumb falls back to the OS native control, which is visually jarring against the dark custom UI. No `::moz-range-track` is defined either, so the track height and colour differ in Firefox.

**Fix:**
```css
.settings-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text-secondary);
  cursor: pointer;
  border: none;
  transition: background 0.1s;
}

.settings-slider::-moz-range-thumb:hover {
  background: var(--text-primary);
}

.settings-slider::-moz-range-track {
  height: 3px;
  background: oklch(from var(--text-dim) l c h / 0.3);
  border-radius: 2px;
}
```

---

### WR-02: `.hp-fill-p2` mixes logical and physical properties — RTL layout breaks the fill anchor

**File:** `overlay/src/index.css:264` and `overlay/src/index.css:269`

**Issue:** `.hp-fill` uses the logical property `inset-block: 0` (lines 264) for vertical positioning, which is RTL-safe. However, `.hp-fill-p2` uses the physical property `right: 0` (line 269) to anchor the fill bar to the right edge. In a right-to-left writing mode, `right: 0` still means the physical right edge rather than the inline-end, making the P2 fill bar visually indistinguishable from P1. More importantly, the mixture of logical (`inset-block`) and physical (`right`) properties on the same element signals an inconsistency that will confuse future maintainers.

**Fix:**
```css
.hp-fill-p1 { inset-inline-start: 0; background: var(--accent); }
.hp-fill-p2 { inset-inline-end: 0;   background: var(--accent-p2); }
```

---

### WR-03: `.settings-slider` suppresses `outline` with no visible focus replacement — keyboard accessibility broken

**File:** `overlay/src/index.css:694`

**Issue:** `outline: none` removes the browser's default focus ring on the range input. There is no replacement focus style (no `box-shadow` on `:focus-visible`, no custom border colour change). A keyboard user tabbing to the volume or effects slider receives no visual indication that the control is focused. This violates WCAG 2.1 SC 2.4.7 (Focus Visible).

**Fix:**
```css
.settings-slider {
  /* existing declarations … */
  outline: none;
}

.settings-slider:focus-visible {
  box-shadow: 0 0 0 2px var(--accent-bright);
  border-radius: 2px;
}
```

---

### WR-04: No `prefers-reduced-motion` guard on infinite animations — vestibular accessibility failure

**File:** `overlay/src/index.css:272`, `553`, `575`, `800` (and `screen-shake` at line 845)

**Issue:** Five animations run indefinitely with no accommodation for the OS `prefers-reduced-motion: reduce` setting: `hp-pulse` (health bar pulsing), `waiting-pulse` (pulse ring), `status-blink` (waiting status text), `commentary-blink` (cursor blink), and `screen-shake` (impact shake). Users with vestibular disorders who have enabled reduce-motion in their OS settings will still receive all of these animations, which can cause nausea or disorientation.

**Fix:** Add a single media query block at the end of the file:
```css
@media (prefers-reduced-motion: reduce) {
  .hp-fill.pulse              { animation: none; }
  .waiting-pulse-ring         { animation: none; }
  .waiting-slot-status        { animation: none; opacity: 0.7; }
  .commentary-cursor          { animation: none; opacity: 1; }
  .overlay-shell.shaking      { animation: none; }
  /* Slow down entrance animations rather than remove them */
  .round-flash,
  .ko-text,
  .match-end-title,
  .match-stats,
  .rematch-btn                { animation-duration: 0.01ms !important; }
}
```

---

## Info

### IN-01: `.hud-banner` uses hard-coded `oklch` values instead of the design-token system

**File:** `overlay/src/index.css:290–296`

**Issue:** The latency/disconnect banner uses literal `oklch` values — `oklch(78% 0.14 85 / 0.45)`, `oklch(14% 0.05 85 / 0.92)`, `oklch(85% 0.1 85)` — rather than referencing the existing design tokens (`--gold`, `--bg-mid`, `--text-primary`). This means the banner colour will not respond to any future token change, and the values duplicate magic numbers already defined in `:root`.

**Fix:**
```css
.hud-banner {
  border: 1px solid oklch(from var(--gold) l c h / 0.45);
  background: oklch(from var(--bg-mid) l c h / 0.92);
  color: var(--text-primary);
}
```

---

_Reviewed: 2026-05-09_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
