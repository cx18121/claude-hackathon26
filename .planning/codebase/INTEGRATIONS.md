# External Integrations

**Analysis Date:** 2026-05-02

## APIs & External Services

**AI / LLM:**
- Anthropic Claude (claude-haiku-4-5-20251001 default) - Real-time fight commentary; streams token deltas via `anthropic.AsyncAnthropic.messages.stream`
  - SDK/Client: `anthropic` Python package (>=0.40.0)
  - Auth: `ANTHROPIC_API_KEY` env var
  - Configurable model: `CLAUDE_MODEL` env var (default `claude-haiku-4-5-20251001`)
  - Location: `server/commentator.py`
  - Degradation: missing key disables commentary engine entirely

**Text-to-Speech:**
- ElevenLabs TTS - Synthesizes commentary sentences to mp3 audio; streamed to overlay as base64
  - SDK/Client: raw `httpx.AsyncClient` POST to `https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream`
  - Auth: `ELEVENLABS_API_KEY` env var (`xi-api-key` header)
  - Voice: `ELEVENLABS_VOICE_ID` env var (default `pNInz6obpgDQGcFmaJgB`)
  - Model: `ELEVENLABS_MODEL_ID` env var (default `eleven_flash_v2_5`)
  - Location: `server/commentator.py` (`_synthesize` method)
  - Degradation: missing key keeps text commentary but skips audio

**Pose Estimation (CDN assets):**
- MediaPipe Tasks Vision (Google) - Browser-side 33-landmark pose detection
  - WASM runtime: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm`
  - Model file: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`
  - Location: `mobile/src/hooks/usePose.ts`
  - No API key required; loaded at client startup

## Data Storage

**Databases:**
- None - All game state is in-memory only (Python dicts/dataclasses in `server/rooms.py`). No persistence layer.

**File Storage:**
- Local filesystem only - Built static assets served from `overlay/dist/` and `mobile/dist/` at runtime

**Caching:**
- None - No Redis, Memcached, or equivalent

## Authentication & Identity

**Auth Provider:**
- None - No user accounts, login, or sessions
- Room access is by knowledge of 6-character room code (random alphanumeric, generated in `server/rooms.py`)
- Player slots are claimed first-come-first-served or by explicit `?slot=1|2` query param on WebSocket connect

## Networking / Tunneling

**Cloudflare Tunnel:**
- `cloudflared` CLI subprocess - Exposes local server publicly so phones on any network can reach it
  - Invoked as: `cloudflared tunnel --url http://localhost:{PORT}`
  - Extracts `*.trycloudflare.com` URL from stdout
  - Location: `server/tunnel.py` (`TunnelManager`)
  - Controlled by: `TUNNEL` env var (`true` by default; `false` uses LAN IP instead)
  - Requirement: `cloudflared` binary must be installed on the host (not bundled)

## Monitoring & Observability

**Error Tracking:**
- None - No Sentry, Datadog, or equivalent

**Logs:**
- Python stdlib `logging` with `basicConfig(level=INFO)` format `"%(asctime)s %(message)s"` (`server/main.py`)
- Key events logged: player connect/disconnect, calibration, game loop start/stop, commentary call stats (tokens in/out/cached), TTS failures

## CI/CD & Deployment

**Hosting:**
- Railway - Dockerfile-based deployment (`railway.toml`)
  - Builder: `dockerfile`
  - Restart policy: `on_failure`, max 3 retries

**CI Pipeline:**
- None detected (no `.github/`, no CircleCI, no GitLab CI config)

**Docker Build:**
- `Dockerfile` at repo root - Multi-stage build
  - Stage 1 (`overlay-builder`): `node:20-slim`, builds overlay SPA
  - Stage 2 (`mobile-builder`): `node:20-slim`, builds mobile SPA
  - Stage 3 (final): `python:3.11-slim`, copies both `dist/` outputs and server code, runs `pip install`
  - Final image serves everything: FastAPI serves `/overlay` and `/mobile` as static + WebSocket on `/ws/`

## Environment Configuration

**Required env vars (for full functionality):**
- `ANTHROPIC_API_KEY` - Enables live AI commentary (Claude)
- `ELEVENLABS_API_KEY` - Enables TTS audio; commentary degrades to text-only without it

**Optional env vars:**
- `PORT` (default `8000`) - Server listen port
- `TUNNEL` (default `"true"`) - `"false"` to use LAN IP instead of Cloudflare tunnel
- `PUBLIC_URL` - Override auto-detected public base URL (useful behind a reverse proxy)
- `MOBILE_URL` - Override mobile SPA base URL
- `OVERLAY_URL` - Override overlay SPA base URL
- `CLAUDE_MODEL` (default `claude-haiku-4-5-20251001`) - Anthropic model ID
- `ELEVENLABS_VOICE_ID` (default `pNInz6obpgDQGcFmaJgB`) - ElevenLabs voice ID
- `ELEVENLABS_MODEL_ID` (default `eleven_flash_v2_5`) - ElevenLabs TTS model

**Secrets location:**
- `server/.env` file (loaded by `python-dotenv` at startup in `server/main.py`)
- Not committed to git (`.env` is in standard gitignore)

## Webhooks & Callbacks

**Incoming:**
- None - No incoming webhooks from external services

**Outgoing:**
- ElevenLabs TTS HTTP POST (`https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream`) - Called per commentary sentence; response is streaming MP3 (`server/commentator.py`)

## WebSocket Endpoints (internal, not external)

These are server-defined real-time channels (not third-party integrations):

- `ws://{server}/ws/player/{room_code}?slot=1|2` - Mobile client → server (pose frames, calibration, ping/pong)
- `ws://{server}/ws/spectator/{room_code}` - Overlay → server (receive-only: game state, commentary, pose updates)

Protocol types defined in `server/protocol.py` (Python) and auto-generated to `shared/protocol.ts` (TypeScript) via `scripts/gen_protocol.py`.

---

*Integration audit: 2026-05-02*
