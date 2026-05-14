"""
quantize.py — Convert a FP32 ONNX model to INT8 using dynamic quantization.

Usage:
    python quantize.py --input models/punch_classifier.onnx \
                       --output models/punch_classifier_int8.onnx
"""

import argparse
import os
import sys


def main():
    parser = argparse.ArgumentParser(
        description="Quantize FP32 ONNX model to INT8 using onnxruntime dynamic quantization"
    )
    parser.add_argument(
        "--input",
        type=str,
        default="ml/models/punch_classifier.onnx",
        help="Path to FP32 ONNX file (default: ml/models/punch_classifier.onnx)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default="ml/models/punch_classifier_int8.onnx",
        help="Path for INT8 ONNX output (default: ml/models/punch_classifier_int8.onnx)",
    )
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        print(f"ERROR: input ONNX not found: {args.input}")
        sys.exit(1)

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)

    from onnxruntime.quantization import QuantType, quantize_dynamic

    size_before_kb = os.path.getsize(args.input) / 1024
    print(f"Input:  {args.input} ({size_before_kb:.1f} KB)")

    quantize_dynamic(
        model_input=args.input,
        model_output=args.output,
        weight_type=QuantType.QInt8,
    )

    size_after_kb = os.path.getsize(args.output) / 1024
    print(f"Output: {args.output} ({size_after_kb:.1f} KB)")
    print(f"Size reduction: {size_before_kb:.1f} KB -> {size_after_kb:.1f} KB "
          f"({100 * (1 - size_after_kb / size_before_kb):.1f}% smaller)")
    print("Quantization complete.")


if __name__ == "__main__":
    main()
