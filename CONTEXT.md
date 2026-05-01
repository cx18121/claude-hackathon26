# Spectre — Domain Glossary

## Game

**Spectre** — the game's name. A real-time 1v1 fighting game played with your body: players throw real punches and kicks at their phone cameras, and their silhouettes fight on a shared screen.

Do not call it a "boxing game" (too narrow — kicks are included) or "Shadow Fight" (a different commercial product).

**Room** — a persistent session identified by a `room_code`. A Room outlives a single Match: players can rematch within the same Room without reconnecting. Not synonymous with "match" or "game".

**Match** — one full contest within a Room, consisting of one or more Rounds. A Match ends when one player wins enough Rounds (determined by the format: BO1, BO3, or BO5).

**Round** — one timed bout within a Match. A Round ends when either a player's HP reaches 0 or the timer expires — whichever comes first. If the timer expires, the player with more HP remaining wins the Round (or it is a draw if HP is equal).

**Calibration** — a one-time setup phase at the start of a Room session in which each player throws 3 full-speed practice punches so the server can measure their natural punch velocity. The result (`reference_velocity`) normalizes hit detection so players of different size and fitness are judged relative to their own baseline, not an absolute threshold. Calibration persists for the entire Room session — it is NOT reset between Matches (rematches).

> ⚠️ Bug: `main.py:383` resets `reference_velocity = None` on rematch and re-sends `MsgCalibrationStart`. This contradicts the intended behaviour.

**HP (Hitpoints)** — each Fighter starts a Round with 800 HP. Every landed Attack deducts a damage amount. HP is never shown as a number in the UI — only the bar width (ratio of current to max) is displayed. When a Fighter's HP reaches 0, they are **KO'd** (Knocked Out), which immediately ends the Round.

**KO (Knockout)** — the event when a Fighter's HP reaches 0. Ends the Round. Use "KO" in UI copy and code — not "defeat", "death", or "elimination".

**Host** — the person who creates and configures the Room, runs the server, and shares Room links with the Fighters. Sets the Format before the Match begins. Not a Fighter — the Host is a coordinator role, not a participant in the fight.

**Format** — the series structure selected by the Host before a Match: BO1 (best-of-1), BO3 (best-of-3), or BO5 (best-of-5). Determines how many Rounds must be won to win the Match. Do not call it "mode", "series", or "rules".

**Connection Warning** — a visible indicator shown in the Arena and/or Controller when the server detects high network latency (`high_latency: true` in `MsgGameState`). Do not call it "lag warning" or "high latency state".

**Solo** — the mode in which one Fighter plays against a server-controlled bot opponent. The bot is an implementation detail with no named identity in the domain. Do not call it "Practice", "Training", or "Single Player".

**Lobby** — the pre-match stage that includes both connection and Calibration. The Lobby ends when both Fighters have completed Calibration and pressed Ready. Fighting begins immediately after. The Lobby is a single unified stage — Calibration is not separate from it.

**Fighting** — the active state during a Round when hit detection is live and HP is draining. A Fighter is either in the Lobby, Fighting, or in a post-round pause. Do not use "in-match", "live", or "in-game".

**Controller** — the mobile browser app a Fighter uses during a match. It runs MediaPipe pose estimation and streams keypoints to the server. Do not call it "mobile client", "phone", or "player" — use Controller. (The code directory is named `mobile/` for historical reasons.)

**Arena** — the spectator-facing browser view that renders the match: Fighter silhouettes, HP bars, round overlays, and the Commentator. What the room watches. Do not call it "overlay" in product or UI copy — use Arena. (The code directory is named `overlay/` for historical reasons.)

**Commentator** — the AI-driven voice that narrates the match on the Arena. Powered by Claude (text) and ElevenLabs (audio). It is a spectator-only component — Fighters do not interact with it and it has no effect on game state. Do not call it "Commentary" or "AI Commentator" — just "Commentator".

**Fighter** — the canonical term for both the player entity in game logic and the silhouette rendered on the overlay. Use "Fighter" in code, UI copy, and conversation — not "player" (ambiguous with the mobile client user), "character", or "silhouette".

**Attack** — a physical action that, when it lands on the opponent, deals damage. Attacks are tracked as two distinct subtypes:
- **Punch** — detected via wrist velocity crossing a threshold
- **Kick** — detected separately via ankle/foot velocity

Do not use "hit", "strike", or "move" as the generic term — use Attack. A landed Attack produces a **Hit** (an event carrying region and damage); an Attack that does not connect is not a Hit.
