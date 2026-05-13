# Phase 11 Research — Lobby + Room Updates

**Researched:** 2026-05-13
**Domain:** Inline HTML server (Rust/Axum) — lobby UI and room page
**Confidence:** HIGH (all findings from direct codebase inspection)

---

## Key Findings

### 1. Current Lobby Structure

The lobby is a Rust `const` string named `LOBBY_HTML` defined at `engine/engine-core/src/main.rs:668`. It is a static string literal — not a template rendered at request time. The handler at line 884 simply returns it unchanged:

```rust
async fn lobby_html() -> impl IntoResponse {
    axum::response::Html(LOBBY_HTML)
}
```

The game picker lives at lines 793–797 (inside LOBBY_HTML):

```html
<div class="game-picker">
  <button class="game-tile" id="tile-boxing" onclick="selectGame('boxing')">BOXING</button>
  <button class="game-tile" id="tile-dance" onclick="selectGame('dance')">DANCE</button>
</div>
```

The `selectGame` JS function (lines 822–829) hard-codes the two tile IDs:

```js
function selectGame(game) {
  if (selectedGame === game) return;
  selectedGame = game;
  document.getElementById('tile-boxing').className = 'game-tile' + (game === 'boxing' ? ' selected-boxing' : '');
  document.getElementById('tile-dance').className = 'game-tile' + (game === 'dance' ? ' selected-dance' : '');
  var btn = document.getElementById('btn-create');
  btn.classList.add('enabled');
}
```

There are two CSS selection states already defined (lines 721–728):

```css
.game-tile.selected-boxing {
  border-color: var(--accent);
  background: color-mix(in oklch, var(--accent) 10%, transparent);
}
.game-tile.selected-dance {
  border-color: var(--accent-p2);
  background: color-mix(in oklch, var(--accent-p2) 10%, transparent);
}
```

There is no `selected-fps_boxing` state yet.

The `.game-picker` uses `display: flex; gap: 8px;` with `flex: 1` on each tile (line 711–717), so adding a third tile will automatically split the row into thirds — no CSS grid change needed.

---

### 2. Room Creation Flow

`POST /rooms?game=<game_type>` is handled at lines 898–923.

1. The handler looks up `game` (defaults to `"boxing"` if absent) in `app.plugins` — a `HashMap<String, Arc<dyn GamePlugin>>`.
2. If found: generates a 6-char alphanumeric code, calls `rooms.create_room(code, plugin, game_type)`, returns `{"room_code": "<CODE>"}` with HTTP 201.
3. If not found: returns HTTP 400 with `{"error": "unknown game: <game>"}`.

The `fps_boxing` plugin is already registered in `main()` (lines 405–412) and in `test_state()` (lines 939–941). `POST /rooms?game=fps_boxing` already works and has a passing test (`post_rooms_fps_boxing_returns_201` at line 958).

Client-side `createRoom()` (lines 831–855) calls `fetch('/rooms?game=' + selectedGame, { method: 'POST' })` and on success redirects to `/rooms/<CODE>`.

---

### 3. Client Routing

After room creation the browser is sent to `/rooms/<CODE>` (GET), which calls `room_page_html(code, game_type, base_url)` (lines 187–329).

`room_page_html` builds three QR cards unconditionally — P1, P2, and Overlay — using:

```rust
let p1_url = format!("{}/mobile?server={}&room={}&slot=1&game={}", base_url, ws_url, code, game_type);
let p2_url = format!("{}/mobile?server={}&room={}&slot=2&game={}", base_url, ws_url, code, game_type);
let overlay_url = format!("{}/overlay?server={}&room={}", base_url, ws_url, code);
```

There is no routing branch on `game_type` today. For both `boxing` and `dance` rooms, the cards always point to `/mobile` and `/overlay`.

For `fps_boxing`, LBY-02 requires:
- The Overlay QR card is hidden.
- P1/P2 cards show laptop join links pointing to `/fps` (the app Phase 12 will create), not `/mobile`.

There is no `/fps` route or `fps/dist` directory yet — Phase 12 creates the Vite app.

---

### 4. What Phase 11 Must Change

**File:** `engine/engine-core/src/main.rs` (single file for all changes)

#### LBY-01 — Add "FPS BOXING" tile to the lobby

Three changes inside `LOBBY_HTML` (the `const` at line 668):

**A. Add `selected-fps_boxing` CSS class** (after line 728):
```css
.game-tile.selected-fps_boxing {
  border-color: var(--accent-p2);   /* or choose a distinct accent */
  background: color-mix(in oklch, var(--accent-p2) 10%, transparent);
}
```
Pick an accent color. The existing palette has `--accent` (red/warm) for boxing, `--accent-p2` (blue) for dance, and `--gold` for the overlay. A reasonable choice: a new CSS variable or reuse `--gold` for fps_boxing to visually distinguish it.

**B. Add a third button in the `.game-picker` div** (after line 796):
```html
<button class="game-tile" id="tile-fps_boxing" onclick="selectGame('fps_boxing')">FPS BOXING</button>
```

**C. Update `selectGame()` to reset the fps_boxing tile** (expand lines 825–826 to add the third tile):
```js
function selectGame(game) {
  if (selectedGame === game) return;
  selectedGame = game;
  document.getElementById('tile-boxing').className   = 'game-tile' + (game === 'boxing'     ? ' selected-boxing'     : '');
  document.getElementById('tile-dance').className    = 'game-tile' + (game === 'dance'      ? ' selected-dance'      : '');
  document.getElementById('tile-fps_boxing').className = 'game-tile' + (game === 'fps_boxing' ? ' selected-fps_boxing' : '');
  var btn = document.getElementById('btn-create');
  btn.classList.add('enabled');
}
```

**No changes** to routing, backend, or plugin registration — `fps_boxing` is already in the plugin map.

#### LBY-02 — Room page for fps_boxing hides Overlay card and shows laptop links

`room_page_html` (lines 187–329) must branch on `game_type`.

When `game_type == "fps_boxing"`:
- P1 URL points to `/fps?server=…&room=…&slot=1` (not `/mobile`)
- P2 URL points to `/fps?server=…&room=…&slot=2` (not `/mobile`)
- Overlay card is hidden (omit the `.qr-card.overlay` div from the returned HTML, or set `display:none`)
- No QR codes are needed (laptop users click a link / use the copy button; they do not scan a QR)

When `game_type != "fps_boxing"` (boxing, dance): behavior is unchanged.

The cleanest implementation: branch before building the URL strings:

```rust
fn room_page_html(code: &str, game_type: &str, base_url: &str) -> String {
    let ws_url = ws_url_from_http(base_url);
    let is_fps = game_type == "fps_boxing";

    let (p1_url, p2_url) = if is_fps {
        (
            format!("{}/fps?server={}&room={}&slot=1", base_url, ws_url, code),
            format!("{}/fps?server={}&room={}&slot=2", base_url, ws_url, code),
        )
    } else {
        (
            format!("{}/mobile?server={}&room={}&slot=1&game={}", base_url, ws_url, code, game_type),
            format!("{}/mobile?server={}&room={}&slot=2&game={}", base_url, ws_url, code, game_type),
        )
    };
    // ... rest unchanged; conditionally render overlay card based on is_fps
}
```

The Overlay card HTML block (lines 292–297) must be conditionally omitted when `is_fps` is true.

The existing tests for `room_page_url_html_escaping` (line 1091) and `room_page_code_and_game_type_html_escaping` (line 1147) test the `boxing` game type — they remain valid. A new test should be added for the `fps_boxing` branch.

---

### 5. fps/ App Status

The `fps/` directory does not exist at the project root. Phase 12 will create it (a new Vite app at `/fps`).

The Axum server currently has:

```rust
.nest_service("/mobile", ServeDir::new("mobile/dist"))
.nest_service("/overlay", ServeDir::new("overlay/dist"))
```

For LBY-02, `room_page_html` can emit `/fps` URLs now. When a user clicks the link before Phase 12 exists, they will get a 404 from the server. This is acceptable for Phase 11 — the tile and room page can be wired up correctly, and Phase 12 will add the `/fps` route + dist directory.

Decision needed: whether Phase 11 also adds the `nest_service("/fps", ...)` stub to `build_app` so the route exists (returning a 404 from ServeDir is more user-friendly than an Axum 404 with no HTML), or defers that entirely to Phase 12.

---

## Implementation Approach

This is a two-part change entirely inside `engine/engine-core/src/main.rs`:

**Part 1 — LBY-01 (lobby tile):** Three surgical edits inside the `LOBBY_HTML` const string:
1. Add `.selected-fps_boxing` CSS class.
2. Add `<button id="tile-fps_boxing" onclick="selectGame('fps_boxing')">FPS BOXING</button>` in the `.game-picker` div.
3. Add the fps_boxing branch to `selectGame()`.

No backend changes. No new routes. The plugin is already registered.

**Part 2 — LBY-02 (room page):** Refactor `room_page_html` to branch on `game_type`:
- When `fps_boxing`: P1/P2 links point to `/fps`, overlay card is omitted, no QR codes needed for those cards.
- When other: behavior unchanged.

Add one new Rust test asserting that the `fps_boxing` room page contains `/fps` links and does not contain the overlay card.

Update the existing lobby test `get_lobby_contains_boxing_and_dance_buttons` (line 1040) to also assert `selectGame('fps_boxing')` is present (or add a separate test for that assertion).

---

## Pitfalls

**P1 — `LOBBY_HTML` is a `const`, not a template.** The string is static and baked at compile time. Changes must be made inside the raw string literal. There is no Handlebars/Tera — all conditional logic in the room page goes in `room_page_html` (Rust code), not in a template file.

**P2 — `selectGame()` hardcodes tile IDs.** Adding a new tile without also updating `selectGame()` leaves the new tile able to set `selectedGame` but unable to deselect other tiles properly (the old tiles would not reset their CSS class when fps_boxing is clicked). All three tile ID resets must happen in `selectGame()`.

**P3 — QR generation for `/fps` URLs.** The current `room_page_html` always generates three QR codes. For fps_boxing, avoid calling `generate_qr_svg` for the overlay URL (wasted computation) and for P1/P2 if no QR codes are shown. If the cards omit QR codes, skip `generate_qr_svg` calls for those URLs.

**P4 — Test regression.** `get_lobby_contains_boxing_and_dance_buttons` (line 1040) asserts specific JS strings. After adding the fps_boxing tile, that test still passes (it only asserts boxing and dance are present). But the test name is now misleading. A separate `get_lobby_contains_fps_boxing_button` test should be added rather than modifying the existing assertion.

**P5 — `/fps` route doesn't exist yet.** Phase 11 wires the UI to `/fps` URLs. Users who click P1/P2 links before Phase 12 ships will get a 404. This is intentional and acceptable. Document it clearly in the commit message. Optionally: add the `nest_service("/fps", ServeDir::new("fps/dist"))` line in `build_app` in Phase 11 so the route is ready for Phase 12 to populate — this is a one-liner and avoids a Phase 12 backend edit.

---

## Decisions Needed

**D1 — Accent color for the FPS BOXING tile.**
The current palette has `--accent` (warm red) for boxing and `--accent-p2` (blue) for dance. Options for fps_boxing:
- `--gold` (already used for the overlay card) — distinctive, fits the "premium" feel of a new mode.
- A new CSS variable (e.g. `--accent-fps: oklch(50% 0.20 140)` — green) — cleanest separation.
- Reuse `--accent` (same red as boxing) — simplest, acceptable since fps_boxing is a variant of boxing.
Recommendation: reuse `--accent` (red) since fps_boxing is a boxing variant and the visual distinction between tiles is provided by position and label, not accent color.

**D2 — Should Phase 11 add the `/fps` Axum route stub?**
Adding `.nest_service("/fps", ServeDir::new("fps/dist"))` to `build_app` in Phase 11 is a one-liner that makes Phase 12 purely frontend work. The alternative is deferring it entirely to Phase 12. Recommendation: defer to Phase 12 to keep Phase 11 surgical (the route only matters once the Vite app exists).

**D3 — Should the fps_boxing room page show QR codes at all?**
LBY-02 says "shows P1/P2 laptop join links". Laptop users do not scan QR codes — they click links. The simplest implementation omits QR codes for fps_boxing and shows only the URL + copy button. Recommendation: omit QR codes for fps_boxing cards.

---

## Sources

All findings verified by direct code inspection of `engine/engine-core/src/main.rs` [VERIFIED: codebase] and `.planning/REQUIREMENTS.md` / `.planning/ROADMAP.md` [VERIFIED: codebase].

No external library research required — this phase makes no new library dependencies.
