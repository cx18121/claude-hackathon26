"""Sprint 3 tests: round/match flow, calibration trigger."""
from __future__ import annotations
import json
import os
import time

import pytest

os.environ.setdefault("TUNNEL", "false")

from rooms import RoomState
from game_loop import GameLoop


def make_room() -> RoomState:
    room = RoomState(code="TEST01")
    room.players[1].connected = True
    room.players[1].reference_velocity = 3.0
    room.players[2].connected = True
    room.players[2].reference_velocity = 3.0
    return room


# --- room state ----------------------------------------------------------

def test_room_state_has_round_fields():
    room = RoomState(code="TEST01")
    assert room.round_number == 1
    assert room.wins == [0, 0]
    assert room.round_start_time is None
    assert room.match_over is False


# --- round timer ---------------------------------------------------------

@pytest.mark.asyncio
async def test_round_start_time_set_on_first_tick():
    room = make_room()
    gl = GameLoop(room)
    assert room.round_start_time is None
    await gl._tick()
    assert room.round_start_time is not None


@pytest.mark.asyncio
async def test_remaining_time_in_game_state():
    room = make_room()
    gl = GameLoop(room)
    received = []

    class FakeWS:
        async def send_text(self, text):
            received.append(text)

    room.spectators.add(FakeWS())
    await gl._tick()
    state = json.loads(received[0])
    assert state["type"] == "game_state"
    assert 0 < state["remaining_time"] <= 90.0


# --- round end logic -----------------------------------------------------

@pytest.mark.asyncio
async def test_round_ends_when_hp_zero():
    room = make_room()
    gl = GameLoop(room)
    gl.hp[1] = 0  # player 2 at 0 HP

    received = []

    class FakeWS:
        async def send_text(self, text):
            received.append(json.loads(text))

    room.spectators.add(FakeWS())
    await gl._tick()

    types = [m["type"] for m in received]
    assert "round_end" in types
    round_end = next(m for m in received if m["type"] == "round_end")
    assert round_end["winner"] == 1


@pytest.mark.asyncio
async def test_match_ends_after_single_round_win():
    room = make_room()
    gl = GameLoop(room)
    gl.hp[1] = 0
    await gl._tick()
    assert room.wins[0] == 1
    assert room.match_over is True
    assert gl.running is False

@pytest.mark.asyncio
async def test_existing_win_also_ends_after_next_round_win():
    room = make_room()
    gl = GameLoop(room)
    room.wins = [1, 0]  # player 1 already has 1 win

    gl.hp[1] = 0
    await gl._tick()

    assert room.wins[0] == 2
    assert room.match_over is True
    assert gl.running is False


@pytest.mark.asyncio
async def test_draw_round_no_wins_credited():
    room = make_room()
    gl = GameLoop(room)
    room.round_start_time = time.time() - 91  # force time expiry
    gl.hp = [50, 50]  # tied HP
    await gl._tick()
    assert room.wins == [0, 0]
    assert room.round_number == 2


@pytest.mark.asyncio
async def test_timeout_winner_determined_by_hp():
    room = make_room()
    gl = GameLoop(room)
    room.round_start_time = time.time() - 91
    gl.hp = [60, 40]  # player 1 has more HP
    await gl._tick()
    assert room.wins[0] == 1  # player 1 wins the round
    assert room.match_over is True


# --- calibration integration ---------------------------------------------

def test_calibration_start_sent_when_second_player_connects():
    from fastapi.testclient import TestClient
    from main import app

    with TestClient(app) as client:
        room_code = client.app.state.default_room
        with client.websocket_connect(f"/ws/player/{room_code}") as ws1:
            joined1 = json.loads(ws1.receive_text())
            assert joined1["type"] == "joined"
            with client.websocket_connect(f"/ws/player/{room_code}") as ws2:
                joined2 = json.loads(ws2.receive_text())
                assert joined2["type"] == "joined"
                calib2 = json.loads(ws2.receive_text())
                assert calib2["type"] == "calibration_start"
                calib1 = json.loads(ws1.receive_text())
                assert calib1["type"] == "calibration_start"


def test_game_loop_not_started_before_calibration():
    from fastapi.testclient import TestClient
    from main import app, room_manager

    with TestClient(app) as client:
        room_code = client.app.state.default_room
        r = room_manager.get_room(room_code)

        with client.websocket_connect(f"/ws/player/{room_code}") as ws1:
            ws1.receive_text()
            with client.websocket_connect(f"/ws/player/{room_code}") as ws2:
                ws2.receive_text()
                ws2.receive_text()
                ws1.receive_text()
                assert r.game_loop is None


def test_round1_start_broadcast_on_match_start():
    from fastapi.testclient import TestClient
    from main import app, room_manager

    with TestClient(app) as client:
        room_code = client.app.state.default_room
        r = room_manager.get_room(room_code)

        with client.websocket_connect(f"/ws/spectator/{room_code}") as spec:
            with client.websocket_connect(f"/ws/player/{room_code}") as ws1:
                ws1.receive_text()  # joined
                with client.websocket_connect(f"/ws/player/{room_code}") as ws2:
                    ws2.receive_text()  # joined
                    ws2.receive_text()  # calibration_start
                    ws1.receive_text()  # calibration_start
                    ws1.send_text(json.dumps({"type": "calibration_done", "reference_velocity": 3.0}))
                    ws1.send_text(json.dumps({"type": "ping", "t": 0.0}))
                    ws1.receive_text()  # pong
                    ws2.send_text(json.dumps({"type": "calibration_done", "reference_velocity": 3.0}))
                    ws2.receive_text()  # match_start
                    # Spectator should receive round_start for round 1
                    round_start = json.loads(spec.receive_text())
                    assert round_start["type"] == "round_start"
                    assert round_start["round_number"] == 1


def test_calibration_triggers_game_loop():
    from fastapi.testclient import TestClient
    from main import app, room_manager

    with TestClient(app) as client:
        room_code = client.app.state.default_room
        r = room_manager.get_room(room_code)

        with client.websocket_connect(f"/ws/player/{room_code}") as ws1:
            ws1.receive_text()
            with client.websocket_connect(f"/ws/player/{room_code}") as ws2:
                ws2.receive_text()
                ws2.receive_text()
                ws1.receive_text()
                # Piggyback a ping to confirm ws1 calibration was processed first
                ws1.send_text(json.dumps({"type": "calibration_done", "reference_velocity": 3.0}))
                ws1.send_text(json.dumps({"type": "ping", "t": 0.0}))
                ws1.receive_text()  # pong
                ws2.send_text(json.dumps({"type": "calibration_done", "reference_velocity": 3.0}))
                ws2.receive_text()  # match_start
                assert r.game_loop is not None
