from __future__ import annotations

BASE_DAMAGE: dict[str, tuple[int, int]] = {
    "block_hand":    (2, 4),
    "block_forearm": (2, 4),
    "leg_thigh":     (3, 5),
    "leg_shin":      (3, 5),
    "torso_lower":   (6, 9),
    "torso_upper":   (9, 13),
    "head_face":     (15, 20),
    "head_chin":     (20, 25),
    "head_throat":   (20, 25),
}


def compute_damage(region: str, limb_velocity: float, reference_velocity: float | None) -> int:
    ref = reference_velocity if reference_velocity is not None else 3.0
    base_min, base_max = BASE_DAMAGE[region]
    scale = limb_velocity / max(ref, 0.1)
    raw = base_min + (base_max - base_min) * (scale - 1.0)
    return int(max(base_min, min(base_max, round(raw))))
