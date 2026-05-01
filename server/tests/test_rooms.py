"""Room creation, slot filling, and disconnect handling."""
from __future__ import annotations
import os
os.environ.setdefault("TUNNEL", "false")

from rooms import RoomManager, PlayerSlot, median_rtt, record_pong
import time


def test_create_room_returns_six_char_code():
    rm = RoomManager()
    code = rm.create_room()
    assert len(code) == 6
    assert code.isalnum()


def test_created_room_is_retrievable():
    rm = RoomManager()
    code = rm.create_room()
    room = rm.get_room(code)
    assert room is not None
    assert room.code == code


def test_get_nonexistent_room_returns_none():
    rm = RoomManager()
    assert rm.get_room("ZZZZZZ") is None


def test_room_has_two_player_slots():
    rm = RoomManager()
    code = rm.create_room()
    room = rm.get_room(code)
    assert 1 in room.players
    assert 2 in room.players


def test_slots_start_disconnected():
    rm = RoomManager()
    code = rm.create_room()
    room = rm.get_room(code)
    assert not room.players[1].connected
    assert not room.players[2].connected


def test_fill_both_slots():
    rm = RoomManager()
    code = rm.create_room()
    room = rm.get_room(code)
    room.players[1].connected = True
    room.players[2].connected = True
    free = [n for n in (1, 2) if not room.players[n].connected]
    assert free == []


def test_disconnect_frees_slot():
    rm = RoomManager()
    code = rm.create_room()
    room = rm.get_room(code)
    room.players[1].connected = True
    room.players[1].connected = False
    room.players[1].ws = None
    assert not room.players[1].connected
    assert room.players[1].ws is None


def test_remove_room():
    rm = RoomManager()
    code = rm.create_room()
    rm.remove_room(code)
    assert rm.get_room(code) is None


def test_list_rooms_includes_created():
    rm = RoomManager()
    c1 = rm.create_room()
    c2 = rm.create_room()
    codes = rm.list_rooms()
    assert c1 in codes
    assert c2 in codes


def test_codes_are_unique():
    rm = RoomManager()
    codes = {rm.create_room() for _ in range(50)}
    assert len(codes) == 50


def test_disconnect_timer_dict_starts_empty():
    rm = RoomManager()
    code = rm.create_room()
    room = rm.get_room(code)
    assert room.disconnect_timers == {}


def test_rematch_reset_requires_fresh_calibration():
    rm = RoomManager()
    code = rm.create_room()
    room = rm.get_room(code)
    room.players[1].reference_velocity = 3.0
    room.players[2].reference_velocity = 3.5
    room.match_over = True
    room.round_number = 3
    room.wins = [1, 2]
    room.round_start_time = time.time()

    room.reset_for_rematch()

    assert room.match_over is False
    assert room.round_number == 1
    assert room.wins == [0, 0]
    assert room.round_start_time is None
    assert room.players[1].reference_velocity is None
    assert room.players[2].reference_velocity is None


def test_record_pong_stores_rtt():
    slot = PlayerSlot()
    t0 = time.time() - 0.05
    rtt = record_pong(slot, t0)
    assert 40 < rtt < 500
    assert len(slot.rtt_samples) == 1


def test_median_rtt_empty_is_zero():
    slot = PlayerSlot()
    assert median_rtt(slot) == 0.0


def test_median_rtt_correct():
    slot = PlayerSlot()
    slot.rtt_samples = [10.0, 30.0, 20.0]
    assert median_rtt(slot) == 20.0
