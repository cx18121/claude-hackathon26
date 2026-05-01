from __future__ import annotations
import asyncio
import html as _html
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlencode

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

from broadcast import broadcast_to_spectators
from game_loop import GameLoop
from protocol import (
    MsgCalibrationStart, MsgJoined, MsgMatchEnd, MsgMatchStart,
    MsgPing, MsgPong, MsgPlayerDisconnected, MsgPoseUpdate,
    MsgRematchStart,
    parse_mobile_msg,
)
from qr import make_qr_b64, print_startup_info
from rooms import RoomManager, record_pong
from tunnel import TunnelManager

load_dotenv()

PORT = int(os.getenv("PORT", "8000"))
TUNNEL = os.getenv("TUNNEL", "true").lower() != "false"
PUBLIC_URL = os.getenv("PUBLIC_URL", "").rstrip("/")
MOBILE_URL = os.getenv("MOBILE_URL", "").rstrip("/")
OVERLAY_URL = os.getenv("OVERLAY_URL", "").rstrip("/")


def _server_url(request: Request) -> str:
    return PUBLIC_URL or str(request.base_url).rstrip("/")


def _mobile_base(server_url: str) -> str:
    return MOBILE_URL or f"{server_url}/mobile"


def _overlay_base(server_url: str) -> str:
    return OVERLAY_URL or f"{server_url}/overlay"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)

room_manager = RoomManager()
tunnel_manager = TunnelManager()

_active_tasks: set[asyncio.Task] = set()


def _track_task(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _active_tasks.add(task)
    task.add_done_callback(_active_tasks.discard)
    return task


@asynccontextmanager
async def lifespan(app: FastAPI):
    code = room_manager.create_room()
    app.state.default_room = code

    url = await asyncio.to_thread(tunnel_manager.start, PORT)
    app.state.tunnel = tunnel_manager

    print_startup_info(url, code)

    yield

    # Stop all running game loops and close all WebSocket connections
    for room_code in room_manager.list_rooms():
        room = room_manager.get_room(room_code)
        if room is None:
            continue
        if room.game_loop is not None:
            room.game_loop.stop()
        for slot in room.players.values():
            if slot.ws is not None:
                try:
                    await slot.ws.close()
                except Exception:
                    pass
        for ws in list(room.spectators):
            try:
                await ws.close()
            except Exception:
                pass

    # Cancel all tracked background tasks
    if _active_tasks:
        for task in list(_active_tasks):
            task.cancel()
        await asyncio.gather(*_active_tasks, return_exceptions=True)

    tunnel_manager.stop()
    log.info("Server shut down cleanly")


app = FastAPI(lifespan=lifespan)

_overlay_dist = Path(__file__).resolve().parent.parent / "overlay" / "dist"
_mobile_dist = Path(__file__).resolve().parent.parent / "mobile" / "dist"
if _overlay_dist.exists() or _mobile_dist.exists():
    from fastapi.staticfiles import StaticFiles
    from starlette.types import Scope

    class NoCacheHtmlStatic(StaticFiles):
        """StaticFiles wrapper that disables caching on .html responses.

        The Vite-built index.html references hashed asset filenames. If a
        phone caches index.html across rebuilds, it keeps requesting the
        old hash and 404s -- the white-screen symptom. Hashed JS/CSS files
        are still cacheable forever (the hash IS the cache key), so we
        only no-store the HTML."""

        async def get_response(self, path: str, scope: Scope):
            response = await super().get_response(path, scope)
            if path.endswith(".html") or path in ("", "/"):
                response.headers["Cache-Control"] = "no-store, must-revalidate"
            return response

    if _overlay_dist.exists():
        app.mount("/overlay", NoCacheHtmlStatic(directory=str(_overlay_dist), html=True), name="overlay")
    if _mobile_dist.exists():
        app.mount("/mobile", NoCacheHtmlStatic(directory=str(_mobile_dist), html=True), name="mobile")


@app.get("/", response_class=HTMLResponse)
def landing():
    return """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Spectre</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: monospace; background: #0a0a0a; color: #eee; min-height: 100vh;
           display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2rem; }
    h1 { font-size: 3.5rem; letter-spacing: 0.4em; }
    .sub { color: #555; letter-spacing: 0.15em; font-size: 0.9rem; }
    .btn-create { background: #0e2a3a; border: 1px solid #2a6a8a; border-radius: 6px;
                  padding: 0.9rem 2.5rem; color: #5af; cursor: pointer; font-family: monospace;
                  font-size: 1rem; letter-spacing: 0.1em; }
    .btn-create:hover { background: #183a4a; }
    .btn-create:disabled { opacity: 0.5; cursor: default; }
    .format-group { display: flex; gap: 0.5rem; }
    .fmt { background: #141414; border: 1px solid #2a2a2a; border-radius: 4px;
           padding: 0.5rem 1rem; color: #777; cursor: pointer; font-family: monospace;
           font-size: 0.85rem; letter-spacing: 0.08em; }
    .fmt:hover { border-color: #444; color: #aaa; }
    .fmt.active { border-color: #2a6a8a; color: #5af; background: #0e2a3a; }
    .join { display: flex; gap: 0.5rem; }
    input { background: #141414; border: 1px solid #2a2a2a; border-radius: 4px;
            padding: 0.65rem 0.75rem; color: #eee; font-family: monospace; font-size: 1rem;
            letter-spacing: 0.25em; text-transform: uppercase; width: 130px; text-align: center; outline: none; }
    input:focus { border-color: #2a6a8a; }
    .btn-join { background: #1a1a1a; border: 1px solid #333; border-radius: 4px;
                padding: 0.65rem 1rem; color: #aaa; cursor: pointer; font-family: monospace; }
    .btn-join:hover { background: #252525; }
    .err { color: #a44; font-size: 0.8rem; height: 1em; }
  </style>
</head>
<body>
  <h1>SPECTRE</h1>
  <p class="sub">real punches. real fights.</p>
  <div class="format-group">
    <button class="fmt" data-fmt="bo1">BO1</button>
    <button class="fmt active" data-fmt="bo3">BO3</button>
    <button class="fmt" data-fmt="bo5">BO5</button>
  </div>
  <button class="btn-create" id="create">Create New Game</button>
  <div class="join">
    <input id="code" maxlength="6" placeholder="ROOM CODE">
    <button class="btn-join" id="join">Join</button>
  </div>
  <div class="err" id="err"></div>
  <script>
    let selectedFmt = 'bo3';
    document.querySelectorAll('.fmt').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.fmt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedFmt = btn.dataset.fmt;
      });
    });
    document.getElementById('create').addEventListener('click', async () => {
      const btn = document.getElementById('create');
      btn.textContent = 'Creating...';
      btn.disabled = true;
      try {
        const res = await fetch('/rooms?format=' + selectedFmt, { method: 'POST' });
        const { code } = await res.json();
        window.location.href = '/rooms/' + code;
      } catch {
        btn.textContent = 'Create New Game';
        btn.disabled = false;
      }
    });
    function goJoin() {
      const code = document.getElementById('code').value.trim().toUpperCase();
      if (code.length === 6) {
        window.location.href = '/rooms/' + code;
      } else {
        document.getElementById('err').textContent = 'Enter a 6-character room code.';
      }
    }
    document.getElementById('join').addEventListener('click', goJoin);
    document.getElementById('code').addEventListener('keydown', e => {
      if (e.key === 'Enter') goJoin();
      document.getElementById('err').textContent = '';
    });
    document.getElementById('code').addEventListener('input', e => {
      e.target.value = e.target.value.toUpperCase();
    });
  </script>
</body>
</html>"""


def _lobby_update_json(room) -> str:
    return json.dumps({
        "type": "lobby_update",
        "p1": room.players[1].connected,
        "p2": room.players[2].connected,
    })

async def _broadcast_lobby_update(room) -> None:
    await broadcast_to_spectators(room, _lobby_update_json(room))


_FORMAT_TO_WINS = {"bo1": 1, "bo3": 2, "bo5": 3}

@app.post("/rooms")
def create_room(format: str = "bo3", mode: str = "pvp", difficulty: str = "normal"):
    max_wins = _FORMAT_TO_WINS.get(format, 2)
    solo = mode == "solo"
    code = room_manager.create_room(max_wins=max_wins, solo=solo, bot_difficulty=difficulty)
    return {"code": code}


@app.get("/rooms/{room_code}", response_class=HTMLResponse)
def room_page(room_code: str, request: Request):
    room = room_manager.get_room(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    server_url = _server_url(request)
    base_qs = urlencode({"server": server_url, "room": room_code})
    p1_url = f"{_mobile_base(server_url)}?{base_qs}&slot=1"
    p2_url = f"{_mobile_base(server_url)}?{base_qs}&slot=2"
    ov_url = f"{_overlay_base(server_url)}?{base_qs}"

    p1_qr = make_qr_b64(p1_url)
    p2_qr = make_qr_b64(p2_url)
    ov_qr = make_qr_b64(ov_url)

    safe_code = _html.escape(room_code)
    best_of = room.max_wins * 2 - 1
    format_label = _html.escape(f"BEST OF {best_of}")
    urls_js = f"""
    const P1 = {json.dumps(p1_url)};
    const P2 = {json.dumps(p2_url)};
    const OV = {json.dumps(ov_url)};
    """

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Spectre — {safe_code}</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: monospace; background: #0a0a0a; color: #eee; min-height: 100vh;
            display: flex; flex-direction: column; align-items: center; padding: 2rem; gap: 1.5rem; }}
    h1 {{ font-size: 2rem; letter-spacing: 0.3em; }}
    .code {{ font-size: 2.5rem; font-weight: bold; letter-spacing: 0.4em; color: #5af; }}
    .cards {{ display: flex; gap: 1.5rem; flex-wrap: wrap; justify-content: center; }}
    .card {{ background: #141414; border: 1px solid #2a2a2a; border-radius: 10px;
             padding: 1.5rem; display: flex; flex-direction: column; align-items: center; gap: 0.75rem; width: 220px; }}
    .card h2 {{ font-size: 0.75rem; letter-spacing: 0.15em; text-transform: uppercase; color: #777; }}
    .card img {{ width: 160px; height: 160px; border-radius: 6px; }}
    .url {{ width: 100%; background: #0e0e0e; border: 1px solid #1e1e1e; border-radius: 4px;
            padding: 0.4rem 0.6rem; font-size: 0.6rem; word-break: break-all; color: #5af; line-height: 1.4; }}
    .btn {{ width: 100%; border-radius: 4px; padding: 0.5rem; cursor: pointer;
            font-family: monospace; font-size: 0.8rem; border: 1px solid #2a2a2a; background: #1a1a1a; color: #bbb;
            text-align: center; text-decoration: none; display: block; }}
    .btn:hover {{ background: #242424; }}
    .btn-open {{ background: #0e2a3a; border-color: #1e5a7a; color: #5af; }}
    .btn-open:hover {{ background: #183a4a; }}
    .notice {{ font-size: 0.7rem; color: #3a3; height: 1em; }}
    a.back {{ font-size: 0.8rem; color: #444; text-decoration: none; align-self: flex-start; }}
    a.back:hover {{ color: #777; }}
    .format {{ font-size: 0.7rem; letter-spacing: 0.18em; color: #555; text-transform: uppercase; margin-top: -0.5rem; }}
  </style>
</head>
<body>
  <a class="back" href="/">← New game</a>
  <h1>SPECTRE</h1>
  <div class="code">{safe_code}</div>
  <div class="format">{format_label}</div>
  <div class="cards">
    <div class="card">
      <h2>Player 1</h2>
      <img src="data:image/png;base64,{p1_qr}" alt="QR Player 1">
      <div class="url" id="u1"></div>
      <div class="notice" id="n1"></div>
      <button class="btn" id="cp1">Copy link</button>
      <a class="btn btn-open" id="a1" target="_blank">Open</a>
    </div>
    <div class="card">
      <h2>Player 2</h2>
      <img src="data:image/png;base64,{p2_qr}" alt="QR Player 2">
      <div class="url" id="u2"></div>
      <div class="notice" id="n2"></div>
      <button class="btn" id="cp2">Copy link</button>
      <a class="btn btn-open" id="a2" target="_blank">Open</a>
    </div>
    <div class="card">
      <h2>Overlay</h2>
      <img src="data:image/png;base64,{ov_qr}" alt="QR Overlay">
      <div class="url" id="u3"></div>
      <div class="notice" id="n3"></div>
      <button class="btn" id="cp3">Copy link</button>
      <a class="btn btn-open" id="a3" target="_blank">Open</a>
    </div>
  </div>
  <script>
    {urls_js}
    function setup(url, uid, aid, cpid, nid) {{
      document.getElementById(uid).textContent = url;
      document.getElementById(aid).href = url;
      document.getElementById(cpid).addEventListener('click', () => {{
        navigator.clipboard.writeText(url);
        const n = document.getElementById(nid);
        n.textContent = 'Copied!';
        setTimeout(() => {{ n.textContent = ''; }}, 2000);
      }});
    }}
    setup(P1, 'u1', 'a1', 'cp1', 'n1');
    setup(P2, 'u2', 'a2', 'cp2', 'n2');
    setup(OV, 'u3', 'a3', 'cp3', 'n3');
  </script>
</body>
</html>"""


@app.post("/rooms/{room_code}/rematch")
async def rematch(room_code: str):
    room = room_manager.get_room(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    # Stop the existing game loop
    if room.game_loop is not None:
        room.game_loop.stop()
        room.game_loop = None

    # Reset all match state (calibration is intentionally preserved)
    room.reset_for_rematch()

    # Notify spectators so the overlay resets to the waiting screen
    await broadcast_to_spectators(room, MsgRematchStart().model_dump_json())
    await _broadcast_lobby_update(room)

    # Send calibration_start to all connected players
    cal_json = MsgCalibrationStart().model_dump_json()
    connected = [s for s in room.players.values() if s.connected and s.ws is not None]
    for slot in connected:
        try:
            await slot.ws.send_text(cal_json)
        except Exception:
            pass

    log.info("Rematch triggered for room %s (%d player(s) connected)", room_code, len(connected))
    return {"ok": True}


@app.websocket("/ws/player/{room_code}")
async def ws_player(websocket: WebSocket, room_code: str):
    room = room_manager.get_room(room_code)
    if room is None:
        await websocket.accept()
        await websocket.close(code=4004, reason="Room not found")
        return

    requested_slot: int | None = None
    slot_param = websocket.query_params.get("slot")
    if slot_param in ("1", "2"):
        requested_slot = int(slot_param)

    # Find an open slot. If the client requested a specific slot, honor it
    # and reject the connection if that slot is already occupied.
    slot_num = None
    if requested_slot is not None:
        if not room.players[requested_slot].connected:
            slot_num = requested_slot
    else:
        for n in (1, 2):
            if not room.players[n].connected:
                slot_num = n
                break

    if slot_num is None:
        await websocket.accept()
        await websocket.close(code=4000, reason="Room is full")
        return

    await websocket.accept()
    slot = room.players[slot_num]

    # Detect reconnect: player was calibrated and a match is in progress
    is_reconnect = slot.reference_velocity is not None and room.game_loop is not None

    slot.ws = websocket
    slot.connected = True
    log.info("Player %d %s to room %s", slot_num, "reconnected" if is_reconnect else "connected", room_code)
    if not is_reconnect:
        await _broadcast_lobby_update(room)

    async def ping_loop():
        import time
        while slot.connected:
            try:
                await websocket.send_text(MsgPing(t=time.time()).model_dump_json())
            except Exception:
                break
            await asyncio.sleep(0.5)

    _track_task(ping_loop())

    opponent = room.players[3 - slot_num]
    await websocket.send_text(
        MsgJoined(
            room_code=room_code,
            player_slot=slot_num,
            # In solo mode the bot is always "present", so skip the waiting lobby.
            opponent_connected=room.solo or opponent.connected,
        ).model_dump_json()
    )

    if is_reconnect:
        # Cancel the forfeit timer and resume the game loop
        timer = room.disconnect_timers.pop(slot_num, None)
        if timer is not None:
            timer.cancel()
        if room.game_loop is not None and room.game_loop.paused:
            room.game_loop.paused = False
            log.info("Game loop resumed for room %s after player %d reconnect", room_code, slot_num)
        # Re-send match_start so the reconnected client restores the match phase
        await websocket.send_text(MsgMatchStart().model_dump_json())
    elif room.solo and slot_num == 1:
        # Solo mode: bot is always ready, start calibration immediately.
        await websocket.send_text(MsgCalibrationStart().model_dump_json())
    else:
        if opponent.connected:
            # Both players now connected — kick off calibration for both simultaneously
            cal_json = MsgCalibrationStart().model_dump_json()
            await websocket.send_text(cal_json)
            if opponent.ws is not None:
                try:
                    await opponent.ws.send_text(cal_json)
                except Exception:
                    pass
        # else: opponent not here yet — wait; we'll send calibration_start when they join

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
                msg = parse_mobile_msg(data)
            except Exception as exc:
                log.warning("Player %d bad message: %s", slot_num, exc)
                continue

            if msg.type != "pose_frame":
                log.info("Player %d [%s]: %s", slot_num, room_code, msg.type)

            if msg.type == "pose_frame":
                slot.latest_pose = msg
                if room.game_loop is not None:
                    room.game_loop.add_pose_frame(slot_num, msg)
                # Push the freshly-arrived pose to every spectator immediately
                # so the overlay renders at the mobile capture rate without
                # waiting for the next 60Hz tick. Hit detection / HP still
                # come from the fairness-delayed game_state stream.
                if room.spectators:
                    pose_update_json = MsgPoseUpdate(
                        player=slot_num, keypoints=msg.keypoints,
                    ).model_dump_json()
                    dead_specs: set = set()
                    for ws in room.spectators:
                        try:
                            await ws.send_text(pose_update_json)
                        except Exception:
                            dead_specs.add(ws)
                    if dead_specs:
                        room.spectators -= dead_specs
            elif msg.type == "ping":
                await websocket.send_text(MsgPong(t=msg.t).model_dump_json())
            elif msg.type == "pong":
                record_pong(slot, msg.t)
            elif msg.type == "calibration_done":
                slot.reference_velocity = msg.reference_velocity
                log.info("Player %d calibrated, ref_velocity=%.2f", slot_num, msg.reference_velocity)
                if room.solo and slot_num == 1:
                    # Bot inherits P1's reference velocity so hit thresholds scale correctly.
                    room.players[2].reference_velocity = msg.reference_velocity
                if (
                    all(p.reference_velocity is not None for p in room.players.values())
                    and room.game_loop is None
                ):
                    game_loop = GameLoop(room)
                    room.game_loop = game_loop
                    _track_task(game_loop.run())
                    log.info("Game loop started for room %s after calibration", room_code)
                    match_start_json = MsgMatchStart().model_dump_json()
                    for p in room.players.values():
                        if p.ws is not None:
                            try:
                                await p.ws.send_text(match_start_json)
                            except Exception:
                                pass
    except WebSocketDisconnect:
        pass
    finally:
        slot.connected = False
        slot.ws = None
        log.info("Player %d disconnected from room %s", slot_num, room_code)

        if room.game_loop is None:
            # Pre-game disconnect — clear calibration state and notify the
            # waiting opponent so their client returns to the lobby.
            slot.reference_velocity = None
            opp_ws = room.players[3 - slot_num].ws
            if opp_ws is not None:
                try:
                    await opp_ws.send_text(MsgPlayerDisconnected(player=slot_num).model_dump_json())
                except Exception:
                    pass
            await _broadcast_lobby_update(room)
        elif room.game_loop is not None:
            opponent_connected = any(p.connected for p in room.players.values())
            if opponent_connected:
                # Pause match and give the disconnected player 30s to reconnect
                room.game_loop.paused = True
                disconnected_msg = MsgPlayerDisconnected(player=slot_num).model_dump_json()
                for ws in list(room.spectators):
                    try:
                        await ws.send_text(disconnected_msg)
                    except Exception:
                        pass
                opponent_ws = room.players[3 - slot_num].ws
                if opponent_ws is not None:
                    try:
                        await opponent_ws.send_text(disconnected_msg)
                    except Exception:
                        pass

                async def _forfeit_timer(s=slot_num, r=room, rc=room_code):
                    await asyncio.sleep(30)
                    if not r.players[s].connected and r.game_loop is not None:
                        winner = 3 - s
                        r.match_over = True
                        r.game_loop.stop()
                        r.game_loop = None
                        end_msg = MsgMatchEnd(winner=winner).model_dump_json()
                        for p in r.players.values():
                            if p.ws is not None:
                                try:
                                    await p.ws.send_text(end_msg)
                                except Exception:
                                    pass
                        for ws in list(r.spectators):
                            try:
                                await ws.send_text(end_msg)
                            except Exception:
                                pass
                        log.info("Player %d forfeited room %s after 30s disconnect", s, rc)
                    r.disconnect_timers.pop(s, None)

                room.disconnect_timers[slot_num] = _track_task(_forfeit_timer())
            else:
                # All players gone — stop immediately
                room.game_loop.stop()
                room.game_loop = None
                log.info("Game loop stopped for room %s", room_code)


@app.websocket("/ws/spectator/{room_code}")
async def ws_spectator(websocket: WebSocket, room_code: str):
    room = room_manager.get_room(room_code)
    if room is None:
        await websocket.accept()
        await websocket.close(code=4004, reason="Room not found")
        return

    await websocket.accept()
    room.add_spectator(websocket)
    log.info("Spectator connected to room %s", room_code)
    await websocket.send_text(_lobby_update_json(room))

    try:
        while True:
            await websocket.receive_text()  # keep alive, discard input
    except WebSocketDisconnect:
        pass
    finally:
        room.remove_spectator(websocket)
        log.info("Spectator disconnected from room %s", room_code)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
