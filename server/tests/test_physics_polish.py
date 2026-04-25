"""Tests for the polished CV/physics pipeline.

Covers three fixes:
  1. _velocity() uses actual frame timestamps, not fixed 30fps
  2. _check_limb() sweeps all 3 frames so a punch that exits a hitbox is still caught
  3. compute_damage() gives midpoint damage at reference velocity (not base_min)
"""
from __future__ import annotations
import os
os.environ.setdefault("TUNNEL", "false")

from collections import deque

import numpy as np
import pytest

from protocol import MsgPoseFrame, PoseKeypoint
from hit_detection import (
    _velocity,
    detect_punch, detect_kick,
    WRIST_LEFT, ANKLE_LEFT, LEFT_HIP, RIGHT_HIP,
    LEFT_SHOULDER, RIGHT_SHOULDER,
    PUNCH_THRESHOLD, Region,
)
from damage import compute_damage, BASE_DAMAGE


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def kp(x=0.0, y=0.0, z=0.0, v=1.0) -> PoseKeypoint:
    return PoseKeypoint(x=x, y=y, z=z, visibility=v)


def frame(ts: float, overrides: dict | None = None) -> MsgPoseFrame:
    pts: list[PoseKeypoint] = [kp()] * 33
    pts = list(pts)
    pts[LEFT_HIP]       = kp(x=-0.1)
    pts[RIGHT_HIP]      = kp(x= 0.1)
    # Shoulders 0.25 m above hips in MediaPipe Y-down (negative = up)
    pts[LEFT_SHOULDER]  = kp(x=-0.2, y=-0.25)
    pts[RIGHT_SHOULDER] = kp(x= 0.2, y=-0.25)
    if overrides:
        for idx, point in overrides.items():
            pts[idx] = point
    return MsgPoseFrame(type="pose_frame", timestamp=ts, keypoints=pts)


def static_deque(ts: float = 0.0) -> deque:
    f = frame(ts)
    return deque([f, f, f])


# ---------------------------------------------------------------------------
# Fix 1: velocity uses actual timestamps
# ---------------------------------------------------------------------------

class TestTimestampVelocity:
    def test_nominal_30fps_when_timestamps_zero(self):
        """All-zero timestamps fall back to 2*_FRAME_DT = 1/15 s → 1m / (1/15) = 15 m/s."""
        poses = deque([
            frame(0.0, {WRIST_LEFT: kp(x=0.0)}),
            frame(0.0, {WRIST_LEFT: kp(x=0.5)}),
            frame(0.0, {WRIST_LEFT: kp(x=1.0)}),
        ])
        speed = float(np.linalg.norm(_velocity(poses, WRIST_LEFT)))
        assert abs(speed - 15.0) < 0.1

    def test_correct_speed_at_15fps(self):
        """1m displacement over 2 frames at 15fps → 1 / (2/15) = 7.5 m/s, not 15."""
        dt = 1.0 / 15
        poses = deque([
            frame(0.0,    {WRIST_LEFT: kp(x=0.0)}),
            frame(dt,     {WRIST_LEFT: kp(x=0.5)}),
            frame(2 * dt, {WRIST_LEFT: kp(x=1.0)}),
        ])
        speed = float(np.linalg.norm(_velocity(poses, WRIST_LEFT)))
        assert abs(speed - 7.5) < 0.1

    def test_correct_speed_at_60fps(self):
        """1m displacement over 2 frames at 60fps → 1 / (2/60) = 30 m/s."""
        dt = 1.0 / 60
        poses = deque([
            frame(0.0,    {WRIST_LEFT: kp(x=0.0)}),
            frame(dt,     {WRIST_LEFT: kp(x=0.5)}),
            frame(2 * dt, {WRIST_LEFT: kp(x=1.0)}),
        ])
        speed = float(np.linalg.norm(_velocity(poses, WRIST_LEFT)))
        assert abs(speed - 30.0) < 0.1

    def test_15fps_punch_threshold_not_triggered_by_slow_motion(self):
        """At 15fps a wrist moving 5cm/frame = 0.75 m/s -- below PUNCH_THRESHOLD."""
        dt = 1.0 / 15
        attacker = deque([
            frame(0.0,    {WRIST_LEFT: kp(x=0.00, y=-0.45)}),
            frame(dt,     {WRIST_LEFT: kp(x=0.05, y=-0.45)}),
            frame(2 * dt, {WRIST_LEFT: kp(x=0.10, y=-0.45)}),
        ])
        assert detect_punch(attacker, static_deque()) is None

    def test_15fps_fast_punch_still_registers(self):
        """At 15fps a wrist moving 30cm/frame = 4.5 m/s > PUNCH_THRESHOLD."""
        dt = 1.0 / 15
        attacker = deque([
            frame(0.0,    {WRIST_LEFT: kp(x=-0.60, y=-0.45)}),
            frame(dt,     {WRIST_LEFT: kp(x=-0.30, y=-0.45)}),
            frame(2 * dt, {WRIST_LEFT: kp(x= 0.00, y=-0.45)}),
        ])
        result = detect_punch(attacker, static_deque(2 * dt))
        assert result is not None
        assert result.region == Region.HEAD_FACE


# ---------------------------------------------------------------------------
# Fix 2: sweep catches punch that passes through and exits a hitbox
# ---------------------------------------------------------------------------

class TestHitboxSweep:
    def test_wrist_inside_hitbox_on_middle_frame_is_caught(self):
        """Wrist enters and exits head_face zone in one frame window."""
        attacker = deque([
            frame(0.0, {WRIST_LEFT: kp(x=-2.0, y=-0.45)}),  # approaching
            frame(0.0, {WRIST_LEFT: kp(x= 0.0, y=-0.45)}),  # inside head_face
            frame(0.0, {WRIST_LEFT: kp(x= 2.0, y=-0.45)}),  # exited -- final frame is a miss
        ])
        result = detect_punch(attacker, static_deque())
        assert result is not None, "sweep should catch hit on intermediate frame"
        assert result.region == Region.HEAD_FACE

    def test_wrist_only_in_hitbox_on_first_frame_is_caught(self):
        """Wrist starts inside torso zone and flies out."""
        attacker = deque([
            frame(0.0, {WRIST_LEFT: kp(x=0.0, y=-0.25)}),  # inside torso_upper
            frame(0.0, {WRIST_LEFT: kp(x=1.0, y=-0.25)}),  # exiting
            frame(0.0, {WRIST_LEFT: kp(x=2.0, y=-0.25)}),  # well outside
        ])
        result = detect_punch(attacker, static_deque())
        assert result is not None
        assert result.region == Region.TORSO_UPPER

    def test_miss_is_still_miss_when_all_frames_are_outside(self):
        """Ensure sweep doesn't create false positives for a genuine miss."""
        attacker = deque([
            frame(0.0, {WRIST_LEFT: kp(x=-5.0, y=5.0)}),
            frame(0.0, {WRIST_LEFT: kp(x=-3.0, y=5.0)}),
            frame(0.0, {WRIST_LEFT: kp(x=-1.0, y=5.0)}),
        ])
        assert detect_punch(attacker, static_deque()) is None

    def test_forward_extended_punch_registers(self):
        """Wrist at z=-0.22 (extended forward as in a real punch) must hit.

        The old code included z in the capsule distance; a 22 cm forward
        extension alone exceeded the old head radius (0.12 m) so every real
        punch missed. The fix zeroes z before the capsule check.
        """
        attacker = deque([
            frame(0.0, {WRIST_LEFT: kp(x=-0.60, y=-0.45, z= 0.05)}),
            frame(0.0, {WRIST_LEFT: kp(x=-0.30, y=-0.45, z=-0.10)}),
            frame(0.0, {WRIST_LEFT: kp(x= 0.00, y=-0.45, z=-0.22)}),  # at impact
        ])
        result = detect_punch(attacker, static_deque())
        assert result is not None, "forward-extended punch must register after z-projection fix"
        assert result.region == Region.HEAD_FACE

    def test_off_centre_jab_at_head_height_registers(self):
        """Left jab lands 18 cm off centre -- within the wider head radius (0.22 m)."""
        attacker = deque([
            frame(0.0, {WRIST_LEFT: kp(x=-0.40, y=-0.45)}),
            frame(0.0, {WRIST_LEFT: kp(x=-0.05, y=-0.45)}),
            frame(0.0, {WRIST_LEFT: kp(x= 0.18, y=-0.45)}),  # 18 cm off centre
        ])
        result = detect_punch(attacker, static_deque())
        assert result is not None, "off-centre jab at head height must register"
        assert result.region == Region.HEAD_FACE

    def test_snap_punch_with_retraction_registers(self):
        """Quick snap punch: wrist extends then retracts within the 3-frame window.

        Central difference (frame[-3] to frame[-1]) underreports speed because
        the return motion partially cancels the outward motion.  _peak_speed over
        consecutive pairs must still detect the punch.
        """
        dt = 1.0 / 30
        attacker = deque([
            frame(0.0,      {WRIST_LEFT: kp(x=-0.30, y=-0.45)}),  # pre-punch
            frame(dt,       {WRIST_LEFT: kp(x= 0.00, y=-0.45)}),  # impact (fast outward)
            frame(2 * dt,   {WRIST_LEFT: kp(x=-0.20, y=-0.45)}),  # retraction (hand pulls back)
        ])
        result = detect_punch(attacker, static_deque())
        assert result is not None, "snap punch with retraction must register via peak speed"
        assert result.region == Region.HEAD_FACE


# ---------------------------------------------------------------------------
# Fix 3: damage formula gives midpoint at reference velocity
# ---------------------------------------------------------------------------

class TestDamageFormula:
    @pytest.mark.parametrize("region", list(BASE_DAMAGE))
    def test_reference_velocity_gives_midpoint(self, region: str):
        lo, hi = BASE_DAMAGE[region]
        mid = (lo + hi) / 2
        d = compute_damage(region, 3.0, 3.0)
        # Should be within 1 of the true midpoint (rounding allowed)
        assert abs(d - mid) <= 1, f"{region}: expected ~{mid}, got {d}"

    @pytest.mark.parametrize("region", list(BASE_DAMAGE))
    def test_zero_velocity_gives_minimum(self, region: str):
        lo, _ = BASE_DAMAGE[region]
        assert compute_damage(region, 0.0, 3.0) == lo

    @pytest.mark.parametrize("region", list(BASE_DAMAGE))
    def test_double_reference_gives_maximum(self, region: str):
        _, hi = BASE_DAMAGE[region]
        assert compute_damage(region, 6.0, 3.0) == hi

    def test_faster_than_double_ref_caps_at_max(self):
        _, hi = BASE_DAMAGE["head_face"]
        assert compute_damage("head_face", 999.0, 3.0) == hi

    def test_monotone_increasing(self):
        """Faster punches always do at least as much damage."""
        ref = 3.0
        prev = 0
        for v in [0.0, 0.5, 1.0, 2.0, 3.0, 4.0, 6.0, 10.0]:
            d = compute_damage("torso_upper", v, ref)
            assert d >= prev, f"damage not monotone at v={v}"
            prev = d
