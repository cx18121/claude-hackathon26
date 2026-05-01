from __future__ import annotations
import random
import statistics
import string
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import WebSocket
    from protocol import MsgPoseFrame


@dataclass
class PlayerSlot:
    ws: "WebSocket | None" = None
    latest_pose: "MsgPoseFrame | None" = None
    reference_velocity: float | None = None
    connected: bool = False
    rtt_ms: float = 0.0
    ping_times: list[float] = field(default_factory=list)
    rtt_samples: list[float] = field(default_factory=list)


def median_rtt(slot: PlayerSlot) -> float:
    if not slot.rtt_samples:
        return 0.0
    return statistics.median(slot.rtt_samples)


def record_pong(slot: PlayerSlot, original_t: float) -> float:
    rtt = (time.time() - original_t) * 1000
    slot.rtt_samples.append(rtt)
    if len(slot.rtt_samples) > 10:
        slot.rtt_samples = slot.rtt_samples[-10:]
    return rtt


@dataclass
class RoomState:
    code: str
    players: dict[int, PlayerSlot] = field(default_factory=lambda: {1: PlayerSlot(), 2: PlayerSlot()})
    created_at: float = field(default_factory=time.time)
    spectators: set = field(default_factory=set)
    game_loop: object = field(default=None)  # GameLoop | None, typed as object to avoid circular import
    round_number: int = 1
    wins: list[int] = field(default_factory=lambda: [0, 0])
    round_start_time: float | None = None
    match_over: bool = False
    disconnect_timers: dict = field(default_factory=dict)  # slot_num -> asyncio.Task
    max_wins: int = 2  # 1=BO1, 2=BO3, 3=BO5


class RoomManager:
    def __init__(self) -> None:
        self._rooms: dict[str, RoomState] = {}

    def create_room(self, max_wins: int = 2) -> str:
        while True:
            code = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
            if code not in self._rooms:
                break
        self._rooms[code] = RoomState(code=code, max_wins=max_wins)
        return code

    def get_room(self, code: str) -> RoomState | None:
        return self._rooms.get(code)

    def remove_room(self, code: str) -> None:
        self._rooms.pop(code, None)

    def list_rooms(self) -> list[str]:
        return list(self._rooms.keys())
