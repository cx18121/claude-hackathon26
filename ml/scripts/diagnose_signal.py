"""
Diagnostic: visualise MediaPipe landmark trajectories per punch.

Usage:
  python scripts/diagnose_signal.py

Controls:
  SPACE  — start/stop a 3-second recording clip
  Q      — quit (shows combined plot of all recorded clips)

Each clip is labelled at record time.  After recording a few clips, press Q
to see whether the joint trajectories are visually separable.

Joints plotted: left/right wrist and elbow (x, y, z over time).
The critical signal is the WRIST Z-axis — this is what separates a straight
punch (z moves toward camera) from a hook (z stays flat, x arcs).
"""

import argparse
import sys
import time
from collections import deque

import cv2
import matplotlib.pyplot as plt
import mediapipe as mp
import numpy as np

JOINT_NAMES = {
    13: "L_ELBOW",
    14: "R_ELBOW",
    15: "L_WRIST",
    16: "R_WRIST",
}
JOINT_INDICES = sorted(JOINT_NAMES)

COLORS = {
    "jab": "#e74c3c",
    "cross": "#3498db",
    "hook_l": "#2ecc71",
    "hook_r": "#f39c12",
    "guard": "#9b59b6",
    "other": "#95a5a6",
}

CLIP_DURATION = 3.0  # seconds per recording


def _run_pose():
    mp_pose = mp.solutions.pose
    return mp_pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )


def _extract_frame(results):
    """Return array (4, 3) — the 4 joints in JOINT_INDICES order, xyz world coords."""
    if not results.pose_world_landmarks:
        return None
    lm = results.pose_world_landmarks.landmark
    return np.array([[lm[i].x, lm[i].y, lm[i].z] for i in JOINT_INDICES])


def _ask_label(window_name="Spectre Diagnose"):
    labels = ["jab", "cross", "hook_l", "hook_r", "guard", "other"]
    print("\nLabel this clip:")
    for i, l in enumerate(labels):
        print(f"  {i+1}) {l}")
    while True:
        val = input("  Enter number (1-6): ").strip()
        if val.isdigit() and 1 <= int(val) <= len(labels):
            return labels[int(val) - 1]


def record_and_plot(args):
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        sys.exit("ERROR: cannot open webcam")

    pose = _run_pose()
    clips: list[tuple[str, np.ndarray]] = []  # [(label, frames (T,4,3)), ...]

    recording = False
    rec_frames: list[np.ndarray] = []
    rec_start = 0.0

    print("=== Spectre Punch Signal Diagnostic ===")
    print("SPACE = start clip  |  Q = quit & plot")
    print("Aim for: stand neutral → throw punch → recover → stop")
    print()

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = pose.process(rgb)
        joints = _extract_frame(results)

        # Draw skeleton overlay
        if results.pose_landmarks:
            mp.solutions.drawing_utils.draw_landmarks(
                frame,
                results.pose_landmarks,
                mp.solutions.pose.POSE_CONNECTIONS,
            )

        if recording:
            elapsed = time.time() - rec_start
            remaining = CLIP_DURATION - elapsed
            cv2.putText(
                frame,
                f"REC {remaining:.1f}s",
                (20, 40),
                cv2.FONT_HERSHEY_SIMPLEX,
                1.2,
                (0, 0, 220),
                3,
            )
            if joints is not None:
                rec_frames.append(joints)
            if elapsed >= CLIP_DURATION:
                recording = False
                label = _ask_label()
                if rec_frames:
                    clips.append((label, np.array(rec_frames)))
                    print(f"  Saved {len(rec_frames)} frames as '{label}' "
                          f"(clip {len(clips)})")
                rec_frames = []
        else:
            cv2.putText(
                frame,
                f"SPACE=record  Q=plot ({len(clips)} clips)",
                (20, 40),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (220, 220, 220),
                2,
            )

        cv2.imshow("Spectre Diagnose", frame)
        key = cv2.waitKey(1) & 0xFF

        if key == ord(" ") and not recording:
            recording = True
            rec_start = time.time()
            rec_frames = []
            print(f"\nRecording clip {len(clips)+1}...")

        elif key == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()
    pose.close()

    if not clips:
        print("No clips recorded.")
        return

    _plot(clips)


def _plot(clips: list[tuple[str, np.ndarray]]):
    """
    4-row × 3-col grid: one row per joint, one col per axis (x/y/z).
    Each clip overlaid as a coloured line, normalised to [0, 1] time.
    Z-axis is highlighted with a thicker border — that's the critical signal.
    """
    joint_labels = [JOINT_NAMES[i] for i in JOINT_INDICES]
    axes_labels = ["X (left/right)", "Y (up/down)", "Z (depth/toward-cam)"]
    n_joints = len(JOINT_INDICES)

    fig, axs = plt.subplots(
        n_joints, 3, figsize=(14, 10), sharex=False
    )
    fig.suptitle(
        "MediaPipe World Landmark Trajectories\n"
        "Z = depth toward camera  —  key axis for straight punches",
        fontsize=13,
    )

    # Track which labels appeared for the legend
    seen: dict[str, object] = {}

    for label, frames in clips:
        color = COLORS.get(label, COLORS["other"])
        T = len(frames)
        t = np.linspace(0, 1, T)

        for ji, jname in enumerate(joint_labels):
            for ai, aname in enumerate(axes_labels):
                ax = axs[ji, ai]
                signal = frames[:, ji, ai]
                # Centre on first frame so clips are comparable regardless of position
                signal = signal - signal[0]
                line, = ax.plot(t, signal, color=color, alpha=0.75, linewidth=1.8)
                if label not in seen:
                    seen[label] = line

    for ji, jname in enumerate(joint_labels):
        for ai, aname in enumerate(axes_labels):
            ax = axs[ji, ai]
            ax.set_title(f"{jname} — {aname}", fontsize=8)
            ax.axhline(0, color="#cccccc", linewidth=0.8)
            ax.set_xlabel("time (normalised)", fontsize=7)
            ax.set_ylabel("Δ metres", fontsize=7)
            ax.tick_params(labelsize=7)
            # Highlight Z column
            if ai == 2:
                ax.set_facecolor("#fffde7")

    fig.legend(
        seen.values(),
        seen.keys(),
        loc="lower center",
        ncol=len(seen),
        fontsize=9,
        framealpha=0.9,
    )
    plt.tight_layout(rect=[0, 0.04, 1, 1])

    out = "ml/signal_diagnostic.png"
    plt.savefig(out, dpi=150)
    print(f"\nPlot saved to {out}")
    plt.show()


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.parse_args()
    record_and_plot(parser.parse_args())


if __name__ == "__main__":
    main()
