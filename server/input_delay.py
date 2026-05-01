from __future__ import annotations

import statistics
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from rooms import PlayerSlot, RoomState

_MAX_INPUT_DELAY_MS = 60  # cap so the low-latency player is never held back more than 60ms


def record_pong(slot: "PlayerSlot", original_t: float) -> float:
    """Record a completed RTT measurement on *slot*.

    Returns the measured RTT in milliseconds.
    """
    rtt = (time.time() - original_t) * 1000
    slot.rtt_samples.append(rtt)
    if len(slot.rtt_samples) > 10:
        slot.rtt_samples = slot.rtt_samples[-10:]
    return rtt


def median_rtt(slot: "PlayerSlot") -> float:
    """Return the median RTT for *slot* in milliseconds, or 0.0 if no samples."""
    if not slot.rtt_samples:
        return 0.0
    return statistics.median(slot.rtt_samples)


def compute_cutoff(room: "RoomState", max_delay_ms: float = _MAX_INPUT_DELAY_MS) -> tuple[float, float, float]:
    """Return ``(cutoff, rtt_a, rtt_b)`` for draining input buffers.

    Frames with an arrival timestamp older than *cutoff* are ready to be
    processed — they've waited long enough for the slower player's input to
    arrive.  ``rtt_a`` and ``rtt_b`` are the per-player medians (ms) so
    callers can reuse them for latency display without re-computing.
    """
    import time as _time
    now = _time.time()
    rtt_a = median_rtt(room.players[1])
    rtt_b = median_rtt(room.players[2])
    max_rtt_s = min(max(rtt_a, rtt_b), max_delay_ms) / 1000.0
    return now - max_rtt_s, rtt_a, rtt_b
