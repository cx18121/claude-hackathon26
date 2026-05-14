"""
extract_keypoints.py — MediaPipe PoseLandmarker extraction from video files to .npy arrays.

For each .mp4/.avi/.mov file under --input-dir, runs MediaPipe Pose on every frame,
extracts 8 world landmark joints, and saves sliding-window sequences as .npy files
to --output-dir.

Output filename: <label>/<video_stem>_w{window_idx:04d}.npy
Output shape:    (window_size, 8, 3) — frames × joints × (x, y, z)

Joint indices extracted (must match JOINT_INDICES in fps/src/hooks/usePunchClassifier.ts):
    JOINT_INDICES = [11, 12, 13, 14, 15, 16, 23, 24]
    # LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_ELBOW, RIGHT_ELBOW,
    # LEFT_WRIST, RIGHT_WRIST, LEFT_HIP, RIGHT_HIP
"""

import argparse
import os
import sys
from collections import deque
from pathlib import Path

# The 8 joints extracted per frame.
# Index positions within this list (0-7) are used as the joint axis in the output array.
# Must match JOINT_INDICES in fps/src/hooks/usePunchClassifier.ts.
JOINT_INDICES = [11, 12, 13, 14, 15, 16, 23, 24]

VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov"}


def _import_deps():
    """Lazy import of heavy dependencies so --help and --dry-run work without them installed."""
    try:
        import cv2
        import numpy as np
        import mediapipe as mp
        return cv2, np, mp
    except ImportError as e:
        print(f"ERROR: missing dependency — {e}", file=sys.stderr)
        print("Run: pip install -r ml/requirements.txt", file=sys.stderr)
        sys.exit(1)


def find_video_files(input_dir: Path) -> list[tuple[str, Path]]:
    """Return (label, video_path) pairs for all video files under input_dir.

    Expected directory layout:
        input_dir/
            jab/
                video1.mp4
            cross/
                video2.mp4
            ...

    The subdirectory name is used as the class label.
    """
    pairs = []
    for label_dir in sorted(input_dir.iterdir()):
        if not label_dir.is_dir():
            continue
        label = label_dir.name
        for path in sorted(label_dir.rglob("*")):
            if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS:
                pairs.append((label, path))
    return pairs


def extract_frames(video_path: Path, pose_detector, cv2, np) -> list:
    """Run MediaPipe Pose on every frame of a video.

    Returns a list of per-frame arrays of shape (8, 3), one entry per frame
    where MediaPipe found a pose. Frames where detection fails are skipped.
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"  WARNING: cannot open {video_path}", file=sys.stderr)
        return []

    frames = []
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = pose_detector.process(rgb)

            if results.pose_world_landmarks is None:
                continue

            landmarks = results.pose_world_landmarks.landmark
            # Extract only the 8 joints, preserving order from JOINT_INDICES
            joint_array = np.array(
                [[landmarks[i].x, landmarks[i].y, landmarks[i].z] for i in JOINT_INDICES],
                dtype=np.float32,
            )  # shape (8, 3)
            frames.append(joint_array)
    finally:
        cap.release()

    return frames


def sliding_windows(frames: list, window_size: int, stride: int, np) -> list:
    """Produce sliding-window sequences from a list of per-frame arrays.

    Returns a list of arrays, each shape (window_size, 8, 3).
    """
    if len(frames) < window_size:
        return []

    windows = []
    buf = deque(maxlen=window_size)

    for idx, frame in enumerate(frames):
        buf.append(frame)
        if len(buf) == window_size:
            # Only emit a window at stride boundaries
            # First window emits when buf is full; subsequent windows every `stride` frames
            frames_since_first = idx - (window_size - 1)
            if frames_since_first % stride == 0:
                windows.append(np.stack(list(buf), axis=0))  # (window_size, 8, 3)

    return windows


def process_video(
    label: str,
    video_path: Path,
    output_dir: Path,
    window_size: int,
    stride: int,
    pose_detector,
    cv2,
    np,
) -> int:
    """Extract keypoints from one video and save .npy files.

    Returns the number of windows saved.
    """
    frames = extract_frames(video_path, pose_detector, cv2, np)
    windows = sliding_windows(frames, window_size, stride, np)

    if not windows:
        print(f"  {video_path.name}: 0 frames detected or too short for window_size={window_size}")
        return 0

    out_label_dir = output_dir / label
    out_label_dir.mkdir(parents=True, exist_ok=True)

    stem = video_path.stem
    for w_idx, window in enumerate(windows):
        out_path = out_label_dir / f"{stem}_w{w_idx:04d}.npy"
        np.save(str(out_path), window)

    print(f"  {video_path.name}: {len(windows)} windows -> {out_label_dir}/")
    return len(windows)


def build_pose_detector(mp):
    mp_pose = mp.solutions.pose
    return mp_pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )


def main():
    parser = argparse.ArgumentParser(
        description="Extract MediaPipe PoseLandmarker keypoints from video files to .npy arrays.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--input-dir",
        required=True,
        metavar="DIR",
        help="Root directory with subdirectories named by class label (jab/cross/hook_l/hook_r/guard).",
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        metavar="DIR",
        help="Where to write .npy files; mirrors the input subdirectory structure.",
    )
    parser.add_argument(
        "--window-size",
        type=int,
        default=20,
        metavar="N",
        help="Number of frames per sliding-window sequence (T dimension of output array).",
    )
    parser.add_argument(
        "--stride",
        type=int,
        default=5,
        metavar="N",
        help="Stride between consecutive windows (5 = 75%% overlap at window_size=20).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print file count and exit without processing.",
    )
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)

    # --dry-run: no deps needed, just count files
    if args.dry_run:
        if not input_dir.exists():
            print(f"DRY RUN: --input-dir '{input_dir}' does not exist; 0 video files found.")
            print(f"DRY RUN: found 0 video files, would extract windows with window_size={args.window_size}, stride={args.stride}")
            sys.exit(0)
        video_files = find_video_files(input_dir)
        print(f"DRY RUN: found {len(video_files)} video files, would extract windows with window_size={args.window_size}, stride={args.stride}")
        sys.exit(0)

    # Normal mode: load heavy deps now
    cv2, np, mp = _import_deps()

    if not input_dir.exists():
        print(f"ERROR: --input-dir '{input_dir}' does not exist.", file=sys.stderr)
        sys.exit(1)

    video_files = find_video_files(input_dir)

    if not video_files:
        print(f"WARNING: no video files found under '{input_dir}'.")
        sys.exit(0)

    pose_detector = build_pose_detector(mp)

    total_windows = 0
    try:
        for label, video_path in video_files:
            count = process_video(
                label=label,
                video_path=video_path,
                output_dir=output_dir,
                window_size=args.window_size,
                stride=args.stride,
                pose_detector=pose_detector,
                cv2=cv2,
                np=np,
            )
            total_windows += count
    finally:
        pose_detector.close()

    print(f"\nDone. Extracted {total_windows} windows from {len(video_files)} files -> {output_dir}")


if __name__ == "__main__":
    main()
