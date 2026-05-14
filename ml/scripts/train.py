"""
train.py — PunchMLP training pipeline.

Loads .npy keypoint sequences from a data directory, applies shoulder-midpoint
normalization and horizontal-flip augmentation, trains a small MLP classifier,
and saves the best checkpoint by validation accuracy.

Usage:
    python train.py --data-dir data/extracted --output-dir models
    python train.py --dry-run
"""

import argparse
import os
import sys

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

# ---------------------------------------------------------------------------
# Constants — must match extract_keypoints.py and usePunchClassifier.ts
# ---------------------------------------------------------------------------
JOINT_INDICES = [11, 12, 13, 14, 15, 16, 23, 24]
JOINT_ORDER = [
    "LEFT_SHOULDER", "RIGHT_SHOULDER",
    "LEFT_ELBOW", "RIGHT_ELBOW",
    "LEFT_WRIST", "RIGHT_WRIST",
    "LEFT_HIP", "RIGHT_HIP",
]
CLASSES = ["jab", "cross", "hook_l", "hook_r", "guard"]
CLASS_TO_IDX = {c: i for i, c in enumerate(CLASSES)}

SWAP_PAIRS = [(0, 1), (2, 3), (4, 5), (6, 7)]
LABEL_SWAP = {
    "jab": "cross",
    "cross": "jab",
    "hook_l": "hook_r",
    "hook_r": "hook_l",
    "guard": "guard",
}


# ---------------------------------------------------------------------------
# Normalization — CRITICAL: must be bit-for-bit identical to
# normalizeWindow() in fps/src/lib/normalizeWindow.ts
# ---------------------------------------------------------------------------
def normalize_window(kps: np.ndarray) -> np.ndarray:
    """
    kps: shape (T, J, 3) — T frames, 8 joints in JOINT_ORDER, xyz in meters.
    Returns: same shape, translated to shoulder midpoint at origin,
             scaled by shoulder width.
    Joints at index 0=LEFT_SHOULDER, 1=RIGHT_SHOULDER in the extracted subset.
    """
    left_sh = kps[:, 0, :]   # (T, 3)
    right_sh = kps[:, 1, :]  # (T, 3)
    midpoint = (left_sh + right_sh) / 2.0           # (T, 3)
    sw = np.linalg.norm(right_sh - left_sh, axis=1, keepdims=True)  # (T, 1)
    sw = np.clip(sw, 1e-6, None)
    normalized = (kps - midpoint[:, np.newaxis, :]) / sw[:, np.newaxis, :]
    return normalized


# ---------------------------------------------------------------------------
# Augmentation — horizontal flip with label swap
# ---------------------------------------------------------------------------
def flip_sequence(kps: np.ndarray, label: str):
    flipped = kps.copy()
    for i, j in SWAP_PAIRS:
        flipped[:, i, :] = kps[:, j, :].copy()
        flipped[:, j, :] = kps[:, i, :].copy()
    flipped[:, :, 0] *= -1
    return flipped, LABEL_SWAP[label]


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------
class PunchMLP(nn.Module):
    def __init__(self, input_dim: int = 480, num_classes: int = 5):
        """input_dim = 20 frames * 8 joints * 3 coords = 480"""
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, 256), nn.ReLU(), nn.Dropout(0.3),
            nn.Linear(256, 128), nn.ReLU(), nn.Dropout(0.3),
            nn.Linear(128, 64), nn.ReLU(),
            nn.Linear(64, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x.view(x.size(0), -1))


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------
def load_dataset(data_dir: str):
    """
    Walk data_dir for class subdirs whose names match CLASSES.
    Load all .npy files (each shape (T, J, 3)), normalize, augment.
    Returns: tensors (N, 20, 8, 3), labels (N,)
    """
    sequences = []
    labels = []

    for class_name in CLASSES:
        class_dir = os.path.join(data_dir, class_name)
        if not os.path.isdir(class_dir):
            continue
        label_idx = CLASS_TO_IDX[class_name]
        for fname in sorted(os.listdir(class_dir)):
            if not fname.endswith(".npy"):
                continue
            path = os.path.join(class_dir, fname)
            kps = np.load(path).astype(np.float32)  # (T, J, 3)
            if kps.shape != (20, 8, 3):
                print(f"  WARNING: skipping {path} — shape {kps.shape} != (20, 8, 3)")
                continue
            norm = normalize_window(kps)
            sequences.append(norm)
            labels.append(label_idx)
            # Flip augmentation
            flipped, flipped_label = flip_sequence(norm, class_name)
            sequences.append(flipped)
            labels.append(CLASS_TO_IDX[flipped_label])

    if not sequences:
        return None, None

    X = np.stack(sequences, axis=0).astype(np.float32)   # (N, 20, 8, 3)
    y = np.array(labels, dtype=np.int64)
    return X, y


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------
def train(args):
    from sklearn.model_selection import train_test_split

    print(f"Loading data from: {args.data_dir}")
    X, y = load_dataset(args.data_dir)
    if X is None:
        print("ERROR: no .npy files found. Run extract_keypoints.py first.")
        sys.exit(1)

    print(f"Dataset: {X.shape[0]} samples, {len(CLASSES)} classes")

    # Class counts and weights
    class_counts = np.bincount(y, minlength=len(CLASSES)).astype(np.float32)
    class_counts = np.clip(class_counts, 1, None)
    weights = 1.0 / class_counts
    weights = weights / weights.sum() * len(CLASSES)  # normalize so sum ≈ num_classes
    weight_tensor = torch.tensor(weights, dtype=torch.float32)

    # Stratified 80/20 split
    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    train_ds = TensorDataset(torch.tensor(X_train), torch.tensor(y_train))
    val_ds = TensorDataset(torch.tensor(X_val), torch.tensor(y_val))
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, drop_last=False)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False)

    model = PunchMLP()
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    criterion = nn.CrossEntropyLoss(weight=weight_tensor)

    os.makedirs(args.output_dir, exist_ok=True)
    best_acc = 0.0
    best_path = os.path.join(args.output_dir, "best.pt")

    print(f"\nTraining for {args.epochs} epochs (batch={args.batch_size}, lr={args.lr})")
    print(f"Train: {len(train_ds)} samples | Val: {len(val_ds)} samples")
    print("-" * 60)

    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss = 0.0
        for xb, yb in train_loader:
            optimizer.zero_grad()
            logits = model(xb)
            loss = criterion(logits, yb)
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * xb.size(0)
        scheduler.step()
        train_loss = total_loss / len(train_ds)

        # Validation
        model.eval()
        val_loss = 0.0
        correct = 0
        with torch.no_grad():
            for xb, yb in val_loader:
                logits = model(xb)
                val_loss += criterion(logits, yb).item() * xb.size(0)
                preds = logits.argmax(dim=1)
                correct += (preds == yb).sum().item()
        val_loss /= len(val_ds)
        val_acc = correct / len(val_ds)

        if val_acc > best_acc:
            best_acc = val_acc
            torch.save(
                {
                    "model_state_dict": model.state_dict(),
                    "epoch": epoch,
                    "val_acc": best_acc,
                    "classes": CLASSES,
                },
                best_path,
            )

        if epoch % 10 == 0 or epoch == 1:
            print(
                f"Epoch {epoch:4d}/{args.epochs}  "
                f"train_loss={train_loss:.4f}  "
                f"val_loss={val_loss:.4f}  "
                f"val_acc={val_acc:.4f}"
                + (" *" if val_acc == best_acc else "")
            )

    print(f"\nTraining complete. Best val_acc={best_acc:.4f}")
    print(f"Checkpoint saved to: {best_path}")


# ---------------------------------------------------------------------------
# --dry-run
# ---------------------------------------------------------------------------
def dry_run():
    print("=== PunchMLP dry-run ===")
    model = PunchMLP()
    total_params = sum(p.numel() for p in model.parameters())
    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"\nArchitecture:\n{model}")
    print(f"\nTotal parameters:     {total_params:,}")
    print(f"Trainable parameters: {trainable_params:,}")
    print(f"(Expected: ~155K)")

    # Synthetic batch (zeros)
    dummy = torch.zeros(4, 20, 8, 3)
    model.eval()
    with torch.no_grad():
        logits = model(dummy)
    print(f"\nDummy input shape:  {tuple(dummy.shape)}")
    print(f"Logits output shape: {tuple(logits.shape)}")
    assert logits.shape == (4, 5), f"Expected (4, 5), got {logits.shape}"
    print("\n--dry-run passed.")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Train PunchMLP classifier on extracted keypoint sequences"
    )
    parser.add_argument("--data-dir", type=str, default="data/extracted",
                        help="Root dir with per-class subdirs of .npy files")
    parser.add_argument("--output-dir", type=str, default="ml/models",
                        help="Where to save best.pt checkpoint (default: ml/models)")
    parser.add_argument("--epochs", type=int, default=100,
                        help="Number of training epochs (default: 100)")
    parser.add_argument("--batch-size", type=int, default=64,
                        help="Batch size (default: 64)")
    parser.add_argument("--lr", type=float, default=1e-3,
                        help="Learning rate (default: 1e-3)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Build model, print summary, run one forward pass, exit 0")
    args = parser.parse_args()

    if args.dry_run:
        dry_run()
        sys.exit(0)

    train(args)


if __name__ == "__main__":
    main()
