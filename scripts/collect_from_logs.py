"""
collect_from_logs.py — Build training samples from engine-core gameplay logs.

For every registered hit the server emits a FLYWHEEL_HIT JSON line containing
the attacker's last ≤20 pose frames (25 MediaPipe keypoints each).  This script
reads those lines, extracts the 8 joints used by PunchTCN, infers a punch-type
label from wrist peak-velocity direction, and writes (20, 8, 3) float32 numpy
arrays to ml/data/<label>/ — the same directory layout expected by train.py.

Labelling heuristic
-------------------
At hit time the striking wrist has the higher peak velocity.  The velocity
vector direction discriminates punch type:
  |v_x| > |v_z|  →  lateral motion  →  hook_l / hook_r
  |v_z| >= |v_x| →  forward motion  →  jab (left wrist) / cross (right wrist)

Usage
-----
  # Stream from a running server (stdout + stderr):
  cargo run -p fps-boxing-server 2>&1 | python scripts/collect_from_logs.py

  # Post-process a saved log file:
  python scripts/collect_from_logs.py --log-file server.log

  # Dry run — count samples without writing files:
  python scripts/collect_from_logs.py --log-file server.log --dry-run

  # Then retrain:
  cd ml && python scripts/train.py --data-dir data
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Optional

import numpy as np

# ---------------------------------------------------------------------------
# Constants — must stay in sync with ml/scripts/train.py
# ---------------------------------------------------------------------------
JOINT_INDICES = [11, 12, 13, 14, 15, 16, 23, 24]
CLASSES = ["jab", "cross", "hook_l", "hook_r", "guard"]
SEQ_LEN = 20
MIN_FRAMES = 10   # discard windows shorter than this

# Indices within the 8-joint subset
LEFT_WRIST_IDX = 4   # MediaPipe joint 15 → subset position 4
RIGHT_WRIST_IDX = 5  # MediaPipe joint 16 → subset position 5

_FLYWHEEL_RE = re.compile(r"FLYWHEEL_HIT (\{.*\})")


# ---------------------------------------------------------------------------
# Labelling
# ---------------------------------------------------------------------------
def _infer_label(frames: np.ndarray) -> str:
    """Return a punch-class string for a (T, 8, 3) frame window."""
    window = frames[-8:] if len(frames) >= 8 else frames
    if len(window) < 2:
        return "cross"

    lw = window[:, LEFT_WRIST_IDX, :]
    rw = window[:, RIGHT_WRIST_IDX, :]

    lw_speeds = np.linalg.norm(np.diff(lw, axis=0), axis=1)
    rw_speeds = np.linalg.norm(np.diff(rw, axis=0), axis=1)
    left_dominant = float(lw_speeds.max()) > float(rw_speeds.max())

    dominant = lw if left_dominant else rw
    peak = int(np.argmax(np.linalg.norm(np.diff(dominant, axis=0), axis=1)))
    vel = dominant[peak + 1] - dominant[peak]

    lateral = abs(float(vel[0]))
    forward = abs(float(vel[2]))

    if lateral > forward:
        return "hook_l" if left_dominant else "hook_r"
    return "jab" if left_dominant else "cross"


# ---------------------------------------------------------------------------
# Frame extraction
# ---------------------------------------------------------------------------
def _extract_frames(hit: dict) -> Optional[np.ndarray]:
    """
    Parse a FLYWHEEL_HIT payload into a (SEQ_LEN, 8, 3) float32 array.
    Returns None when the payload is malformed or has fewer than MIN_FRAMES.
    """
    raw = hit.get("frames", [])
    if len(raw) < MIN_FRAMES:
        return None

    rows = []
    for f in raw:
        kps = f.get("keypoints", [])
        if len(kps) < 25:
            return None
        row = np.array(
            [[kps[j][0], kps[j][1], kps[j][2]] for j in JOINT_INDICES],
            dtype=np.float32,
        )
        rows.append(row)

    seq = np.stack(rows, axis=0)  # (T, 8, 3)

    if len(seq) > SEQ_LEN:
        seq = seq[-SEQ_LEN:]
    elif len(seq) < SEQ_LEN:
        pad = np.zeros((SEQ_LEN - len(seq), 8, 3), dtype=np.float32)
        seq = np.concatenate([pad, seq], axis=0)

    return seq


# ---------------------------------------------------------------------------
# Core loop
# ---------------------------------------------------------------------------
def collect(lines, out_dir: Path, dry_run: bool = False):
    counts: dict[str, int] = {c: 0 for c in CLASSES}
    skipped = 0

    for line in lines:
        m = _FLYWHEEL_RE.search(line)
        if not m:
            continue

        try:
            hit = json.loads(m.group(1))
        except json.JSONDecodeError:
            skipped += 1
            continue

        frames = _extract_frames(hit)
        if frames is None:
            skipped += 1
            continue

        label = _infer_label(frames)
        room = hit.get("room", "unknown")
        tick = hit.get("tick", 0)

        if not dry_run:
            label_dir = out_dir / label
            label_dir.mkdir(parents=True, exist_ok=True)
            np.save(label_dir / f"game_{room}_{tick}.npy", frames)

        counts[label] += 1

    return counts, skipped


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--log-file",
        type=str,
        help="Log file to parse (default: read from stdin)",
    )
    parser.add_argument(
        "--out-dir",
        type=str,
        default="ml/data",
        help="Root output dir for per-class numpy files (default: ml/data)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and label without writing any files",
    )
    args = parser.parse_args()

    out_dir = Path(args.out_dir)

    if args.log_file:
        with open(args.log_file) as fh:
            counts, skipped = collect(fh, out_dir, dry_run=args.dry_run)
    else:
        print("Reading from stdin — pipe server logs here (Ctrl-C to stop)...", file=sys.stderr)
        counts, skipped = collect(sys.stdin, out_dir, dry_run=args.dry_run)

    total = sum(counts.values())
    print(f"\nFlywheel collection {'(dry run) ' if args.dry_run else ''}complete")
    print(f"  Total samples written: {total}")
    for label in CLASSES:
        if counts[label]:
            print(f"    {label:10s}: {counts[label]}")
    if skipped:
        print(f"  Skipped (malformed/short windows): {skipped}")
    if not args.dry_run and total > 0:
        print(f"\n  Output: {out_dir}/")
        print(f"  Retrain: cd ml && python scripts/train.py --data-dir data")


if __name__ == "__main__":
    main()
