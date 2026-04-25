"""Hit detection: synthetic poses that should and should not trigger hits.

Coordinates use real MediaPipe world-landmark convention:
  - Y axis is positive DOWNWARD (toward feet)
  - Head above hips → wrist.y < 0  (negative = above hip midpoint)
  - Ankles below hips → ankle.y > 0
"""
from __future__ import annotations
import os
os.environ.setdefault("TUNNEL", "false")

from collections import deque
from protocol import MsgPoseFrame, PoseKeypoint
from hit_detection import (
    detect_punch, detect_kick,
    WRIST_LEFT, ANKLE_LEFT, LEFT_HIP, RIGHT_HIP,
    LEFT_SHOULDER, RIGHT_SHOULDER,
    PUNCH_THRESHOLD, KICK_THRESHOLD, Region,
)


def kp(x=0.0, y=0.0, z=0.0) -> PoseKeypoint:
    return PoseKeypoint(x=x, y=y, z=z, visibility=1.0)


def make_frame(overrides: dict | None = None) -> MsgPoseFrame:
    pts = [kp()] * 33
    pts = list(pts)
    pts[LEFT_HIP]       = kp(x=-0.1)
    pts[RIGHT_HIP]      = kp(x= 0.1)
    # Shoulders 0.25 m above hips in MediaPipe Y-down (negative = up)
    pts[LEFT_SHOULDER]  = kp(x=-0.2, y=-0.25)
    pts[RIGHT_SHOULDER] = kp(x= 0.2, y=-0.25)
    if overrides:
        for idx, point in overrides.items():
            pts[idx] = point
    return MsgPoseFrame(type="pose_frame", timestamp=0.0, keypoints=pts)


def fast_punch_deque(end_x=0.0, end_y=-0.45) -> deque:
    """Wrist travels 2 m in 2 frames → ~30 m/s, well above PUNCH_THRESHOLD.

    Default end_y=-0.45 places the wrist 0.45 m above hips (head zone) in
    MediaPipe Y-down convention.
    """
    return deque([
        make_frame({WRIST_LEFT: kp(x=-2.0, y=end_y)}),
        make_frame({WRIST_LEFT: kp(x=-1.0, y=end_y)}),
        make_frame({WRIST_LEFT: kp(x=end_x, y=end_y)}),
    ])


def static_deque() -> deque:
    f = make_frame(None)
    return deque([f, f, f])


# --- punch -------------------------------------------------------------------

def test_punch_registers_in_head_zone():
    # wrist.y = -0.45 → 0.45 m above hips → HEAD zone
    result = detect_punch(fast_punch_deque(end_x=0.0, end_y=-0.45), static_deque())
    assert result is not None
    assert result.region == Region.HEAD_FACE
    assert result.velocity > PUNCH_THRESHOLD


def test_punch_registers_in_torso_zone():
    # wrist.y = -0.25 → 0.25 m above hips → TORSO_UPPER zone
    result = detect_punch(fast_punch_deque(end_x=0.0, end_y=-0.25), static_deque())
    assert result is not None
    assert result.region == Region.TORSO_UPPER


def test_punch_miss_wrist_below_hips():
    # wrist.y = +0.50 → 0.50 m BELOW hips → not an attack position
    result = detect_punch(fast_punch_deque(end_x=0.0, end_y=0.50), static_deque())
    assert result is None


def test_no_punch_below_velocity_threshold():
    slow = deque([
        make_frame({WRIST_LEFT: kp(x=0.00, y=-0.45)}),
        make_frame({WRIST_LEFT: kp(x=0.01, y=-0.45)}),
        make_frame({WRIST_LEFT: kp(x=0.02, y=-0.45)}),
    ])
    assert detect_punch(slow, static_deque()) is None


def test_punch_empty_deques_return_none():
    assert detect_punch(deque(), deque()) is None


def test_punch_velocity_above_threshold_on_hit():
    result = detect_punch(fast_punch_deque(end_x=0.0, end_y=-0.45), static_deque())
    assert result is not None
    assert result.velocity >= PUNCH_THRESHOLD


# --- kick --------------------------------------------------------------------

def test_kick_registers_raised_ankle():
    # Ankle sweeps upward: from below hips (y=+0.45) to raised position (y=-0.10)
    attacker = deque([
        make_frame({ANKLE_LEFT: kp(x=0.0, y= 0.45)}),
        make_frame({ANKLE_LEFT: kp(x=0.0, y= 0.15)}),
        make_frame({ANKLE_LEFT: kp(x=0.0, y=-0.10)}),  # raised above hips
    ])
    result = detect_kick(attacker, static_deque())
    assert result is not None
    assert result.velocity > KICK_THRESHOLD


def test_no_kick_ankle_not_raised():
    # Fast lateral ankle movement but ankle stays below hips → not a kick
    attacker = deque([
        make_frame({ANKLE_LEFT: kp(x=-2.0, y=0.45)}),
        make_frame({ANKLE_LEFT: kp(x=-1.0, y=0.45)}),
        make_frame({ANKLE_LEFT: kp(x= 0.0, y=0.45)}),
    ])
    assert detect_kick(attacker, static_deque()) is None


def test_kick_empty_deques_return_none():
    assert detect_kick(deque(), deque()) is None


def test_no_kick_slow_ankle():
    slow = deque([
        make_frame({ANKLE_LEFT: kp(x=0.0, y=-0.02)}),
        make_frame({ANKLE_LEFT: kp(x=0.0, y=-0.01)}),
        make_frame({ANKLE_LEFT: kp(x=0.0, y= 0.00)}),
    ])
    assert detect_kick(slow, static_deque()) is None
