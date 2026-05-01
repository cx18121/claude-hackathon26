from __future__ import annotations
import asyncio
import logging
import time
from collections import deque

from commentator import CommentaryEngine
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
# The overlay shows a 3-2-1-FIGHT! countdown at the start of every round
# (RoundOverlay.tsx, ~3800ms total). Hits landed during that window
# shouldn't count, so the server gates hit detection until this many
# seconds have elapsed since the round_start broadcast.
_ROUND_WARMUP = 3.8


class GameLoop:
    def __init__(self, room: RoomState) -> None:
        self.room = room
        self.tick = 0
        self.running = False
        self.hp: list[int] = [800, 800]

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

        # Live commentator. Reuses _broadcast as its sink so commentary text
        # and audio land on the same WS as game_state.
        self.commentator = CommentaryEngine(self._broadcast)
        # First-blood detector: True until the first hit lands.
        self._first_blood_pending = True
        # Combo tracker: per-attacker (last_hit_time, count_within_window).
        self._combo: dict[int, tuple[float, int]] = {1: (0.0, 0), 2: (0.0, 0)}
        # Low-HP one-shot per round so we don't spam.
        self._low_hp_announced: set[int] = set()
        # Stalemate watcher: time of last hit (or round start).
        self._last_action_time: float = 0.0
        self._stalemate_announced: bool = False
        # Wall-clock time at which hit detection becomes live for the
        # current round. While now < _round_live_at, hits are ignored —
        # this matches the client-side 3-2-1-FIGHT countdown so a fighter
        # winding up during the countdown can't land a damaging hit at
        # tick 0. Set in run() and reset on every round transition.
        self._round_live_at: float = 0.0

    def add_pose_frame(self, player_slot: int, frame: object) -> None:
        """Called from the WebSocket handler each time a pose_frame arrives."""
        self._buffers[player_slot].append((time.time(), frame))

    async def run(self) -> None:
        self.running = True
        self.commentator.start()
        now = time.time()
        self._last_action_time = now
        self._round_live_at = now + _ROUND_WARMUP
        await self._broadcast(MsgRoundStart(round_number=self.room.round_number).model_dump_json())
        self.commentator.event(
            "round_start",
            {"round": self.room.round_number, "wins": tuple(self.room.wins)},
        )
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

        # Warmup window: while the overlay is showing 3-2-1-FIGHT, suppress
        # hit detection entirely. Drain pose buffers each tick so any swing
        # the players throw during the countdown can't seed a velocity
        # baseline that pops the moment hit detection comes online.
        if now < self._round_live_at:
            for buf in self._buffers.values():
                buf.clear()
            for buf in self._processed.values():
                buf.clear()
            # Pin round timer to "full duration" while the countdown is up.
            room.round_start_time = self._round_live_at
            rtt_a = median_rtt(room.players[1])
            rtt_b = median_rtt(room.players[2])
            state = MsgGameState(
                tick=self.tick,
                hp=(self.hp[0], self.hp[1]),
                poses=(_EMPTY_POSES, _EMPTY_POSES),
                recent_hits=[],
                high_latency=max(rtt_a, rtt_b) > 150,
                remaining_time=_ROUND_DURATION,
            )
            state_json = state.model_dump_json()
            dead: set = set()
            for ws in self.room.spectators:
                try:
                    await ws.send_text(state_json)
                except Exception:
                    dead.add(ws)
            self.room.spectators -= dead
            return

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

            ref_vel = room.players[attacker].reference_velocity
            result = detect_punch(a_frames, d_frames, ref_vel) or detect_kick(a_frames, d_frames, ref_vel)
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

            self._emit_hit_commentary(attacker, defender, result.region, dmg, now)

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
            ko = round_winner is not None and (self.hp[0] == 0 or self.hp[1] == 0)
            self.commentator.event(
                "ko" if ko else "round_end",
                {
                    "winner": round_winner,
                    "final_hp": [self.hp[0], self.hp[1]],
                    "round": self.room.round_number,
                    "by_timeout": not ko and remaining_time <= 0,
                },
            )
            await self._broadcast(
                MsgRoundEnd(winner=round_winner, final_hp=(self.hp[0], self.hp[1])).model_dump_json()
            )
            if round_winner is not None:
                room.wins[round_winner - 1] += 1
            if max(room.wins) >= 2:
                match_winner = 1 if room.wins[0] >= 1 else 2
                room.match_over = True
                self.commentator.event(
                    "match_end",
                    {"winner": match_winner, "score": list(room.wins)},
                )
                await self._broadcast(MsgMatchEnd(winner=match_winner).model_dump_json())
                self.stop()
                return
            room.round_number += 1
            room.round_start_time = None
            self.hp = [800, 800]
            self._first_blood_pending = True
            self._combo = {1: (0.0, 0), 2: (0.0, 0)}
            self._low_hp_announced.clear()
            self._stalemate_announced = False
            now_t = time.time()
            self._last_action_time = now_t
            # Re-arm the warmup so the next round's countdown also gates
            # hit detection.
            self._round_live_at = now_t + _ROUND_WARMUP
            self.commentator.event(
                "round_start",
                {"round": room.round_number, "wins": tuple(room.wins)},
            )
            await self._broadcast(MsgRoundStart(round_number=room.round_number).model_dump_json())
            return

        # Stalemate watch: 8s without a hit -> commentator filler.
        if (
            not self._stalemate_announced
            and now - self._last_action_time > 8.0
            and remaining_time > 5.0
        ):
            self._stalemate_announced = True
            self.commentator.event(
                "stalemate",
                {"hp": [self.hp[0], self.hp[1]], "remaining": int(remaining_time)},
            )

        # Pose data is no longer carried on the 60Hz game_state channel — it
        # streams to spectators on a separate `pose_update` message that fires
        # the moment a frame arrives from a mobile client (see ws_player in
        # main.py). Sending it here as well would just double the bandwidth
        # and add up to one tick of staleness, so we ship empty pose arrays.
        state = MsgGameState(
            tick=self.tick,
            hp=(self.hp[0], self.hp[1]),
            poses=(_EMPTY_POSES, _EMPTY_POSES),
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
        if self.commentator.enabled:
            asyncio.create_task(self.commentator.stop())

    def _emit_hit_commentary(
        self,
        attacker: int,
        defender: int,
        region: str,
        damage: int,
        now: float,
    ) -> None:
        """Translate one hit into the most narratively-interesting event
        kind we can. The commentator's own cooldown decides whether to
        actually speak — we just describe what happened."""
        self._last_action_time = now
        self._stalemate_announced = False

        # Combo tracking: same attacker, second-or-later hit within 1.8s.
        last_t, count = self._combo[attacker]
        if now - last_t <= 1.8:
            count += 1
        else:
            count = 1
        self._combo[attacker] = (now, count)
        # Reset opponent's combo on getting hit.
        self._combo[defender] = (0.0, 0)

        defender_hp = self.hp[defender - 1]
        defender_hp_pct = defender_hp / 800.0
        attacker_hp_pct = self.hp[attacker - 1] / 800.0

        kind = "hit"
        priority = False
        # First hit of the match wins out over everything else.
        if self._first_blood_pending:
            kind = "first_blood"
            priority = True
            self._first_blood_pending = False
        elif count >= 3:
            kind = "combo"
            priority = True
        elif (
            attacker_hp_pct < 0.3
            and defender_hp_pct >= attacker_hp_pct
        ):
            kind = "comeback"
            priority = True
        elif defender_hp_pct <= 0.25 and defender not in self._low_hp_announced:
            kind = "low_hp"
            priority = True
            self._low_hp_announced.add(defender)

        payload = {
            "attacker": attacker,
            "defender": defender,
            "region": region,
            "damage": damage,
            "attacker_hp": self.hp[attacker - 1],
            "defender_hp": defender_hp,
            "combo_count": count if kind == "combo" else 0,
            "round": self.room.round_number,
        }
        # Build the synthetic event with priority flag.
        if priority:
            self.commentator.event(kind, payload)
        else:
            # Plain hit — let the engine cooldown decide.
            self.commentator.event(kind, payload)
