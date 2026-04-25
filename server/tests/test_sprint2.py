"""Sprint 2 tests: pose math, hit detection, damage formula, RTT helpers."""
from __future__ import annotations
import os
import time
from collections import deque

import numpy as np
import pytest

os.environ.setdefault("TUNNEL", "false")

from protocol import MsgPoseFrame, PoseKeypoint
from pose import moving_average_velocity, interpolate_poses, WRIST_LEFT, LEFT_HIP, RIGHT_HIP
from hit_detection import (
    detect_punch, detect_kick, PUNCH_THRESHOLD, KICK_THRESHOLD,
    ANKLE_LEFT, Region,
)
from damage import compute_damage, BASE_DAMAGE
from rooms import PlayerSlot, median_rtt, record_pong


# ---- helpers ----------------------------------------------------------------

def kp(x=0.0, y=0.0, z=0.0, v=1.0) -> PoseKeypoint:
    return PoseKeypoint(x=x, y=y, z=z, visibility=v)


def neutral_keypoints(
    wrist_x=0.0, wrist_y=-0.10,
    ankle_x=0.0, ankle_y=0.45,
) -> list[PoseKeypoint]:
    """MediaPipe Y-down: negative y = above hips, positive y = below hips."""
    pts = [kp()] * 33
    pts = list(pts)
    pts[LEFT_HIP]        = kp(x=-0.1, y=0.0)
    pts[RIGHT_HIP]       = kp(x= 0.1, y=0.0)
    pts[11]              = kp(x=-0.2, y=-0.25)   # LEFT_SHOULDER
    pts[12]              = kp(x= 0.2, y=-0.25)   # RIGHT_SHOULDER
    pts[WRIST_LEFT]      = kp(x=wrist_x, y=wrist_y)
    pts[ANKLE_LEFT]      = kp(x=ankle_x, y=ankle_y)
    return pts


def make_frame(keypoints: list[PoseKeypoint]) -> MsgPoseFrame:
    return MsgPoseFrame(type="pose_frame", timestamp=0.0, keypoints=keypoints)


def fast_punch_deque(end_x=0.0, end_y=-0.45) -> deque:
    """Wrist moves 2 m in 2 frames → 30 m/s >> PUNCH_THRESHOLD.

    end_y=-0.45 places wrist 0.45 m above hips (head zone) in MediaPipe Y-down.
    """
    return deque([
        make_frame(neutral_keypoints(wrist_x=-2.0, wrist_y=end_y)),
        make_frame(neutral_keypoints(wrist_x=-1.0, wrist_y=end_y)),
        make_frame(neutral_keypoints(wrist_x=end_x, wrist_y=end_y)),
    ])


def static_deque(wrist_x=0.0, wrist_y=0.5) -> deque:
    f = make_frame(neutral_keypoints(wrist_x=wrist_x, wrist_y=wrist_y))
    return deque([f, f, f])


# ---- pose.py ----------------------------------------------------------------

def test_velocity_returns_zeros_with_one_frame():
    frames = [[kp()] * 33]
    assert np.all(moving_average_velocity(frames, 0) == 0)


def test_velocity_returns_zeros_with_two_frames():
    frames = [[kp()] * 33, [kp(x=1)] * 33]
    assert np.all(moving_average_velocity(frames, 0) == 0)


def test_velocity_correct_with_three_frames():
    # 1m displacement over 2 frame intervals -> 1 / (2 * 1/30) = 15 m/s
    frames = [
        [kp(x=0.0)] * 33,
        [kp(x=0.5)] * 33,
        [kp(x=1.0)] * 33,
    ]
    v = moving_average_velocity(frames, 0)
    assert abs(v[0] - 15.0) < 0.01


def test_interpolate_midpoint():
    a = [kp(x=0.0)] * 33
    b = [kp(x=2.0)] * 33
    mid = interpolate_poses(a, b, 0.5)
    assert abs(mid[0].x - 1.0) < 1e-6


def test_interpolate_at_zero_returns_a():
    a = [kp(x=1.0)] * 33
    b = [kp(x=5.0)] * 33
    result = interpolate_poses(a, b, 0.0)
    assert abs(result[0].x - 1.0) < 1e-6


def test_interpolate_at_one_returns_b():
    a = [kp(x=1.0)] * 33
    b = [kp(x=5.0)] * 33
    result = interpolate_poses(a, b, 1.0)
    assert abs(result[0].x - 5.0) < 1e-6


def test_interpolate_returns_protocol_keypoints():
    a = [kp()] * 33
    b = [kp(x=1.0)] * 33
    result = interpolate_poses(a, b, 0.5)
    assert isinstance(result[0], PoseKeypoint)


# ---- damage.py --------------------------------------------------------------

def test_damage_at_reference_velocity_in_range():
    d = compute_damage("head_face", 3.0, 3.0)
    assert 15 <= d <= 20


def test_damage_caps_at_max():
    d = compute_damage("head_face", 999.0, 3.0)
    assert d == 20


def test_damage_floors_at_min():
    d = compute_damage("head_face", 0.001, 3.0)
    assert d == 15


def test_damage_none_reference_uses_default():
    d = compute_damage("torso_upper", 3.0, None)
    assert 9 <= d <= 13


def test_damage_all_regions_valid():
    for region in BASE_DAMAGE:
        d = compute_damage(region, 3.0, 3.0)
        lo, hi = BASE_DAMAGE[region]
        assert lo <= d <= hi, f"{region}: {d} not in [{lo},{hi}]"


def test_damage_block_is_low():
    d = compute_damage("block_hand", 3.0, 3.0)
    assert d <= 4


def test_damage_head_throat_is_high():
    d = compute_damage("head_throat", 3.0, 3.0)
    assert d >= 20


# ---- hit_detection.py -------------------------------------------------------

def test_no_hit_when_static():
    d = static_deque()
    assert detect_punch(d, d) is None


def test_punch_registers_fast_wrist_in_head_zone():
    # wrist.y=-0.45 → 0.45 m above hips → HEAD zone (MediaPipe Y-down)
    attacker = fast_punch_deque(end_x=0.0, end_y=-0.45)
    defender = static_deque()
    result = detect_punch(attacker, defender)
    assert result is not None
    assert result.region == Region.HEAD_FACE
    assert result.velocity > PUNCH_THRESHOLD


def test_punch_in_torso_zone():
    # wrist.y=-0.25 → 0.25 m above hips → TORSO_UPPER zone
    attacker = fast_punch_deque(end_x=0.0, end_y=-0.25)
    defender = static_deque()
    result = detect_punch(attacker, defender)
    assert result is not None
    assert result.region == Region.TORSO_UPPER


def test_punch_miss_wrist_below_hips():
    # wrist.y=+0.50 → 0.50 m BELOW hips → not an attack position
    attacker = fast_punch_deque(end_x=0.0, end_y=0.50)
    defender = static_deque()
    result = detect_punch(attacker, defender)
    assert result is None


def test_no_punch_below_threshold():
    slow = deque([
        make_frame(neutral_keypoints(wrist_x=0.00, wrist_y=-0.45)),
        make_frame(neutral_keypoints(wrist_x=0.01, wrist_y=-0.45)),
        make_frame(neutral_keypoints(wrist_x=0.02, wrist_y=-0.45)),
    ])
    defender = static_deque()
    assert detect_punch(slow, defender) is None


def test_kick_registers_raised_ankle():
    # Ankle sweeps upward: from below hips to raised position above hips
    attacker = deque([
        make_frame(neutral_keypoints(ankle_x=0.0, ankle_y= 0.45)),
        make_frame(neutral_keypoints(ankle_x=0.0, ankle_y= 0.15)),
        make_frame(neutral_keypoints(ankle_x=0.0, ankle_y=-0.10)),
    ])
    defender = static_deque()
    result = detect_kick(attacker, defender)
    assert result is not None
    assert result.velocity > KICK_THRESHOLD


def test_returns_none_with_empty_deques():
    assert detect_punch(deque(), deque()) is None
    assert detect_kick(deque(), deque()) is None


# ---- rooms.py RTT -----------------------------------------------------------

def test_median_rtt_empty_returns_zero():
    slot = PlayerSlot()
    assert median_rtt(slot) == 0.0


def test_record_pong_computes_rtt():
    slot = PlayerSlot()
    t0 = time.time() - 0.05  # 50ms ago
    rtt = record_pong(slot, t0)
    assert 40 < rtt < 500


def test_record_pong_keeps_last_10():
    slot = PlayerSlot()
    for _ in range(15):
        record_pong(slot, time.time() - 0.01)
    assert len(slot.rtt_samples) == 10


def test_median_rtt_returns_median():
    slot = PlayerSlot()
    slot.rtt_samples = [10.0, 20.0, 30.0]
    assert median_rtt(slot) == 20.0
