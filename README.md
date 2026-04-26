# spectre

A real-time 1v1 boxing game that turns your movement into gameplay. Throw real punches and kicks at your phone cameras and watch your silhouette fight in a live browser overlay. 

Built for the Cornell Claude Builders Club Hackathon, spring 2026, by Charlie Xue, Akhil Chilaka, Yosef Mimarbasi, and Adi Prathapa. 

We built this because nearly 80% of people in the U.S. don’t get enough exercise, while over half the world loves playing video games. So we gamified exercise with spectre.

Each phone runs MediaPipe pose estimation in the browser and streams keypoints to a Python game server. The server runs hit detection, damage, and round logic. A separate browser overlay renders the match in a Shadow Fight 2 style, with a live AI commentator powered by the Claude API and ElevenLabs.

No accounts. No cloud. One player runs the server on their laptop, and Cloudflare Tunnel or Tailscale makes it reachable from anywhere.

## How it works

```
Phone A (mobile client)          Phone B (mobile client)
  camera + MediaPipe                camera + MediaPipe
        \                                  /
         \________ pose keypoints ________/
                          |
                    Game Server
                  (Python, FastAPI)
                  60Hz simulation
                  hit detection
                  damage and rounds
                  Claude commentator
                          |
                    Overlay Renderer
                    (React + PixiJS)
                    silhouettes, HP bars,
                    sparks, subtitles, TTS
```

## Setup

You need Python 3.11+, Node 20+, and `cloudflared` if you want internet play.

```bash
git clone https://github.com/cx18121/claude-hackathon26.git
cd claude-hackathon26

# Server
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..

# Mobile client
cd mobile && npm install && cd ..

# Overlay
cd overlay && npm install && cd ..
```

Install `cloudflared` if you want to play across the internet:
- macOS: `brew install cloudflared`
- Linux: `apt install cloudflared`
- Windows: `winget install cloudflared`

For the AI commentator, drop your keys into `server/.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
ELEVENLABS_API_KEY=...
```

Both keys are optional. Without `ANTHROPIC_API_KEY` the commentator is disabled. Without `ELEVENLABS_API_KEY` you get text subtitles but no audio.

## Running it

### Same WiFi (laptop + two phones in one room)

```bash
bash scripts/dev.sh
```

This builds both Vite bundles, frees ports 8000/5173/5174, and starts everything. The server prints a room code on startup. Phones reach the server at the LAN IP printed in the launcher banner.

URLs the script prints:

```
Overlay:        http://<LAN_IP>:8000/overlay?room=<CODE>
Player 1 phone: http://<LAN_IP>:8000/mobile?room=<CODE>&slot=1
Player 2 phone: http://<LAN_IP>:8000/mobile?room=<CODE>&slot=2
```

### Across the internet (Cloudflare Tunnel)

```bash
bash scripts/tunnel.sh
```

The script starts the server with a Cloudflare quick tunnel and prints a `trycloudflare.com` URL plus a QR code for the Player 2 link. Share the URL with the other player and use the printed `/mobile?...&slot=1` / `&slot=2` and `/overlay?...` links from the launcher banner.

### Across blocked networks (Tailscale)

If you are on eduroam, hotel WiFi, or anywhere that blocks LAN discovery, use Tailscale instead. Every machine needs Tailscale installed and signed in to the same tailnet.

```bash
bash scripts/tailscale.sh
```

The script auto-detects your Tailscale IP, sets up `tailscale serve` for HTTPS (so phone browsers stop blocking the camera), and prints share-ready URLs.

## Playing a match

1. Both players open the camera capture URL on their phones/laptops with different slot numbers.
2. The host opens the overlay on a laptop or TV browser.
3. Each player completes a short calibration: hold a T-pose, then throw 3 full-speed practice punches so the server can learn your reach and punch velocity.
4. The match starts once both players finish calibrating and are ready.

Stand sideways to your phone. MediaPipe needs a side-view angle to read depth correctly.

## Project layout

```
server/      Python game server (FastAPI, asyncio, numpy)
mobile/      React + Vite client that runs MediaPipe in-browser
overlay/     React + Vite + PixiJS renderer
shared/      protocol.ts (TypeScript types shared between client and server)
scripts/     dev.sh (LAN), tunnel.sh (Cloudflare), tailscale.sh (tailnet)
docs/        Original sprint plans and design notes
```

## Tech stack

| Layer       | Stack                                                          |
| ----------- | -------------------------------------------------------------- |
| Server      | Python 3.11, FastAPI, uvicorn, asyncio, numpy, pydantic v2     |
| Pose        | MediaPipe Tasks Vision (Pose Landmarker)                       |
| Mobile      | Vite, React 18, TypeScript                                     |
| Overlay     | Vite, React 18, TypeScript, pixi.js v8                         |
| Commentator | Claude (Anthropic SDK) + ElevenLabs           |
| Transport   | WebSockets, Cloudflare Tunnel (quick tunnel) or Tailscale      |
