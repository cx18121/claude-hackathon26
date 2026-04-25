from __future__ import annotations
import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

from game_loop import GameLoop
from protocol import (
    MsgCalibrationStart, MsgJoined, MsgMatchEnd, MsgMatchStart,
    MsgPing, MsgPong, MsgPlayerDisconnected, parse_mobile_msg,
)
from qr import print_startup_info
from rooms import RoomManager, record_pong
from tunnel import TunnelManager

load_dotenv()

PORT = int(os.getenv("PORT", "8000"))
TUNNEL = os.getenv("TUNNEL", "true").lower() != "false"

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
    code = app.state.default_room
    # Both player links go to /mobile (the bundled mobile client). Server
    # picks the first open slot regardless of the slot query param, but we
    # still pass it so the UI starts with a sensible default.
    return f"""<!DOCTYPE html>
<html>
<head><title>Shadow Fight Server</title></head>
<body style="font-family:monospace;background:#111;color:#eee;padding:2rem">
<h1>Shadow Fight Server</h1>
<p>Status: running</p>
<p>Room code: <strong>{code}</strong></p>
<p>Player 1: <a href="/mobile?room={code}&slot=1" style="color:#7af">/mobile?room={code}&slot=1</a></p>
<p>Player 2: <a href="/mobile?room={code}&slot=2" style="color:#7af">/mobile?room={code}&slot=2</a></p>
<p>Overlay: <a href="/overlay?room={code}" style="color:#7af">/overlay?room={code}</a></p>
</body>
</html>"""


@app.post("/rooms")
def create_room():
    code = room_manager.create_room()
    return {"code": code}


@app.websocket("/ws/player/{room_code}")
async def ws_player(websocket: WebSocket, room_code: str):
    room = room_manager.get_room(room_code)
    if room is None:
        await websocket.close(code=4004)
        return

    # Find an open slot
    slot_num = None
    for n in (1, 2):
        if not room.players[n].connected:
            slot_num = n
            break

    if slot_num is None:
        await websocket.close(code=4000, reason="room full")
        return

    await websocket.accept()
    slot = room.players[slot_num]

    # Detect reconnect: player was calibrated and a match is in progress
    is_reconnect = slot.reference_velocity is not None and room.game_loop is not None

    slot.ws = websocket
    slot.connected = True
    log.info("Player %d %s to room %s", slot_num, "reconnected" if is_reconnect else "connected", room_code)

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
            opponent_connected=opponent.connected,
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
            elif msg.type == "ping":
                await websocket.send_text(MsgPong(t=msg.t).model_dump_json())
            elif msg.type == "pong":
                record_pong(slot, msg.t)
            elif msg.type == "calibration_done":
                slot.reference_velocity = msg.reference_velocity
                log.info("Player %d calibrated, ref_velocity=%.2f", slot_num, msg.reference_velocity)
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
        await websocket.close(code=4004)
        return

    await websocket.accept()
    room.spectators.add(websocket)
    log.info("Spectator connected to room %s", room_code)

    try:
        while True:
            await websocket.receive_text()  # keep alive, discard input
    except WebSocketDisconnect:
        pass
    finally:
        room.spectators.discard(websocket)
        log.info("Spectator disconnected from room %s", room_code)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
