from __future__ import annotations

import numpy as np

from protocol import PoseKeypoint

WRIST_LEFT = 15
WRIST_RIGHT = 16
ANKLE_LEFT = 27
ANKLE_RIGHT = 28
NOSE = 0
LEFT_HIP = 23
RIGHT_HIP = 24

_FRAME_DT = 1 / 30


def moving_average_velocity(frames: list[list[PoseKeypoint]], landmark_idx: int) -> np.ndarray:
    if len(frames) < 3:
        return np.zeros(3)
    p_new = frames[-1][landmark_idx]
    p_old = frames[-3][landmark_idx]
    return np.array([p_new.x - p_old.x, p_new.y - p_old.y, p_new.z - p_old.z]) / (2 * _FRAME_DT)


def interpolate_poses(a: list[PoseKeypoint], b: list[PoseKeypoint], t: float) -> list[PoseKeypoint]:
    return [
        PoseKeypoint(
            x=a[i].x + (b[i].x - a[i].x) * t,
            y=a[i].y + (b[i].y - a[i].y) * t,
            z=a[i].z + (b[i].z - a[i].z) * t,
            visibility=a[i].visibility + (b[i].visibility - a[i].visibility) * t,
        )
        for i in range(len(a))
    ]
