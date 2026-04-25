"""Game loop integration tests: 60Hz tick, hit logging, spectator broadcast."""
from __future__ import annotations
import asyncio
import json
import os
import time
from collections import deque

import pytest

os.environ.setdefault("TUNNEL", "false")

from protocol import MsgPoseFrame, PoseKeypoint
from rooms import RoomState, PlayerSlot
from game_loop import GameLoop
from hit_detection import LEFT_HIP, RIGHT_HIP, LEFT_SHOULDER, RIGHT_SHOULDER, WRIST_LEFT


def kp(x=0.0, y=0.0, z=0.0) -> PoseKeypoint:
    return PoseKeypoint(x=x, y=y, z=z, visibility=1.0)


def make_frame(wrist_x=0.0, wrist_y=-0.10) -> MsgPoseFrame:
    pts = [kp()] * 33
    pts = list(pts)
    pts[LEFT_HIP]   = kp(x=-0.1)
    pts[RIGHT_HIP]  = kp(x= 0.1)
    pts[LEFT_SHOULDER] = kp(x=-0.2, y=-0.25)
    pts[RIGHT_SHOULDER] = kp(x=0.2, y=-0.25)
    pts[WRIST_LEFT] = kp(x=wrist_x, y=wrist_y)
    return MsgPoseFrame(type="pose_frame", timestamp=time.time(), keypoints=pts)


def make_room() -> RoomState:
    room = RoomState(code="TEST01")
    room.players[1].connected = True
    room.players[1].reference_velocity = 3.0
    room.players[2].connected = True
    room.players[2].reference_velocity = 3.0
    return room


# --- unit: add_pose_frame ----------------------------------------------------

def test_add_pose_frame_buffers_frame():
    room = make_room()
    gl = GameLoop(room)
    frame = make_frame()
    gl.add_pose_frame(1, frame)
    assert len(gl._buffers[1]) == 1


def test_buffer_capped_at_180():
    room = make_room()
    gl = GameLoop(room)
    for _ in range(200):
        gl.add_pose_frame(1, make_frame())
    assert len(gl._buffers[1]) == 180


# --- unit: input delay releases frames correctly -----------------------------

@pytest.mark.asyncio
async def test_frames_released_after_delay():
    room = make_room()
    gl = GameLoop(room)
    # With 0 RTT (default), delay is 0 -> frames released immediately
    frame = make_frame()
    gl.add_pose_frame(1, frame)
    gl.add_pose_frame(2, frame)
    await gl._tick()
    assert len(gl._processed[1]) == 1
    assert len(gl._processed[2]) == 1


# --- unit: damage applied on hit ---------------------------------------------

@pytest.mark.asyncio
async def test_hit_reduces_hp():
    room = make_room()
    gl = GameLoop(room)

    # Fast punch: wrist moves 2m in 2 frames -> ~30 m/s >> threshold
    # wrist_y=-0.45: 0.45m above hips in MediaPipe Y-down → head zone
    for x in (-2.0, -1.0, 0.0):
        f = make_frame(wrist_x=x, wrist_y=-0.45)  # head height in MediaPipe Y-down
        f2 = make_frame()  # static defender
        gl._processed[1].append(f)
        gl._processed[2].append(f2)

    initial_hp = gl.hp[1]
    await gl._tick()
    assert gl.hp[1] < initial_hp, "Defender HP should decrease after a hit"


# --- unit: hit cooldown prevents double-counting ----------------------------

@pytest.mark.asyncio
async def test_hit_cooldown_suppresses_repeated_hits():
    room = make_room()
    gl = GameLoop(room)

    # Load processed frames with a fast punch in head zone
    # wrist_y=-0.45: 0.45m above hips in MediaPipe Y-down → head zone
    for x in (-2.0, -1.0, 0.0):
        gl._processed[1].append(make_frame(wrist_x=x, wrist_y=-0.45))
        gl._processed[2].append(make_frame())

    await gl._tick()
    hp_after_first = gl.hp[1]

    # Second tick immediately -- same pose data, should be suppressed by cooldown
    await gl._tick()
    assert gl.hp[1] == hp_after_first, "Cooldown should prevent damage on consecutive tick"


# --- unit: game_state broadcast to spectators --------------------------------

@pytest.mark.asyncio
async def test_game_state_broadcast_to_spectators():
    room = make_room()
    gl = GameLoop(room)

    received: list[str] = []

    class FakeWS:
        async def send_text(self, text: str) -> None:
            received.append(text)

    room.spectators.add(FakeWS())

    # Add pose frames so state is non-trivial
    gl._processed[1].append(make_frame())
    gl._processed[2].append(make_frame())

    await gl._tick()
    assert len(received) == 1
    state = json.loads(received[0])
    assert state["type"] == "game_state"
    assert state["tick"] == 1
    assert len(state["hp"]) == 2
    assert state["hp"][0] == 300
    assert state["hp"][1] == 300


# --- unit: dead spectators pruned --------------------------------------------

@pytest.mark.asyncio
async def test_dead_spectators_pruned():
    room = make_room()
    gl = GameLoop(room)

    class DeadWS:
        async def send_text(self, _: str) -> None:
            raise RuntimeError("connection closed")

    room.spectators.add(DeadWS())
    gl._processed[1].append(make_frame())
    gl._processed[2].append(make_frame())

    await gl._tick()
    assert len(room.spectators) == 0


# --- integration: game loop starts after both players calibrate --------------

def test_game_loop_starts_after_calibration():
    from fastapi.testclient import TestClient
    from main import app, room_manager

    with TestClient(app) as client:
        room_code = client.app.state.default_room
        r = room_manager.get_room(room_code)

        with client.websocket_connect(f"/ws/player/{room_code}") as ws1:
            ws1.receive_text()  # joined

            with client.websocket_connect(f"/ws/player/{room_code}") as ws2:
                ws2.receive_text()  # joined
                ws2.receive_text()  # calibration_start
                ws1.receive_text()  # calibration_start

                # Game loop should NOT be running before calibration
                assert r.game_loop is None

                import json as _json
                # Piggyback a ping to confirm ws1's calibration_done was processed
                ws1.send_text(_json.dumps({"type": "calibration_done", "reference_velocity": 3.0}))
                ws1.send_text(_json.dumps({"type": "ping", "t": 0.0}))
                ws1.receive_text()  # pong -- proves calibration_done was handled first

                ws2.send_text(_json.dumps({"type": "calibration_done", "reference_velocity": 3.0}))
                ws2.receive_text()  # match_start -- game loop started

                assert r.game_loop is not None
