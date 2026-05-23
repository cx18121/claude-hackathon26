"""
export_onnx.py — Export a trained PunchTCN checkpoint to FP32 ONNX.

Usage:
    python export_onnx.py --checkpoint models/best.pt --output models/punch_classifier.onnx
"""

import argparse
import os
import sys

import torch
import torch.nn as nn


class _TemperatureScaledExport(nn.Module):
    """Wraps PunchTCNExport, dividing logits by a fixed temperature scalar.

    Baking T into the ONNX graph means usePunchClassifier.ts receives
    calibrated logits — softmax(logits) probabilities reflect empirical
    accuracy without any client-side changes.  The features output (used
    for nearest-centroid prototypes) is unaffected.
    """
    def __init__(self, inner: nn.Module, temperature: float):
        super().__init__()
        self.inner = inner
        self.register_buffer("T", torch.tensor(temperature, dtype=torch.float32))

    def forward(self, x: torch.Tensor):
        logits, features = self.inner(x)
        return logits / self.T, features


def main():
    parser = argparse.ArgumentParser(
        description="Export a trained PunchMLP checkpoint to FP32 ONNX (opset 17)"
    )
    parser.add_argument(
        "--checkpoint",
        type=str,
        required=True,
        help="Path to best.pt checkpoint produced by train.py",
    )
    parser.add_argument(
        "--output",
        type=str,
        default="ml/models/punch_classifier.onnx",
        help="Output ONNX file path (default: ml/models/punch_classifier.onnx)",
    )
    parser.add_argument(
        "--int8",
        action="store_true",
        help="Also export a dynamically-quantized int8 ONNX (requires onnxruntime)",
    )
    args = parser.parse_args()

    # Import model definition from train.py in the same directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, script_dir)
    from train import PunchTCN, PunchTCNExport  # noqa: E402

    if not os.path.isfile(args.checkpoint):
        print(f"ERROR: checkpoint not found: {args.checkpoint}")
        sys.exit(1)

    print(f"Loading checkpoint: {args.checkpoint}")
    ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=True)

    classes = ckpt.get("classes", None)
    epoch = ckpt.get("epoch", "?")
    val_acc = ckpt.get("val_acc", "?")
    temperature = float(ckpt.get("temperature", 1.0))
    print(f"  epoch={epoch}, val_acc={val_acc}, classes={classes}")
    print(f"  temperature={temperature:.4f}" + (" (baking into logits output)" if temperature != 1.0 else " (not calibrated — run train.py to fit T)"))

    backbone = PunchTCN()
    backbone.load_state_dict(ckpt["model_state_dict"])
    backbone.eval()
    export_model = PunchTCNExport(backbone)
    export_model.eval()
    model: nn.Module = (
        _TemperatureScaledExport(export_model, temperature)
        if temperature != 1.0
        else export_model
    )
    model.eval()

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)

    dummy_input = torch.zeros(1, 20, 8, 3)
    torch.onnx.export(
        model,
        dummy_input,
        args.output,
        opset_version=17,
        input_names=["input"],
        output_names=["logits", "features"],
        dynamic_axes={
            "input":    {0: "batch_size"},
            "logits":   {0: "batch_size"},
            "features": {0: "batch_size"},
        },
        do_constant_folding=True,
    )

    size_kb = os.path.getsize(args.output) / 1024
    print(f"Exported ONNX: {args.output} ({size_kb:.1f} KB)")

    import onnx
    m = onnx.load(args.output)
    onnx.checker.check_model(m)
    print("ONNX model check: PASSED")
    print(f"  input:    {m.graph.input[0].name}")
    print(f"  output 0: {m.graph.output[0].name}")
    print(f"  output 1: {m.graph.output[1].name}")
    print(f"  opset:    {m.opset_import[0].version}")

    if args.int8:
        try:
            from onnxruntime.quantization import quantize_dynamic, QuantType
            int8_path = args.output.replace(".onnx", "_int8.onnx")
            quantize_dynamic(args.output, int8_path, weight_type=QuantType.QInt8)
            size_kb = os.path.getsize(int8_path) / 1024
            print(f"Int8 ONNX: {int8_path} ({size_kb:.1f} KB)")
        except ImportError:
            print("WARNING: onnxruntime not installed — skipping --int8 export")


if __name__ == "__main__":
    main()
