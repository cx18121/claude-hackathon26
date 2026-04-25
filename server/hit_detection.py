"""
Body-local hit detection (Option A from server-todo.md).

Each player is evaluated independently in their own body-local frame.
Attacker's wrist/ankle speed + height determines the attack region;
defender's wrist height determines whether the region is blocked.
No cross-player coordinate frames are needed.
"""
from __future__ import annotations
from collections import deque
from dataclasses import dataclass

import numpy as np

from protocol import MsgPoseFrame  # noqa: F401 — kept for type hints in callers

_FRAME_DT = 1 / 30

# Landmark indices
WRIST_LEFT  = 15
WRIST_RIGHT = 16
ANKLE_LEFT  = 27
ANKLE_RIGHT = 28
LEFT_HIP    = 23
RIGHT_HIP   = 24
LEFT_SHOULDER  = 11
RIGHT_SHOULDER = 12

# Y-up height thresholds (metres above hip midpoint).
# These are relative to a normalised body_scale of 0.30 m (hip-to-shoulder).
# Callers pass body_scale so thresholds auto-scale per player.
_REL_HEAD_Y      = 1.45   # * body_scale ≈ 0.43 m for a 0.30 m torso
_REL_TORSO_HI_Y  = 0.70   # * body_scale ≈ 0.21 m
_REL_TORSO_LO_Y  = 0.00   # wrists above hip = at least torso_lower
_REL_KICK_MID_Y  = -0.30  # ankle this far above hip midpoint = kick in progress

# Guard thresholds: if defender wrist is at or above this height, that zone is blocked
_REL_GUARD_HEAD_Y  = 1.10
_REL_GUARD_TORSO_Y = 0.35

_DEFAULT_BODY_SCALE = 0.30  # metres, used when calibration hasn't run


class Region:
    BLOCK_HAND    = "block_hand"
    BLOCK_FOREARM = "block_forearm"
    LEG_THIGH     = "leg_thigh"
    LEG_SHIN      = "leg_shin"
    TORSO_LOWER   = "torso_lower"
    TORSO_UPPER   = "torso_upper"
    HEAD_FACE     = "head_face"
    HEAD_CHIN     = "head_chin"
    HEAD_THROAT   = "head_throat"


@dataclass
class HitResult:
    region: str
    velocity: float
    position: tuple[float, float, float]


# ---------------------------------------------------------------------------
# Velocity helpers (unchanged from original — they work correctly)
# ---------------------------------------------------------------------------

def _velocity(poses: deque, landmark_idx: int) -> np.ndarray:
    """Central-difference velocity over the last 3 frames using actual timestamps."""
    if len(poses) < 3:
        return np.zeros(3)
    kp_new = poses[-1].keypoints[landmark_idx]
    kp_old = poses[-3].keypoints[landmark_idx]
    dt = float(poses[-1].timestamp - poses[-3].timestamp)
    if dt < 1e-4:
        dt = 2.0 * _FRAME_DT
    return np.array(
        [kp_new.x - kp_old.x, kp_new.y - kp_old.y, kp_new.z - kp_old.z]
    ) / dt


def _peak_speed(poses: deque, landmark_idx: int) -> float:
    """Max speed between any consecutive frame pair in the window."""
    frames = list(poses)
    if len(frames) < 2:
        return 0.0
    best = 0.0
    for i in range(len(frames) - 1):
        a, b = frames[i], frames[i + 1]
        dt = float(b.timestamp - a.timestamp)
        if dt < 1e-4:
            dt = _FRAME_DT
        ka, kb = a.keypoints[landmark_idx], b.keypoints[landmark_idx]
        dx, dy, dz = kb.x - ka.x, kb.y - ka.y, kb.z - ka.z
        s = (dx * dx + dy * dy + dz * dz) ** 0.5 / dt
        if s > best:
            best = s
    return best


# ---------------------------------------------------------------------------
# Body-local helpers
# ---------------------------------------------------------------------------

def _hip_mid_y(kp) -> float:
    """Hip midpoint Y in MediaPipe convention (positive = toward feet)."""
    return (kp[LEFT_HIP].y + kp[RIGHT_HIP].y) / 2


def _y_up(kp, idx: int) -> float:
    """Height of landmark above hip midpoint in Y-UP convention (positive = up)."""
    # MediaPipe Y is positive downward; negate to get Y-up.
    return _hip_mid_y(kp) - kp[idx].y


def _body_scale(kp) -> float:
    """Hip-to-shoulder midpoint distance in metres (proxy for torso height)."""
    shoulder_y = (kp[LEFT_SHOULDER].y + kp[RIGHT_SHOULDER].y) / 2
    hip_y = (kp[LEFT_HIP].y + kp[RIGHT_HIP].y) / 2
    scale = abs(hip_y - shoulder_y)
    return max(0.12, min(0.55, scale))  # sanity-clamp to realistic adult range


# ---------------------------------------------------------------------------
# Per-frame position → region mapping
# ---------------------------------------------------------------------------

def _attack_region(kp, landmark_idx: int, scale: float) -> str | None:
    """Region targeted by this limb's position, or None if below hip level."""
    y = _y_up(kp, landmark_idx)
    head_y     = _REL_HEAD_Y     * scale
    torso_hi_y = _REL_TORSO_HI_Y * scale
    if y >= head_y:
        return Region.HEAD_FACE
    elif y >= torso_hi_y:
        return Region.TORSO_UPPER
    elif y >= _REL_TORSO_LO_Y:
        return Region.TORSO_LOWER
    return None  # limb below hip level — not in attack zone


def _kick_region(kp, landmark_idx: int, scale: float) -> str | None:
    """Region targeted by a kick based on ankle height."""
    y = _y_up(kp, landmark_idx)
    torso_hi_y = _REL_TORSO_HI_Y * scale
    kick_mid_y = _REL_KICK_MID_Y * scale
    if y >= torso_hi_y:
        return Region.TORSO_LOWER   # high kick
    elif y >= kick_mid_y:
        return Region.LEG_THIGH     # low kick
    return None


# ---------------------------------------------------------------------------
# Defender guard state
# ---------------------------------------------------------------------------

def _guarded_zones(kp, scale: float) -> set[str]:
    """Zones currently blocked based on defender's wrist heights."""
    guarded: set[str] = set()
    head_guard_y  = _REL_GUARD_HEAD_Y  * scale
    torso_guard_y = _REL_GUARD_TORSO_Y * scale
    for wrist_idx in (WRIST_LEFT, WRIST_RIGHT):
        y = _y_up(kp, wrist_idx)
        if y >= head_guard_y:
            guarded.add('head')
        if y >= torso_guard_y:
            guarded.add('torso')
    return guarded


def _apply_guard(region: str, guarded: set[str]) -> str:
    if region in (Region.HEAD_FACE, Region.HEAD_CHIN, Region.HEAD_THROAT) and 'head' in guarded:
        return Region.BLOCK_HAND
    if region in (Region.TORSO_UPPER, Region.TORSO_LOWER) and 'torso' in guarded:
        return Region.BLOCK_FOREARM
    return region


# ---------------------------------------------------------------------------
# Speed thresholds (scale with the attacker's calibrated reference velocity)
# ---------------------------------------------------------------------------

def _punch_threshold(ref_velocity: float | None) -> float:
    ref = ref_velocity if ref_velocity is not None else 3.0
    return max(0.6, 0.40 * ref)


def _kick_threshold(ref_velocity: float | None) -> float:
    ref = ref_velocity if ref_velocity is not None else 3.0
    return max(0.9, 0.55 * ref)


# Module-level constants for callers that need a fixed threshold reference
# (e.g. tests).  These are the default values at ref_velocity = 3.0 m/s.
PUNCH_THRESHOLD = _punch_threshold(None)   # 1.2 m/s
KICK_THRESHOLD  = _kick_threshold(None)    # 1.65 m/s


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def detect_punch(
    attacker_poses: deque,
    defender_poses: deque,
    ref_velocity: float | None = None,
) -> HitResult | None:
    if not attacker_poses:
        return None

    threshold = _punch_threshold(ref_velocity)

    defender_kp = defender_poses[-1].keypoints if defender_poses else None
    def_scale = _body_scale(defender_kp) if defender_kp else _DEFAULT_BODY_SCALE
    guarded = _guarded_zones(defender_kp, def_scale) if defender_kp else set()

    for wrist_idx in (WRIST_LEFT, WRIST_RIGHT):
        speed = max(
            float(np.linalg.norm(_velocity(attacker_poses, wrist_idx))),
            _peak_speed(attacker_poses, wrist_idx),
        )
        if speed < threshold:
            continue

        for frame in reversed(list(attacker_poses)):
            kp = frame.keypoints
            scale = _body_scale(kp)
            region = _attack_region(kp, wrist_idx, scale)
            if region is None:
                continue
            region = _apply_guard(region, guarded)
            w = kp[wrist_idx]
            return HitResult(region=region, velocity=speed, position=(w.x, w.y, w.z))

    return None


def detect_kick(
    attacker_poses: deque,
    defender_poses: deque,
    ref_velocity: float | None = None,
) -> HitResult | None:
    if not attacker_poses:
        return None

    threshold = _kick_threshold(ref_velocity)

    for ankle_idx in (ANKLE_LEFT, ANKLE_RIGHT):
        speed = max(
            float(np.linalg.norm(_velocity(attacker_poses, ankle_idx))),
            _peak_speed(attacker_poses, ankle_idx),
        )
        if speed < threshold:
            continue

        for frame in reversed(list(attacker_poses)):
            kp = frame.keypoints
            scale = _body_scale(kp)
            region = _kick_region(kp, ankle_idx, scale)
            if region is None:
                continue
            a = kp[ankle_idx]
            return HitResult(region=region, velocity=speed, position=(a.x, a.y, a.z))

    return None
