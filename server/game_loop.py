from __future__ import annotations
import asyncio
import logging
import time
from collections import deque

from damage import compute_damage
from hit_detection import detect_punch, detect_kick
from protocol import (
    HitEvent, MsgGameState, MsgMatchEnd, MsgRoundEnd, MsgRoundStart,
    MsgYouWereHit, PoseKeypoint,
)
from rooms import RoomState, median_rtt

log = logging.getLogger(__name__)

_EMPTY_POSES: list[PoseKeypoint] = []
_HIT_COOLDOWN_TICKS = 12  # ~200ms at 60Hz -- suppresses double-counting while allowing fast combos
_ROUND_DURATION = 90.0
_MAX_INPUT_DELAY_MS = 60  # cap so the low-latency player is never held back more than 60ms


class GameLoop:
    def __init__(self, room: RoomState) -> None:
        self.room = room
        self.tick = 0
        self.running = False
        self.hp: list[int] = [100, 100]

        # Input buffers: raw frames with arrival timestamps, awaiting delay release
        self._buffers: dict[int, deque[tuple[float, object]]] = {
            1: deque(maxlen=180),
            2: deque(maxlen=180),
        }
        # Last 10 released frames per player (~333ms at 30fps), fed to hit detection.
        # Wider window lets the sweep catch punches that span multiple frames and
        # gives _velocity a longer baseline when consecutive pairs are noisy.
        self._processed: dict[int, deque] = {
            1: deque(maxlen=10),
            2: deque(maxlen=10),
        }
        # Per-player cooldown: last tick a hit was registered as attacker
        self._last_hit_tick: dict[int, int] = {1: -999, 2: -999}

        self.paused = False

    def add_pose_frame(self, player_slot: int, frame: object) -> None:
        """Called from the WebSocket handler each time a pose_frame arrives."""
        self._buffers[player_slot].append((time.time(), frame))

    async def run(self) -> None:
        self.running = True
        await self._broadcast(MsgRoundStart(round_number=self.room.round_number).model_dump_json())
        target_dt = 1.0 / 60
        loop = asyncio.get_event_loop()
        while self.running:
            if self.paused:
                await asyncio.sleep(0.1)
                continue
            t0 = loop.time()
            await self._tick()
            elapsed = loop.time() - t0
            await asyncio.sleep(max(0.0, target_dt - elapsed))

    async def _broadcast(self, json_text: str) -> None:
        """Send to all spectators and both player websockets."""
        dead: set = set()
        for ws in self.room.spectators:
            try:
                await ws.send_text(json_text)
            except Exception:
                dead.add(ws)
        self.room.spectators -= dead
        for slot in self.room.players.values():
            if slot.ws is not None:
                try:
                    await slot.ws.send_text(json_text)
                except Exception:
                    pass

    async def _tick(self) -> None:
        self.tick += 1
        room = self.room

        if room.match_over:
            return

        now = time.time()
        if room.round_start_time is None:
            room.round_start_time = now

        remaining_time = max(0.0, _ROUND_DURATION - (now - room.round_start_time))

        # Input delay: both players are held back by the worse RTT so neither
        # has a latency advantage. Frames are only released once they are old
        # enough that the high-latency player's frame for the same moment has
        # also arrived.
        rtt_a = median_rtt(room.players[1])
        rtt_b = median_rtt(room.players[2])
        max_rtt_s = min(max(rtt_a, rtt_b), _MAX_INPUT_DELAY_MS) / 1000.0
        cutoff = now - max_rtt_s

        for slot in (1, 2):
            buf = self._buffers[slot]
            while buf and buf[0][0] <= cutoff:
                _, frame = buf.popleft()
                self._processed[slot].append(frame)

        recent_hits: list[HitEvent] = []

        for attacker, defender in ((1, 2), (2, 1)):
            a_frames = self._processed[attacker]
            d_frames = self._processed[defender]

            if not a_frames or not d_frames:
                continue
            if self.tick - self._last_hit_tick[attacker] < _HIT_COOLDOWN_TICKS:
                continue

            result = detect_punch(a_frames, d_frames) or detect_kick(a_frames, d_frames)
            if result is None:
                continue

            dmg = compute_damage(
                result.region,
                result.velocity,
                room.players[attacker].reference_velocity,
            )
            self.hp[defender - 1] = max(0, self.hp[defender - 1] - dmg)
            self._last_hit_tick[attacker] = self.tick

            log.info(
                "HIT player%d -> player%d | region=%s vel=%.1f dmg=%d hp=%s",
                attacker, defender, result.region, result.velocity, dmg, self.hp,
            )

            hit_event = HitEvent(
                player=attacker,
                region=result.region,
                damage=dmg,
                position={"x": result.position[0], "y": result.position[1], "z": result.position[2]},
            )
            recent_hits.append(hit_event)

            ws = room.players[defender].ws
            if ws is not None:
                try:
                    await ws.send_text(MsgYouWereHit(region=result.region, damage=dmg).model_dump_json())
                except Exception:
                    pass

        # Check round end conditions
        round_over = False
        round_winner: int | None = None

        if self.hp[0] <= 0:
            round_winner = 2
            round_over = True
        elif self.hp[1] <= 0:
            round_winner = 1
            round_over = True
        elif remaining_time <= 0:
            round_over = True
            if self.hp[0] > self.hp[1]:
                round_winner = 1
            elif self.hp[1] > self.hp[0]:
                round_winner = 2
            # else draw: round_winner stays None

        if round_over:
            await self._broadcast(
                MsgRoundEnd(winner=round_winner, final_hp=(self.hp[0], self.hp[1])).model_dump_json()
            )
            if round_winner is not None:
                room.wins[round_winner - 1] += 1
            if max(room.wins) >= 2:
                match_winner = 1 if room.wins[0] >= 2 else 2
                room.match_over = True
                await self._broadcast(MsgMatchEnd(winner=match_winner).model_dump_json())
                self.stop()
                return
            room.round_number += 1
            room.round_start_time = None
            self.hp = [100, 100]
            await self._broadcast(MsgRoundStart(round_number=room.round_number).model_dump_json())
            return

        state = MsgGameState(
            tick=self.tick,
            hp=(self.hp[0], self.hp[1]),
            poses=(
                list(self._processed[1][-1].keypoints) if self._processed[1] else _EMPTY_POSES,
                list(self._processed[2][-1].keypoints) if self._processed[2] else _EMPTY_POSES,
            ),
            recent_hits=recent_hits,
            high_latency=max(rtt_a, rtt_b) > 150,
            remaining_time=remaining_time,
        )

        state_json = state.model_dump_json()
        dead: set = set()
        for ws in self.room.spectators:
            try:
                await ws.send_text(state_json)
            except Exception:
                dead.add(ws)
        self.room.spectators -= dead

    def stop(self) -> None:
        self.running = False
