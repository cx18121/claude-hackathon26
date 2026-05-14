"""
record_webcam.py — Guided webcam data collection for punch classifier training.

Opens the default webcam, shows the live feed with on-screen prompts,
and records labeled .mp4 clips for use with extract_keypoints.py.

Usage examples:
    python scripts/record_webcam.py --output-dir ml/data/raw_videos --label jab
    python scripts/record_webcam.py --output-dir ml/data/raw_videos --label cross --clips 100
    python scripts/record_webcam.py --dry-run --label guard
"""

import argparse
import os
import sys
import time
from datetime import datetime
from pathlib import Path

VALID_LABELS = ["jab", "cross", "hook_l", "hook_r", "guard"]

POSE_INSTRUCTIONS = {
    "jab": (
        "JAB — Lead hand straight punch\n"
        "  Starting position: guard (both fists up at chin)\n"
        "  Motion: quickly extend lead hand straight forward, then retract\n"
        "  Tip: rotate lead shoulder slightly forward as you extend"
    ),
    "cross": (
        "CROSS — Rear hand straight punch\n"
        "  Starting position: guard (both fists up at chin)\n"
        "  Motion: pivot rear foot, rotate hips, extend rear hand straight forward\n"
        "  Tip: drop lead shoulder slightly as rear extends"
    ),
    "hook_l": (
        "LEFT HOOK\n"
        "  Starting position: guard (both fists up at chin)\n"
        "  Motion: pivot left foot, swing left arm in horizontal arc (elbow at ~90°)\n"
        "  Tip: keep elbow parallel to floor throughout"
    ),
    "hook_r": (
        "RIGHT HOOK\n"
        "  Starting position: guard (both fists up at chin)\n"
        "  Motion: pivot right foot, swing right arm in horizontal arc (elbow at ~90°)\n"
        "  Tip: rotate hips to generate power"
    ),
    "guard": (
        "GUARD — Defensive position\n"
        "  Position: both fists raised to chin/temple level, elbows tucked\n"
        "  Motion: hold still or sway slightly — do NOT throw punches\n"
        "  Tip: vary head position slightly (left, right, centre) across clips"
    ),
}


def print_usage_instructions(label: str) -> None:
    print("\n" + "=" * 60)
    print(f"Recording class: {label.upper()}")
    print("=" * 60)
    instructions = POSE_INSTRUCTIONS.get(label, f"Perform a {label} motion.")
    print(instructions)
    print("\nControls:")
    print("  SPACE — start recording the next clip")
    print("  q     — quit early")
    print("=" * 60 + "\n")


def draw_text(frame, text: str, y: int, color=(0, 255, 0), scale: float = 0.8) -> None:
    """Draw text with a dark background for readability."""
    import cv2
    font = cv2.FONT_HERSHEY_SIMPLEX
    thickness = 2
    (w, h), baseline = cv2.getTextSize(text, font, scale, thickness)
    cv2.rectangle(frame, (8, y - h - 4), (8 + w + 4, y + baseline + 4), (0, 0, 0), -1)
    cv2.putText(frame, text, (10, y), font, scale, color, thickness, cv2.LINE_AA)


def record_clip(
    cap,
    output_path: Path,
    clip_duration: float,
    fps: float,
    frame_size: tuple[int, int],
    label: str,
    clip_number: int,
    total_clips: int,
) -> bool:
    """Record a single clip and save to output_path.

    Returns True on success, False if the user quit.
    """
    import cv2

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(output_path), fourcc, fps, frame_size)

    total_frames = int(clip_duration * fps)
    frame_count = 0
    start_time = time.monotonic()

    while frame_count < total_frames:
        ret, frame = cap.read()
        if not ret:
            print("WARNING: webcam frame read failed during recording.", file=sys.stderr)
            break

        # Overlay RECORDING indicator
        elapsed = time.monotonic() - start_time
        remaining = max(0.0, clip_duration - elapsed)
        draw_text(frame, f"RECORDING  {remaining:.1f}s", 40, color=(0, 0, 255), scale=1.0)
        draw_text(frame, f"Clip {clip_number}/{total_clips}  [{label}]", 80, color=(0, 200, 200))

        writer.write(frame)
        cv2.imshow(f"Record: {label}", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            writer.release()
            return False

        frame_count += 1

    writer.release()
    return True


def run_recording(
    output_dir: Path,
    label: str,
    clip_duration: float,
    total_clips: int,
) -> None:
    """Open webcam and guide the user through recording total_clips clips."""
    import cv2

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("ERROR: cannot open webcam (device 0).", file=sys.stderr)
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        fps = 30.0  # fallback for webcams that report 0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_size = (width, height)

    out_label_dir = output_dir / label
    out_label_dir.mkdir(parents=True, exist_ok=True)

    clips_recorded = 0
    window_name = f"Record: {label}"

    try:
        while clips_recorded < total_clips:
            # Show "Ready" screen, wait for SPACE or q
            while True:
                ret, frame = cap.read()
                if not ret:
                    print("WARNING: webcam frame read failed.", file=sys.stderr)
                    time.sleep(0.05)
                    continue

                draw_text(
                    frame,
                    f"Ready — press SPACE to record clip {clips_recorded + 1}/{total_clips}",
                    40,
                    color=(0, 255, 0),
                    scale=0.7,
                )
                draw_text(frame, f"Class: {label}  |  q to quit", 80, color=(200, 200, 0))
                cv2.imshow(window_name, frame)

                key = cv2.waitKey(30) & 0xFF
                if key == ord(" "):
                    break
                if key == ord("q"):
                    print(f"\nQuit early. Recorded {clips_recorded} clip(s).")
                    return

            # Record one clip
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            output_path = out_label_dir / f"{label}_{timestamp}.mp4"

            success = record_clip(
                cap=cap,
                output_path=output_path,
                clip_duration=clip_duration,
                fps=fps,
                frame_size=frame_size,
                label=label,
                clip_number=clips_recorded + 1,
                total_clips=total_clips,
            )

            if not success:
                print(f"\nQuit early. Recorded {clips_recorded} clip(s).")
                return

            clips_recorded += 1
            print(f"  Saved: {output_path}")

    finally:
        cap.release()
        cv2.destroyAllWindows()

    print(f"\nRecorded {clips_recorded} clips to {out_label_dir}/")


def main():
    parser = argparse.ArgumentParser(
        description="Guided webcam recording tool for collecting per-class punch training data.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        metavar="DIR",
        help="Root directory where clips are saved. Clips go to <output-dir>/<label>/.",
    )
    parser.add_argument(
        "--label",
        required=True,
        choices=VALID_LABELS,
        metavar="LABEL",
        help=f"Punch class to record. One of: {', '.join(VALID_LABELS)}.",
    )
    parser.add_argument(
        "--clip-duration",
        type=float,
        default=2.0,
        metavar="SECONDS",
        help="Length of each recorded clip in seconds.",
    )
    parser.add_argument(
        "--clips",
        type=int,
        default=50,
        metavar="N",
        help="Number of clips to record.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print config and exit without opening the camera.",
    )
    args = parser.parse_args()

    if args.dry_run:
        print("DRY RUN configuration:")
        print(f"  output-dir:    {args.output_dir}")
        print(f"  label:         {args.label}")
        print(f"  clip-duration: {args.clip_duration}s")
        print(f"  clips:         {args.clips}")
        print(f"  output path:   {args.output_dir}/{args.label}/<label>_<timestamp>.mp4")
        sys.exit(0)

    output_dir = Path(args.output_dir)

    print_usage_instructions(args.label)
    run_recording(
        output_dir=output_dir,
        label=args.label,
        clip_duration=args.clip_duration,
        total_clips=args.clips,
    )


if __name__ == "__main__":
    main()
