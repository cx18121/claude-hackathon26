# ml/ — Punch Classifier Training Pipeline

Offline Python pipeline for training the temporal punch classifier used in the FPS boxing game.
The output is a quantized ONNX model (~155 KB) committed to `fps/public/models/punch_classifier_int8.onnx`
and served by Vite at `/models/punch_classifier_int8.onnx`.

---

## Prerequisites

- Python 3.10+
- pip
- No GPU required — CPU training is fine for this MLP architecture

---

## Setup

```bash
cd ml
pip install -r requirements.txt
```

---

## Data Collection

### Option A — Recommended: Re-extract from BoxingVI

BoxingVI raw videos are publicly available on Google Drive (no access request needed):
<https://drive.google.com/drive/folders/1Vyl8twJQ1qkqEPwhvfsrJsJ8nLQ92uoy>

> **Critical:** BoxingVI annotations use AlphaPose COCO-17 format (different joint indices
> from MediaPipe). Do NOT use the AlphaPose annotation files. Re-run MediaPipe on the raw
> videos to get 3D world landmarks in the same format used at inference time.

1. Download the raw video files from the Drive link above.
2. Organize them under `ml/data/raw_videos/<class>/` where `<class>` is one of:
   `jab`, `cross`, `hook_l`, `hook_r`, `guard`
3. Run extraction:

```bash
python scripts/extract_keypoints.py \
  --input-dir ml/data/raw_videos \
  --output-dir ml/data/extracted
```

Output: `ml/data/extracted/<class>/<clip>_w0000.npy`, each shape `(20, 8, 3)` —
20 frames × 8 joints × (x, y, z) world landmark coordinates.

### Option B — Webcam Recordings

If BoxingVI videos are unavailable, record your own clips:

```bash
# Record 50 jab clips (2 seconds each)
python scripts/record_webcam.py --output-dir ml/data/raw_videos --label jab

# Repeat for each class
python scripts/record_webcam.py --output-dir ml/data/raw_videos --label cross
python scripts/record_webcam.py --output-dir ml/data/raw_videos --label hook_l
python scripts/record_webcam.py --output-dir ml/data/raw_videos --label hook_r
python scripts/record_webcam.py --output-dir ml/data/raw_videos --label guard
```

Aim for 50–100 clips per class, 1–2 seconds each. Then run `extract_keypoints.py`
on the recorded `.mp4` files (same command as Option A).

---

## Joint Indices

The 8 MediaPipe world landmark indices extracted for training and inference:

| Subset Index | MediaPipe Index | Joint |
|-------------|----------------|-------|
| 0 | 11 | LEFT_SHOULDER |
| 1 | 12 | RIGHT_SHOULDER |
| 2 | 13 | LEFT_ELBOW |
| 3 | 14 | RIGHT_ELBOW |
| 4 | 15 | LEFT_WRIST |
| 5 | 16 | RIGHT_WRIST |
| 6 | 23 | LEFT_HIP |
| 7 | 24 | RIGHT_HIP |

```python
JOINT_INDICES = [11, 12, 13, 14, 15, 16, 23, 24]
```

**These indices MUST match `JOINT_INDICES` in `fps/src/hooks/usePunchClassifier.ts`.**
Any mismatch between training and inference produces random outputs.

---

## Normalization

Both the Python training pipeline and the TypeScript hook apply identical normalization
to ensure train/inference parity:

1. Compute shoulder midpoint: `(left_shoulder + right_shoulder) / 2`
2. Compute shoulder width: `‖right_shoulder − left_shoulder‖`
3. Translate all joints: subtract midpoint from each joint's (x, y, z)
4. Scale all joints: divide by shoulder width (clamped to ≥ 1e-6)

This makes the features person-independent (scale and position invariant).

The same formula is implemented in `fps/src/lib/normalizeWindow.ts`.

> **Warning:** Training on normalized data but running inference on raw coordinates
> (or vice versa) causes all 5 classes to predict at ~20% probability. If confidence
> is uniformly low, check normalization consistency first.

---

## Training

```bash
python scripts/train.py \
  --data-dir ml/data/extracted \
  --output-dir ml/models
```

Saves best checkpoint to `ml/models/best.pt`. Training uses:
- Architecture: 5-layer temporal MLP, input dim 480 (20 × 8 × 3), 5 classes
- Loss: weighted cross-entropy (compensates for class imbalance)
- Optimizer: AdamW + cosine annealing LR scheduler
- Augmentation: horizontal flip (jab↔cross, hook_l↔hook_r symmetry)

Target accuracy: ≥80% on held-out validation set.

---

## ONNX Export

```bash
python scripts/export_onnx.py \
  --checkpoint ml/models/best.pt \
  --output ml/models/punch_classifier.onnx
```

Exports using opset 17 (compatible with onnxruntime-web 1.26.0). Input shape:
`(batch, 20, 8, 3)`. Output: `logits` of shape `(batch, 5)`.

> **Fallback:** If onnxruntime-web reports opset compatibility errors, re-export with
> `--opset 12` — opset 12 is universally supported.

---

## INT8 Quantization

```bash
python scripts/quantize.py \
  --input ml/models/punch_classifier.onnx \
  --output ml/models/punch_classifier_int8.onnx
```

Uses `onnxruntime.quantization.quantize_dynamic` with `weight_type=QInt8`.
Expected result: ~620 KB (FP32) → ~155 KB (INT8). Both are under the 500 KB target.

Dynamic quantization quantizes weights only (not activations), which is preferred for
this small MLP — no calibration dataset required.

---

## Deploy to fps/

```bash
cp ml/models/punch_classifier_int8.onnx fps/public/models/punch_classifier_int8.onnx
```

The Vite dev server serves files in `fps/public/` at the root URL. The hook loads the
model at `/models/punch_classifier_int8.onnx`.

> **Note on shared/protocol.ts:** `MsgPunchDetected` is defined locally in
> `fps/src/hooks/usePunchClassifier.ts`, NOT in `shared/protocol.ts`.
> `shared/protocol.ts` is auto-generated from Rust and will overwrite any manual
> additions on the next `cargo test` run. The fps/-local definition is intentional.

---

## File Layout

```
ml/
├── README.md              # This file
├── requirements.txt       # Python deps
├── data/
│   ├── .gitkeep           # Placeholder — video data is gitignored
│   └── raw_videos/        # BoxingVI .mp4 files (NOT committed)
│       └── <class>/
│           └── *.mp4
├── models/
│   ├── .gitkeep           # Placeholder — .pt and .onnx are gitignored
│   ├── best.pt            # PyTorch checkpoint (NOT committed)
│   ├── punch_classifier.onnx      # FP32 export (NOT committed)
│   └── punch_classifier_int8.onnx # INT8 quantized (NOT committed from here)
└── scripts/
    ├── __init__.py
    ├── extract_keypoints.py  # MediaPipe extraction from video files
    ├── record_webcam.py      # Guided webcam recording tool
    ├── train.py              # Training loop (Phase 13.1 Plan 02)
    ├── export_onnx.py        # torch.onnx.export (Phase 13.1 Plan 02)
    └── quantize.py           # quantize_dynamic (Phase 13.1 Plan 02)
```

The quantized model committed to the repo lives at `fps/public/models/punch_classifier_int8.onnx`
(the `ml/models/` path is a local training output only).

---

## Classes

| Label | Description |
|-------|-------------|
| `jab` | Lead hand straight punch |
| `cross` | Rear hand straight punch |
| `hook_l` | Left hook |
| `hook_r` | Right hook |
| `guard` | Defensive guard position |

Uppercuts (Lead/Rear Uppercut from BoxingVI) are out of scope for Phase 13.1.
