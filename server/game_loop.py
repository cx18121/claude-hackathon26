from __future__ import annotations
import asyncio
import logging
import random
import time
from collections import deque

from broadcast import broadcast_to_spectators
from commentator import BroadcastFn, CommentaryEngine
from damage import compute_damage
from hit_detection import detect_punch, detect_kick
from input_delay import compute_cutoff, median_rtt
from protocol import (
    HitEvent, MsgGameState, MsgMatchEnd, MsgPoseFrame, MsgRoundEnd, MsgRoundStart,
    MsgYouWereHit, PoseKeypoint, Position,
)
from rooms import RoomState

log = logging.getLogger(__name__)

_EMPTY_POSES: list[PoseKeypoint] = []
_HIT_COOLDOWN_TICKS = 12  # ~200ms at 60Hz -- suppresses double-counting while allowing fast combos
_ROUND_DURATION = 90.0
# The overlay shows a 3-2-1-FIGHT! countdown at the start of every round
# (RoundOverlay.tsx, ~3800ms total). Hits landed during that window
# shouldn't count, so the server gates hit detection until this many
# seconds have elapsed since the round_start broadcast.
_ROUND_WARMUP = 3.8

# Bot (solo mode) configuration
_BOT_INTERVALS: dict[str, tuple[float, float]] = {
    "easy":   (4.5, 7.0),
    "normal": (2.5, 4.5),
    "hard":   (1.0, 2.5),
}
_BOT_DAMAGES: dict[str, tuple[int, int]] = {
    "easy":   (15, 35),
    "normal": (30, 55),
    "hard":   (50, 80),
}
_BOT_REGIONS = [
    "torso_lower", "torso_lower", "torso_upper",
    "torso_upper", "head_face", "torso_lower",
]

# Static neutral standing pose for the bot (33 MediaPipe landmarks).
# Wrists are at hip level so no guard zones are active.
# Hip y=0.60, shoulder y=0.30 → body_scale=0.30 (realistic adult torso).
_BOT_KPS: list[PoseKeypoint] = [
    PoseKeypoint(x=0.50, y=0.10, z=0.0, visibility=1.0),  # 0  nose
    PoseKeypoint(x=0.52, y=0.08, z=0.0, visibility=1.0),  # 1  left_eye_inner
    PoseKeypoint(x=0.53, y=0.08, z=0.0, visibility=1.0),  # 2  left_eye
    PoseKeypoint(x=0.55, y=0.08, z=0.0, visibility=1.0),  # 3  left_eye_outer
    PoseKeypoint(x=0.48, y=0.08, z=0.0, visibility=1.0),  # 4  right_eye_inner
    PoseKeypoint(x=0.47, y=0.08, z=0.0, visibility=1.0),  # 5  right_eye
    PoseKeypoint(x=0.45, y=0.08, z=0.0, visibility=1.0),  # 6  right_eye_outer
    PoseKeypoint(x=0.57, y=0.12, z=0.0, visibility=1.0),  # 7  left_ear
    PoseKeypoint(x=0.43, y=0.12, z=0.0, visibility=1.0),  # 8  right_ear
    PoseKeypoint(x=0.52, y=0.15, z=0.0, visibility=1.0),  # 9  mouth_left
    PoseKeypoint(x=0.48, y=0.15, z=0.0, visibility=1.0),  # 10 mouth_right
    PoseKeypoint(x=0.62, y=0.30, z=0.0, visibility=1.0),  # 11 left_shoulder
    PoseKeypoint(x=0.38, y=0.30, z=0.0, visibility=1.0),  # 12 right_shoulder
    PoseKeypoint(x=0.65, y=0.46, z=0.0, visibility=1.0),  # 13 left_elbow
    PoseKeypoint(x=0.35, y=0.46, z=0.0, visibility=1.0),  # 14 right_elbow
    PoseKeypoint(x=0.67, y=0.62, z=0.0, visibility=1.0),  # 15 left_wrist  (hip level = no guard)
    PoseKeypoint(x=0.33, y=0.62, z=0.0, visibility=1.0),  # 16 right_wrist (hip level = no guard)
    PoseKeypoint(x=0.67, y=0.64, z=0.0, visibility=1.0),  # 17 left_pinky
    PoseKeypoint(x=0.33, y=0.64, z=0.0, visibility=1.0),  # 18 right_pinky
    PoseKeypoint(x=0.68, y=0.63, z=0.0, visibility=1.0),  # 19 left_index
    PoseKeypoint(x=0.32, y=0.63, z=0.0, visibility=1.0),  # 20 right_index
    PoseKeypoint(x=0.67, y=0.63, z=0.0, visibility=1.0),  # 21 left_thumb
    PoseKeypoint(x=0.33, y=0.63, z=0.0, visibility=1.0),  # 22 right_thumb
    PoseKeypoint(x=0.59, y=0.60, z=0.0, visibility=1.0),  # 23 left_hip
    PoseKeypoint(x=0.41, y=0.60, z=0.0, visibility=1.0),  # 24 right_hip
    PoseKeypoint(x=0.60, y=0.75, z=0.0, visibility=1.0),  # 25 left_knee
    PoseKeypoint(x=0.40, y=0.75, z=0.0, visibility=1.0),  # 26 right_knee
    PoseKeypoint(x=0.60, y=0.90, z=0.0, visibility=1.0),  # 27 left_ankle
    PoseKeypoint(x=0.40, y=0.90, z=0.0, visibility=1.0),  # 28 right_ankle
    PoseKeypoint(x=0.60, y=0.93, z=0.0, visibility=1.0),  # 29 left_heel
    PoseKeypoint(x=0.40, y=0.93, z=0.0, visibility=1.0),  # 30 right_heel
    PoseKeypoint(x=0.61, y=0.95, z=0.0, visibility=1.0),  # 31 left_foot_index
    PoseKeypoint(x=0.39, y=0.95, z=0.0, visibility=1.0),  # 32 right_foot_index
]


class GameLoop:
    def __init__(
        self,
        room: RoomState,
        commentary_broadcast: BroadcastFn | None = None,
    ) -> None:
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

        # Bot hit scheduling (solo mode only)
        self._bot_next_hit_at: float = 0.0

        # Commentary output sink: defaults to the game broadcast channel so
        # existing behaviour is preserved.  Callers may inject a different sink
        # (e.g. a separate WebSocket channel, or a no-op for tests) via
        # ``commentary_broadcast``.
        _commentary_sink: BroadcastFn = commentary_broadcast if commentary_broadcast is not None else self._broadcast
        self.commentator = CommentaryEngine(_commentary_sink)
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
        if self.room.solo:
            lo, hi = _BOT_INTERVALS.get(self.room.bot_difficulty, (2.5, 4.5))
            self._bot_next_hit_at = now + _ROUND_WARMUP + random.uniform(lo, hi)
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
        await broadcast_to_spectators(self.room, json_text)
        for slot in self.room.players.values():
            if slot.ws is not None:
                try:
                    await slot.ws.send_text(json_text)
                except Exception:
                    pass

    async def _process_attacker(
        self, attacker: int, defender: int, now: float
    ) -> list[HitEvent]:
        """Drain the input buffer for *attacker*, run hit detection against *defender*.

        Returns a (possibly empty) list of new HitEvents.  Sends a
        ``you_were_hit`` message directly to the defender's WebSocket.
        """
        room = self.room
        a_frames = self._processed[attacker]
        d_frames = self._processed[defender]

        if not a_frames or not d_frames:
            return []
        if self.tick - self._last_hit_tick[attacker] < _HIT_COOLDOWN_TICKS:
            return []

        ref_vel = room.players[attacker].reference_velocity
        result = detect_punch(a_frames, d_frames, ref_vel) or detect_kick(a_frames, d_frames, ref_vel)
        if result is None:
            return []

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
            position=Position(x=result.position[0], y=result.position[1], z=result.position[2]),
        )

        self._emit_hit_commentary(attacker, defender, result.region, dmg, now)

        ws = room.players[defender].ws
        if ws is not None:
            try:
                await ws.send_text(MsgYouWereHit(region=result.region, damage=dmg).model_dump_json())
            except Exception:
                pass

        return [hit_event]

    async def _tick_bot(self, now: float) -> HitEvent | None:
        """Return a bot HitEvent if it's time for the bot to strike, else None.

        Also notifies P1's WebSocket and logs the bot action.
        """
        if not (self.room.solo and now >= self._bot_next_hit_at):
            return None

        room = self.room
        lo, hi = _BOT_INTERVALS.get(room.bot_difficulty, (2.5, 4.5))
        self._bot_next_hit_at = now + random.uniform(lo, hi)
        dmg_lo, dmg_hi = _BOT_DAMAGES.get(room.bot_difficulty, (30, 55))
        bot_dmg = random.randint(dmg_lo, dmg_hi)
        bot_region = random.choice(_BOT_REGIONS)
        self.hp[0] = max(0, self.hp[0] - bot_dmg)
        log.info("BOT hits player1 | region=%s dmg=%d hp=%s", bot_region, bot_dmg, self.hp)
        p1_ws = room.players[1].ws
        if p1_ws is not None:
            try:
                await p1_ws.send_text(MsgYouWereHit(region=bot_region, damage=bot_dmg).model_dump_json())
            except Exception:
                pass
        return HitEvent(
            player=2, region=bot_region, damage=bot_dmg,
            position=Position(x=0.5, y=0.4, z=0.0),
        )

    def _check_round_over(self, remaining_time: float) -> tuple[bool, int | None]:
        """Return ``(is_over, winner_slot_or_None)`` given current HP and time.

        *winner* is ``None`` for a draw (time expired with equal HP).
        """
        if self.hp[0] <= 0:
            return True, 2
        if self.hp[1] <= 0:
            return True, 1
        if remaining_time <= 0:
            if self.hp[0] > self.hp[1]:
                return True, 1
            if self.hp[1] > self.hp[0]:
                return True, 2
            return True, None  # draw
        return False, None

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
            _, rtt_a, rtt_b = compute_cutoff(room)
            state = MsgGameState(
                tick=self.tick,
                hp=(self.hp[0], self.hp[1]),
                poses=(_EMPTY_POSES, _EMPTY_POSES),
                recent_hits=[],
                high_latency=max(rtt_a, rtt_b) > 150,
                remaining_time=_ROUND_DURATION,
                max_wins=room.max_wins,
            )
            await broadcast_to_spectators(self.room, state.model_dump_json())
            return

        if room.round_start_time is None:
            room.round_start_time = now

        remaining_time = max(0.0, _ROUND_DURATION - (now - room.round_start_time))

        # Drain input buffers up to the fairness cutoff, then inject bot pose.
        cutoff, rtt_a, rtt_b = compute_cutoff(room)
        for slot in (1, 2):
            buf = self._buffers[slot]
            while buf and buf[0][0] <= cutoff:
                _, frame = buf.popleft()
                self._processed[slot].append(frame)

        # Solo mode: inject a static bot pose into P2's processed buffer so
        # detect_punch/kick can run against a valid defender each tick.
        if self.room.solo:
            self._processed[2].append(
                MsgPoseFrame(type="pose_frame", timestamp=now, keypoints=_BOT_KPS)
            )

        # Process hits for both attack directions, then bot scripted hit.
        recent_hits: list[HitEvent] = []
        for attacker, defender in ((1, 2), (2, 1)):
            recent_hits.extend(await self._process_attacker(attacker, defender, now))
        bot_hit = await self._tick_bot(now)
        if bot_hit is not None:
            recent_hits.append(bot_hit)

        # Check round-end conditions.
        round_over, round_winner = self._check_round_over(remaining_time)
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
            if max(room.wins) >= room.max_wins:
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
            # Re-arm the warmup so the next round's countdown also gates hit detection.
            self._round_live_at = now_t + _ROUND_WARMUP
            if self.room.solo:
                lo, hi = _BOT_INTERVALS.get(self.room.bot_difficulty, (2.5, 4.5))
                self._bot_next_hit_at = now_t + _ROUND_WARMUP + random.uniform(lo, hi)
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

        # Pose data streams via separate `pose_update` messages (see ws_player
        # in main.py); ship empty arrays here to save bandwidth.
        state = MsgGameState(
            tick=self.tick,
            hp=(self.hp[0], self.hp[1]),
            poses=(_EMPTY_POSES, _EMPTY_POSES),
            recent_hits=recent_hits,
            high_latency=max(rtt_a, rtt_b) > 150,
            remaining_time=remaining_time,
            max_wins=room.max_wins,
        )
        await broadcast_to_spectators(self.room, state.model_dump_json())

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
