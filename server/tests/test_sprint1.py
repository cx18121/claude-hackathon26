"""Sprint 1 integration tests: rooms, protocol, HTTP endpoints, WebSocket echo."""
from __future__ import annotations
import json
import os
import pytest

os.environ.setdefault("TUNNEL", "false")


def make_client():
    from fastapi.testclient import TestClient
    from main import app
    return TestClient(app)


# --- rooms ---

def test_create_room_returns_six_char_code():
    from rooms import RoomManager
    rm = RoomManager()
    code = rm.create_room()
    assert len(code) == 6
    assert code.isalnum()


def test_get_room_returns_none_for_unknown():
    from rooms import RoomManager
    rm = RoomManager()
    assert rm.get_room("ZZZZZZ") is None


def test_remove_room():
    from rooms import RoomManager
    rm = RoomManager()
    code = rm.create_room()
    rm.remove_room(code)
    assert rm.get_room(code) is None


def test_two_slots_initialized():
    from rooms import RoomManager
    rm = RoomManager()
    code = rm.create_room()
    room = rm.get_room(code)
    assert 1 in room.players
    assert 2 in room.players
    assert not room.players[1].connected
    assert not room.players[2].connected


# --- protocol ---

def test_parse_join():
    from protocol import parse_mobile_msg, MsgJoin
    msg = parse_mobile_msg({"type": "join", "room_code": "ABC123", "player_slot": 1})
    assert isinstance(msg, MsgJoin)
    assert msg.room_code == "ABC123"


def test_parse_pose_frame_keypoint_count():
    from protocol import parse_mobile_msg, MsgPoseFrame
    kps = [{"x": 0.0, "y": 0.0, "z": 0.0, "visibility": 1.0}] * 33
    msg = parse_mobile_msg({"type": "pose_frame", "timestamp": 1.0, "keypoints": kps})
    assert isinstance(msg, MsgPoseFrame)
    assert len(msg.keypoints) == 33


def test_parse_pose_frame_rejects_wrong_keypoint_count():
    from protocol import parse_mobile_msg
    kps = [{"x": 0.0, "y": 0.0, "z": 0.0, "visibility": 1.0}] * 32
    with pytest.raises(Exception):
        parse_mobile_msg({"type": "pose_frame", "timestamp": 1.0, "keypoints": kps})


def test_parse_ping():
    from protocol import parse_mobile_msg, MsgPing
    msg = parse_mobile_msg({"type": "ping", "t": 999.0})
    assert isinstance(msg, MsgPing)
    assert msg.t == 999.0


def test_parse_unknown_type_raises():
    from protocol import parse_mobile_msg
    with pytest.raises(Exception):
        parse_mobile_msg({"type": "unknown_msg"})


def test_msg_joined_serializes():
    from protocol import MsgJoined
    m = MsgJoined(room_code="XYZ789", player_slot=2, opponent_connected=True)
    data = json.loads(m.model_dump_json())
    assert data["type"] == "joined"
    assert data["player_slot"] == 2
    assert data["opponent_connected"] is True


# --- HTTP endpoints ---

def test_landing_returns_html():
    with make_client() as client:
        r = client.get("/")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/html")
        assert "SPECTRE" in r.text


def test_create_room_endpoint():
    with make_client() as client:
        r = client.post("/rooms")
        assert r.status_code == 200
        data = r.json()
        assert "code" in data
        assert len(data["code"]) == 6


# --- WebSocket ---

def test_ws_player_join_and_ping():
    with make_client() as client:
        default_room = client.app.state.default_room

        with client.websocket_connect(f"/ws/player/{default_room}") as ws:
            msg = json.loads(ws.receive_text())
            assert msg["type"] == "joined"
            assert msg["player_slot"] in (1, 2)
            assert msg["room_code"] == default_room

            # Client-originated ping should be echoed as pong
            ws.send_text(json.dumps({"type": "ping", "t": 42.0}))
            pong = None
            for _ in range(3):
                candidate = json.loads(ws.receive_text())
                if candidate["type"] == "pong":
                    pong = candidate
                    break
            assert pong is not None
            assert pong["type"] == "pong"
            assert pong["t"] == 42.0


def test_ws_player_honors_requested_slot():
    with make_client() as client:
        default_room = client.app.state.default_room

        with client.websocket_connect(f"/ws/player/{default_room}?slot=2") as ws:
            msg = json.loads(ws.receive_text())
            assert msg["type"] == "joined"
            assert msg["player_slot"] == 2


def test_ws_player_rejects_occupied_requested_slot():
    with make_client() as client:
        default_room = client.app.state.default_room

        with client.websocket_connect(f"/ws/player/{default_room}?slot=1") as ws1:
            ws1.receive_text()
            with client.websocket_connect(f"/ws/player/{default_room}?slot=1") as ws2:
                with pytest.raises(Exception):
                    ws2.receive_text()


def test_ws_player_room_not_found():
    with make_client() as client:
        with client.websocket_connect("/ws/player/NOTEXIST") as ws:
            with pytest.raises(Exception):
                ws.receive_text()


def test_ws_spectator_connect():
    with make_client() as client:
        default_room = client.app.state.default_room
        with client.websocket_connect(f"/ws/spectator/{default_room}") as ws:
            # Just confirm connection accepted -- no message expected
            pass


def test_ws_player_bad_message_does_not_crash():
    with make_client() as client:
        default_room = client.app.state.default_room
        with client.websocket_connect(f"/ws/player/{default_room}") as ws:
            ws.receive_text()  # consume joined
            ws.send_text("not valid json {{{{")
            # Send a valid ping after the bad message -- connection should still be alive
            ws.send_text(json.dumps({"type": "ping", "t": 1.0}))
            pong = None
            for _ in range(3):
                candidate = json.loads(ws.receive_text())
                if candidate["type"] == "pong":
                    pong = candidate
                    break
            assert pong is not None
            assert pong["type"] == "pong"
