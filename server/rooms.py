from __future__ import annotations
import random
import string
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

# Re-export for backwards compatibility — logic now lives in input_delay.py.
from input_delay import median_rtt, record_pong

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
    solo: bool = False
    bot_difficulty: str = "normal"

    # ------------------------------------------------------------------
    # Spectator membership helpers
    # ------------------------------------------------------------------

    def add_spectator(self, ws) -> None:
        self.spectators.add(ws)

    def remove_spectator(self, ws) -> None:
        self.spectators.discard(ws)

    # ------------------------------------------------------------------
    # Match lifecycle helpers
    # ------------------------------------------------------------------

    def reset_for_rematch(self) -> None:
        """Reset all match state for a rematch."""
        self.match_over = False
        self.round_number = 1
        self.wins = [0, 0]
        self.round_start_time = None
        for slot in self.players.values():
            slot.reference_velocity = None
        for timer in self.disconnect_timers.values():
            timer.cancel()
        self.disconnect_timers.clear()


class RoomManager:
    def __init__(self) -> None:
        self._rooms: dict[str, RoomState] = {}

    def create_room(self, max_wins: int = 2, solo: bool = False, bot_difficulty: str = "normal") -> str:
        while True:
            code = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
            if code not in self._rooms:
                break
        self._rooms[code] = RoomState(code=code, max_wins=max_wins, solo=solo, bot_difficulty=bot_difficulty)
        return code

    def get_room(self, code: str) -> RoomState | None:
        return self._rooms.get(code)

    def remove_room(self, code: str) -> None:
        self._rooms.pop(code, None)

    def list_rooms(self) -> list[str]:
        return list(self._rooms.keys())
