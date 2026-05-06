# Spectre — Design System

## Color

**Strategy: Committed.** Deep crimson carries the accent work on ink-black backgrounds. Not restrained (too timid for a fight), not drenched (chaos defeats the clean aesthetic).

### Palette

All values in OKLCH. Never use pure black or white — every neutral carries a warm tint toward hue 22.

| Token | OKLCH | Hex approx | Role |
|---|---|---|---|
| `--bg-deep` | `oklch(7% 0.008 22)` | `#0c0809` | Canvas, full-screen backgrounds |
| `--bg-mid` | `oklch(11% 0.009 22)` | `#141010` | HUD panels, overlays |
| `--bg-surface` | `oklch(17% 0.01 22)` | `#201a1a` | Cards, inputs, pills |
| `--accent` | `oklch(44% 0.22 22)` | `#8b1a1a` | Player 1 crimson — HP bar, P1 borders, active states |
| `--accent-bright` | `oklch(60% 0.25 22)` | `#d42a2a` | Hit flash, focus ring, active glow |
| `--accent-p2` | `oklch(50% 0.18 250)` | `#1a3a7a` | Player 2 steel — HP bar, P2 borders |
| `--accent-p2-bright` | `oklch(62% 0.2 250)` | `#2855b8` | P2 hit flash |
| `--gold` | `oklch(78% 0.11 85)` | `#c8a84b` | HUD frame borders, timer box |
| `--text-primary` | `oklch(95% 0.008 85)` | `#f5efe4` | Body, HUD labels |
| `--text-secondary` | `oklch(65% 0.008 85)` | `#9c9180` | Supporting text, sublabels |
| `--text-dim` | `oklch(38% 0.006 85)` | `#524a42` | Placeholder, disabled |

### Rules

- Crimson (`--accent`) belongs to P1 and functional moments (commentary tag, critical alerts). Never decorative.
- P2 gets `--accent-p2` everywhere P1 gets `--accent` — a symmetric two-player system.
- Gold (`--gold`) is reserved for HUD structural borders only. Not for text, not for buttons.
- Low HP state: pulse animation on bar fill only — no color change.

---

## Typography

### Typefaces

- **Achafont** — display only. Round announcements, countdown numbers, KO text, match end headline, and the lobby game title. Loaded from `/public/fonts/Achafont.ttf` via `@font-face`. Never used for functional UI elements.
- **Inter** — everything else. HUD labels, HP numbers, timer, button text, body, commentary, lobby copy.

### Scale

| Token | Size | Weight | Letter-spacing | Use |
|---|---|---|---|---|
| `--type-display` | `clamp(72px, 15vw, 200px)` | 950 | 0 | KO, countdown, round flash |
| `--type-hero` | `clamp(32px, 6vw, 88px)` | 900 | 0 | Match end title, game name |
| `--type-hud-timer` | `36px` | 900 | 0.02em | Timer digits |
| `--type-label` | `12px` | 800 | `0.1em` | HUD labels — always uppercase |
| `--type-number` | `18px` | 900 | 0 | HP numbers (when shown) |
| `--type-body` | `16px` | 400 | 0 | Commentary text, connection screen |
| `--type-small` | `12px` | 700 | `0.06em` | Status pills, room code, tags |

### Rules

- All labels uppercase. letter-spacing 0.08em minimum.
- Achafont for drama only — if you're writing functional information, use Inter.
- Timer: Inter 900, not Achafont. Legibility at a glance beats style.
- No font-size below 12px anywhere.

---

## Elevation

```
Level 0  — flat on canvas (no shadow, no border)
Level 1  — structural: 1px border at --gold 20% opacity, inset 0 1px 0 rgba(255,255,255,0.04)
Level 2  — floating panel: 0 4px 24px rgba(0,0,0,0.7)
Level 3  — dramatic moment: 0 0 48px rgba(accen-rgb, 0.35), 0 8px 40px rgba(0,0,0,0.9)
```

---

## Motion

- **Hit flash**: 50ms hard-cut appear, 220ms exponential-out decay. No ease-in.
- **Round flash (countdown / FIGHT!)**: scale 0.9→1 over 160ms ease-out-quart. Holds 1.5s. Fades 350ms ease-out.
- **KO slam**: scale 2.2→0.95→1 over 480ms `cubic-bezier(0.34,1.15,0.64,1)`. One controlled overshoot.
- **Screen shake on heavy hit**: translate only, 380ms, 5 keyframes, exponential decay.
- **UI overlays**: 150ms ease-out-quart appear, 120ms ease-in disappear.
- **HP bar drain**: 100ms linear transition on width. No ease — width changes should feel immediate.
- Never animate `height`, `top`, `left`, `right`, `width` on layout elements. Only `transform` and `opacity`.

---

## Components

### HP Bar

- Full-width track with 1px `--gold` border, `--bg-mid` background, no border-radius.
- Fill: P1 = `--accent`, P2 = `--accent-p2`. Color is fixed — no green/red health shift.
- Low HP (<20% remaining): slow pulse on fill opacity (1→0.65→1, 700ms infinite).
- No HP number displayed inside the bar. The width communicates the value.
- P1 bar fills left-to-right. P2 bar fills right-to-left (mirrors on screen).

### Win Dots

- Appear below each player label. Up to 3 dots (best-of-3, first to 2).
- Filled dot: P1 = `--accent`, P2 = `--accent-p2`. Empty dot: `--bg-surface` with 1px `--text-dim` border.
- Size: 8px circle. Gap: 6px. No animation — snap to filled state.

### Commentary Bar

- Position: fixed, 7% from bottom, centered, max-width 880px.
- Background: `--bg-mid` 94% opacity, `backdrop-filter: blur(6px)`.
- Border: 1px `--accent` at 35% opacity. No border-radius above 6px.
- Tag ("SHADOW"): Inter 700, 11px, `--accent`, uppercase, letter-spacing 0.14em, 1px `--accent` 50% border, 3px padding.
- Text: Inter 600, clamp(18px, 2.2vw, 28px), `--text-primary`. Max 2 lines, then truncate.
- Cursor: `--accent` blinking block, 0.7s step(2) infinite.

### Buttons (overlay / mobile)

- Border: 1px `--text-dim`. Background: `--bg-surface`. Text: `--text-primary`.
- Hover: border → `--accent` 60%, background → `--accent` 8%.
- Active: scale(0.97) 80ms ease-out.
- No border-radius above 4px. No drop shadows.
- Primary action variant: border `--accent`, background `--accent` 15%.

### Status Pill

- Small, centered below the HUD. Room code in `--text-secondary`. Connected state: `--text-primary`.
- No background — text only with a `--text-dim` dot indicator to the left.

---

## Spacing

Base unit: 8px. Scale: 4, 8, 12, 16, 24, 32, 48, 64, 96.

Vary spacing intentionally. Same padding on every element is monotony. Tight internal padding (12–16px) on HUD elements. Generous breathing room (32–48px) around dramatic moments.

---

## Lobby

### Landing Page

Layout: max-width 480px, centered, 48px top margin, 16px horizontal body padding.

Section order (top to bottom, per D-07):
1. SPECTRE header block
2. Game picker section (primary focal point)
3. Create Room button
4. Separator
5. Join by code section

**SPECTRE header block:**
- `<h1>` text: `SPECTRE` — Inter 900 28px letter-spacing 0.12em uppercase `--text-primary`
- Tagline: `real punches. real fights.` — Inter 400 12px letter-spacing 0.08em uppercase `--text-secondary`
- Margin-bottom: 32px

**Game picker section:**
- Section label: `Select a Game` — Inter 900 12px letter-spacing 0.08em uppercase `--text-secondary`, margin-bottom 12px
- Two tiles in flex row, gap 8px, each tile flex 1, min-height 80px
- Tile default: background `--bg-surface`, border 1px `--text-dim`, border-radius 4px
- Tile label: Inter 900 16px uppercase letter-spacing 0.1em `--text-primary` centered
- Tile selected (BOXING): border 1px `--accent`, background `color-mix(in oklch, var(--accent) 10%, transparent)`
- Tile selected (DANCE): border 1px `--accent-p2`, background `color-mix(in oklch, var(--accent-p2) 10%, transparent)`
- Tile hover (unselected): border `--text-secondary`, background `--bg-mid`
- Tile active: `transform: scale(0.97)` 80ms ease-out
- Margin-bottom: 16px

**Create Room button:**
- Full-width, min-height 52px, border-radius 4px
- Disabled (no selection): background `--bg-surface`, border 1px `--text-dim`, opacity 0.5, cursor not-allowed
- Enabled: background `color-mix(in oklch, var(--accent) 15%, transparent)`, border 1px `--accent`, `--text-primary`, cursor pointer
- Hover: background `color-mix(in oklch, var(--accent) 25%, transparent)`, border `--accent-bright`
- Active: `transform: scale(0.97)` 80ms ease-out
- Label: `Create Room` — Inter 900 16px uppercase letter-spacing 0.08em
- Loading state: label `Creating...`, button disabled
- Margin-bottom: 32px

**Separator:**
- Centered `or` label — Inter 400 12px `--text-dim`. 1px horizontal rule at `--text-dim` 40% opacity either side.

**Join by code section:**
- Section label: `Join a Room` — Inter 900 12px uppercase letter-spacing 0.08em `--text-secondary`, margin-bottom 12px
- Row: text input + Join Room button, gap 8px
- Input: flex 1, min-height 52px, background `--bg-surface`, border 1px `--text-dim`, padding 16px, `--text-primary` Inter 900 16px letter-spacing 0.2em, uppercase transform, placeholder `Room Code` `--text-dim` weight 400
- Input focus: border `--accent`, outline none
- Join Room button: min-width 100px min-height 52px, default button style (bg-surface, text-dim border), text `Join Room` Inter 900 16px uppercase
- Join Room hover: border `color-mix(in oklch, var(--accent) 60%, transparent)`, background `color-mix(in oklch, var(--accent) 8%, transparent)`
- Join Room active: `transform: scale(0.97)` 80ms ease-out

### Room Page (`/rooms/{code}`)

Layout: max-width 720px, centered, 48px top margin, 24px horizontal padding.

**Header block:**
- Back link: `← Lobby` — Inter 400 16px `--text-secondary`, margin-bottom 24px, links to `/`
- Room code display (primary focal point): Inter 900 32px letter-spacing 0.2em uppercase `--text-primary`
- Game type badge: inline pill — Inter 900 12px letter-spacing 0.1em `--text-secondary`, border 1px `--text-dim`, padding 4px 8px, border-radius 4px
- Subtitle: `Share these links with your players` — Inter 400 16px `--text-secondary`
- Margin-bottom: 32px

### QR Card Grid

- CSS grid: 3 equal columns, gap 24px at viewport ≥600px; 1 column gap 16px at <600px
- Each card: background `--bg-surface`, border 1px (per-card color below), border-radius 4px, padding 24px, flex column, align-items center, gap 12px
- Elevation Level 1: `box-shadow: inset 0 1px 0 rgba(255,255,255,0.04)`
- P1 card border: 1px `--accent`
- P2 card border: 1px `--accent-p2`
- Overlay card border: 1px `color-mix(in oklch, var(--gold) 60%, transparent)`

### QR Card Contents

Each card (top to bottom):
- Role label: Inter 900 12px uppercase letter-spacing 0.1em `--text-secondary` — `PLAYER 1` / `PLAYER 2` / `OVERLAY`
- QR code: inline SVG 160px × 160px. Dark module color `#0c0809` (`--bg-deep`). Light module color `#f5efe4` (`--text-primary`). Inverted for dark theme.
- URL link: `<a href="..." target="_blank">` — Inter 900 12px `--text-secondary` letter-spacing 0.04em, word-break break-all, max 2 lines then ellipsis, text-decoration underline on hover
- Copy button: full-width, min-height 36px, background `--bg-mid`, border 1px `--text-dim`, border-radius 4px
  - Label: `Copy Link` — Inter 900 12px uppercase letter-spacing 0.08em `--text-secondary`
  - Hover: border `color-mix(in oklch, var(--accent) 60%, transparent)`, background `color-mix(in oklch, var(--accent) 8%, transparent)`
  - Success state (2000ms): border `color-mix(in oklch, var(--gold) 60%, transparent)`, label changes to `Copied!` `--text-primary`

### Error States

- **Create Room server error**: Error row below button — background `color-mix(in oklch, var(--accent-bright) 15%, transparent)`, border 1px `color-mix(in oklch, var(--accent-bright) 40%, transparent)`, padding 8px 12px, border-radius 4px. Text `--text-primary` Inter 400 16px.
- **Room not found (404)**: Centered page message. `--text-secondary` Inter 400 16px. Includes `Back to Lobby` link to `/`.

### Responsive Behavior

- Landing page: max-width 480px centered. Game picker tiles maintain 50/50 split down to 320px.
- Room page: 3-column grid collapses to 1 column at <600px viewport. Card order: P1 → P2 → Overlay.
- QR SVGs: fixed 160px × 160px at all breakpoints (no scaling).
- All touch targets: min 44px × 44px (satisfied by 52px buttons and 80px tiles).
