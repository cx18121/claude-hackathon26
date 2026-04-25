from __future__ import annotations
from collections import deque
from dataclasses import dataclass
from typing import NamedTuple

import numpy as np

from protocol import MsgPoseFrame

PUNCH_THRESHOLD = 2.0  # m/s
KICK_THRESHOLD = 2.5   # m/s
_FRAME_DT = 1 / 30     # seconds between pose frames

WRIST_LEFT = 15
WRIST_RIGHT = 16
ANKLE_LEFT = 27
ANKLE_RIGHT = 28
LEFT_HIP = 23
RIGHT_HIP = 24


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


class Capsule(NamedTuple):
    center: tuple[float, float, float]  # offset from defender's hip midpoint
    radius: float
    half_length: float
    axis: tuple[float, float, float]    # unit vector along the long axis


# Hitboxes are checked in attacker-local XY space (Z ignored — see _check_limb).
# Y up, X lateral. Radii sized for real punch geometry where the wrist lands
# 10-20 cm off the body centreline.
HITBOXES: dict[str, list[Capsule]] = {
    Region.HEAD_FACE: [
        Capsule(center=(0.0,  0.65, 0.0), radius=0.22, half_length=0.09, axis=(0, 1, 0)),
    ],
    Region.HEAD_CHIN: [
        Capsule(center=(0.0,  0.55, 0.0), radius=0.16, half_length=0.05, axis=(0, 1, 0)),
    ],
    Region.HEAD_THROAT: [
        Capsule(center=(0.0,  0.50, 0.0), radius=0.13, half_length=0.07, axis=(0, 1, 0)),
    ],
    Region.TORSO_UPPER: [
        Capsule(center=(0.0,  0.30, 0.0), radius=0.26, half_length=0.16, axis=(1, 0, 0)),
    ],
    Region.TORSO_LOWER: [
        Capsule(center=(0.0,  0.10, 0.0), radius=0.24, half_length=0.14, axis=(1, 0, 0)),
    ],
    Region.BLOCK_HAND: [
        Capsule(center=(-0.35, 0.25, 0.0), radius=0.06, half_length=0.06, axis=(1, 0, 0)),
        Capsule(center=( 0.35, 0.25, 0.0), radius=0.06, half_length=0.06, axis=(1, 0, 0)),
    ],
    Region.BLOCK_FOREARM: [
        Capsule(center=(-0.28, 0.20, 0.0), radius=0.05, half_length=0.12, axis=(0, 1, 0)),
        Capsule(center=( 0.28, 0.20, 0.0), radius=0.05, half_length=0.12, axis=(0, 1, 0)),
    ],
    Region.LEG_THIGH: [
        Capsule(center=(-0.12, -0.20, 0.0), radius=0.10, half_length=0.18, axis=(0, 1, 0)),
        Capsule(center=( 0.12, -0.20, 0.0), radius=0.10, half_length=0.18, axis=(0, 1, 0)),
    ],
    Region.LEG_SHIN: [
        Capsule(center=(-0.12, -0.48, 0.0), radius=0.08, half_length=0.18, axis=(0, 1, 0)),
        Capsule(center=( 0.12, -0.48, 0.0), radius=0.08, half_length=0.18, axis=(0, 1, 0)),
    ],
}


def _velocity(poses: deque, landmark_idx: int) -> np.ndarray:
    """Central-difference velocity over the last 3 frames using actual timestamps."""
    if len(poses) < 3:
        return np.zeros(3)
    kp_new = poses[-1].keypoints[landmark_idx]
    kp_old = poses[-3].keypoints[landmark_idx]
    dt = float(poses[-1].timestamp - poses[-3].timestamp)
    if dt < 1e-4:
        dt = 2.0 * _FRAME_DT  # fallback to nominal 30fps when timestamps are missing
    return np.array(
        [kp_new.x - kp_old.x, kp_new.y - kp_old.y, kp_new.z - kp_old.z]
    ) / dt


def _hip_midpoint(frame: MsgPoseFrame) -> np.ndarray:
    lh = frame.keypoints[LEFT_HIP]
    rh = frame.keypoints[RIGHT_HIP]
    return np.array([(lh.x + rh.x) / 2, (lh.y + rh.y) / 2, (lh.z + rh.z) / 2])


def _capsule_dist(point: np.ndarray, cap: Capsule) -> float:
    c = np.array(cap.center)
    ax = np.array(cap.axis)
    t = float(np.clip(np.dot(point - c, ax), -cap.half_length, cap.half_length))
    return float(np.linalg.norm(point - (c + t * ax)))


def _check_limb(
    attacker_poses: deque,
    defender_poses: deque,
    landmark_idx: int,
    threshold: float,
) -> HitResult | None:
    if not attacker_poses or not defender_poses:
        return None
    vel = _velocity(attacker_poses, landmark_idx)
    speed = float(np.linalg.norm(vel))
    if speed < threshold:
        return None

    # Each player's MediaPipe world landmarks are body-centred (hip midpoint ≈
    # origin), so we use the ATTACKER's own hip as the reference. Crucially we
    # zero out the z component before the capsule check: a real forward punch
    # extends the wrist 15-25 cm in front of the body (negative z), but the
    # capsule centres are at z=0. Without this projection the z-offset alone
    # exceeds the head capsule radius and every punch misses.
    for frame in reversed(list(attacker_poses)):
        kp = frame.keypoints[landmark_idx]
        origin = _hip_midpoint(frame)
        local_xy = np.array([kp.x - origin[0], kp.y - origin[1], 0.0])
        for region, capsules in HITBOXES.items():
            for cap in capsules:
                if _capsule_dist(local_xy, cap) < cap.radius:
                    return HitResult(region=region, velocity=speed, position=(kp.x, kp.y, kp.z))
    return None


def detect_punch(attacker_poses: deque, defender_poses: deque) -> HitResult | None:
    for idx in (WRIST_LEFT, WRIST_RIGHT):
        result = _check_limb(attacker_poses, defender_poses, idx, PUNCH_THRESHOLD)
        if result is not None:
            return result
    return None


def detect_kick(attacker_poses: deque, defender_poses: deque) -> HitResult | None:
    for idx in (ANKLE_LEFT, ANKLE_RIGHT):
        result = _check_limb(attacker_poses, defender_poses, idx, KICK_THRESHOLD)
        if result is not None:
            return result
    return None
