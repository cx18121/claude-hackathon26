from __future__ import annotations
import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

from protocol import MsgJoined, MsgPing, MsgPong, parse_mobile_msg
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    code = room_manager.create_room()
    app.state.default_room = code

    url = await asyncio.to_thread(tunnel_manager.start, PORT)
    app.state.tunnel = tunnel_manager

    print_startup_info(url, code)

    yield

    tunnel_manager.stop()


app = FastAPI(lifespan=lifespan)


@app.get("/", response_class=HTMLResponse)
def landing():
    code = app.state.default_room
    return f"""<!DOCTYPE html>
<html>
<head><title>Shadow Fight Server</title></head>
<body style="font-family:monospace;background:#111;color:#eee;padding:2rem">
<h1>Shadow Fight Server</h1>
<p>Status: running</p>
<p>Room code: <strong>{code}</strong></p>
<p>Join: <a href="/join?room={code}" style="color:#7af">/join?room={code}</a></p>
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
    slot.ws = websocket
    slot.connected = True
    log.info("Player %d connected to room %s", slot_num, room_code)

    async def ping_loop():
        import time
        while slot.connected:
            try:
                await websocket.send_text(MsgPing(t=time.time()).model_dump_json())
            except Exception:
                break
            await asyncio.sleep(0.5)

    asyncio.create_task(ping_loop())

    opponent = room.players[3 - slot_num]
    await websocket.send_text(
        MsgJoined(
            room_code=room_code,
            player_slot=slot_num,
            opponent_connected=opponent.connected,
        ).model_dump_json()
    )

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
                msg = parse_mobile_msg(data)
            except Exception as exc:
                log.warning("Player %d bad message: %s", slot_num, exc)
                continue

            log.info("Player %d [%s]: %s", slot_num, room_code, msg.type)

            if msg.type == "pose_frame":
                slot.latest_pose = msg
                await websocket.send_text(raw)  # echo back for Sprint 1
            elif msg.type == "ping":
                # Client-originated ping: echo back for client-side RTT display
                await websocket.send_text(MsgPong(t=msg.t).model_dump_json())
            elif msg.type == "pong":
                # Server-originated ping echoed back: record server-side RTT
                record_pong(slot, msg.t)
    except WebSocketDisconnect:
        pass
    finally:
        slot.connected = False
        slot.ws = None
        log.info("Player %d disconnected from room %s", slot_num, room_code)


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
