# Technology Stack

**Analysis Date:** 2026-05-02

## Languages

**Primary:**
- Python 3.11 - Server game logic, WebSocket handling, hit detection (`server/`)
- TypeScript ~6.0.2 - Mobile client and overlay client (`mobile/src/`, `overlay/src/`, `shared/`)

**Secondary:**
- CSS - Component styling (`mobile/src/index.css`, `overlay/src/index.css`)

## Runtime

**Environment:**
- Python 3.11 (Docker base image: `python:3.11-slim`)
- Node.js 20 (Docker base image: `node:20-slim` for build stages)

**Package Manager:**
- Python: `pip` with `requirements.txt` (`server/requirements.txt`)
- Node.js: `npm` with `package-lock.json` (implied by `npm ci` in Dockerfile)
- Lockfiles: present (Docker uses `npm ci`)

## Frameworks

**Core:**
- FastAPI >=0.111.0 - Python HTTP + WebSocket server (`server/main.py`)
- Uvicorn >=0.29.0 (standard extras) - ASGI server, runs FastAPI (`server/main.py`)
- React 19.2.5 - Mobile client UI (`mobile/`)
- React 18.2.0 - Overlay client UI (`overlay/`)
- Pydantic >=2.7.0 - Message schema validation and serialization (`server/protocol.py`)

**Rendering:**
- PixiJS ^8.18.1 - 2D WebGL renderer for overlay fight visualization (`overlay/src/components/PixiCanvas.tsx`)
- `@mediapipe/tasks-vision` ^0.10.34 - Real-time pose landmark detection in the browser (`mobile/src/hooks/usePose.ts`)

**Testing:**
- Vitest ^4.1.5 - Unit test runner for mobile client (`mobile/vitest.config.ts`)
- jsdom ^29.0.2 - DOM environment for Vitest tests
- `@testing-library/react` ^16.3.2 - React component testing utilities (`mobile/src/`)
- pytest >=8.2.0 - Python server tests (`server/tests/`)
- pytest-asyncio >=0.23.0 - Async test support for server (`server/tests/`)
- httpx >=0.27.0 - HTTP client used in server tests

**Build/Dev:**
- Vite ^8.0.10 - Frontend bundler/dev server for mobile and overlay
- `@vitejs/plugin-react` ^6.0.1 - React Fast Refresh + JSX transform in Vite
- TypeScript compiler (`tsc`) - Used for `--noEmit` type-checking before Vite build

## Key Dependencies

**Critical:**
- `anthropic` >=0.40.0 - Anthropic Python SDK; drives the live AI commentator via Claude streaming (`server/commentator.py`)
- `websockets` >=12.0 - WebSocket protocol support for FastAPI/uvicorn (`server/`)
- `numpy` >=1.26.0 - Numerical operations for hit detection and pose physics (`server/hit_detection.py`, `server/damage.py`)
- `@mediapipe/tasks-vision` ^0.10.34 - Browser-side pose landmark model; loads WASM + `.task` model file from CDN (`mobile/src/hooks/usePose.ts`)
- `pixi.js` ^8.18.1 - WebGL 2D canvas for the overlay fight renderer (`overlay/src/components/PixiCanvas.tsx`)

**Infrastructure:**
- `python-dotenv` >=1.0.0 - Loads `.env` into `os.environ` at server startup (`server/main.py`)
- `qrcode` >=7.4.2 - Generates QR codes (PNG) for player join URLs (`server/qr.py`)
- `pillow` >=10.3.0 - Image support for qrcode PNG rendering (`server/qr.py`)
- `httpx` >=0.27.0 - Async HTTP client; used for ElevenLabs TTS requests (`server/commentator.py`)
- `ws` ^8.20.0 - WebSocket client in Node (used in test/dev scripts, listed in both `mobile` and `overlay` devDependencies)

## Configuration

**Environment:**
- Configured via `.env` file at `server/.env` (loaded by `python-dotenv`)
- Key env vars (see INTEGRATIONS.md for secrets):
  - `PORT` (default `8000`) - Server listen port
  - `TUNNEL` (default `"true"`) - Enable/disable Cloudflare tunnel
  - `PUBLIC_URL` - Override public-facing base URL
  - `MOBILE_URL` - Override mobile client base URL
  - `OVERLAY_URL` - Override overlay client base URL

**Build:**
- `mobile/vite.config.ts` - Vite config; sets `base` path to `/mobile/` in production, `@shared` alias
- `overlay/vite.config.ts` - Vite config; sets `base` path to `/overlay/` in production, `@shared` alias
- `mobile/tsconfig.app.json` / `overlay/tsconfig.app.json` - TypeScript strict mode, `paths` alias for `@shared/*`
- `Dockerfile` - Multi-stage: builds overlay, mobile, then copies dists into Python image
- `railway.toml` - Railway deployment: Dockerfile builder, restart on failure (max 3 retries)

**Protocol Generation:**
- `shared/protocol.ts` is auto-generated from `server/protocol.py` (single source of truth)
- Run: `python scripts/gen_protocol.py`
- Pre-commit check mode: `python scripts/gen_protocol.py --check`

## Platform Requirements

**Development:**
- Python 3.11+
- Node.js 20+
- `cloudflared` CLI (optional; required when `TUNNEL=true` for LAN-to-public tunneling)

**Production:**
- Docker (multi-stage build defined in `Dockerfile`)
- Deployed to Railway via `railway.toml` (Dockerfile builder)
- Server serves static `mobile/dist/` at `/mobile` and `overlay/dist/` at `/overlay`
- MediaPipe WASM and pose model loaded from external CDN at runtime (no bundled model assets)

---

*Stack analysis: 2026-05-02*
