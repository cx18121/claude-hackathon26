from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from rooms import RoomState


async def broadcast_to_spectators(room: "RoomState", msg: str) -> None:
    """Send *msg* to every live spectator WebSocket on *room*.

    Dead connections are pruned from room.spectators in-place.
    """
    if not room.spectators:
        return
    dead: set = set()
    for ws in room.spectators:
        try:
            await ws.send_text(msg)
        except Exception:
            dead.add(ws)
    if dead:
        room.spectators -= dead
