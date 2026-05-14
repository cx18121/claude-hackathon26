"""
make_placeholder_onnx.py — Generate a minimal valid ONNX placeholder model.

This produces fps/public/models/punch_classifier_int8.onnx so that
usePunchClassifier.ts can load a real ONNX file (not get a 404) during
development before real training weights are available.

The placeholder uses all-zero weights so every input produces uniform
logits — confidence will always be below 0.7 and type will be null.

Run once during plan execution:
    python ml/scripts/make_placeholder_onnx.py
"""

import os
import sys

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper


def make_placeholder(output_path: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    # Graph inputs / outputs
    X = helper.make_tensor_value_info("input", TensorProto.FLOAT, [1, 20, 8, 3])
    Y = helper.make_tensor_value_info("logits", TensorProto.FLOAT, [1, 5])

    # Shape initializer for Reshape: (1, 480)
    shape_init = numpy_helper.from_array(
        np.array([1, 480], dtype=np.int64), name="shape"
    )

    # 480->5 linear layer weights and bias (all zeros → uniform output)
    W_np = np.zeros((5, 480), dtype=np.float32)
    b_np = np.zeros((5,), dtype=np.float32)
    W_init = numpy_helper.from_array(W_np, name="W")
    b_init = numpy_helper.from_array(b_np, name="b")

    # Nodes
    reshape_node = helper.make_node(
        "Reshape", inputs=["input", "shape"], outputs=["flat"]
    )
    gemm_node = helper.make_node(
        "Gemm", inputs=["flat", "W", "b"], outputs=["logits"], transB=1
    )

    graph = helper.make_graph(
        nodes=[reshape_node, gemm_node],
        name="placeholder",
        inputs=[X],
        outputs=[Y],
        initializer=[shape_init, W_init, b_init],
    )

    model = helper.make_model(
        graph, opset_imports=[helper.make_opsetid("", 17)]
    )
    model.ir_version = 8

    onnx.checker.check_model(model)
    onnx.save(model, output_path)
    size_kb = os.path.getsize(output_path) / 1024
    print(f"Placeholder ONNX written: {output_path} ({size_kb:.1f} KB)")
    print(f"  input name:  {model.graph.input[0].name}")
    print(f"  output name: {model.graph.output[0].name}")
    print(f"  ir_version:  {model.ir_version}")
    print(f"  opset:       {model.opset_import[0].version}")


if __name__ == "__main__":
    # Default: write relative to repo root
    repo_root = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..")
    )
    output_path = os.path.join(repo_root, "fps", "public", "models", "punch_classifier_int8.onnx")
    if len(sys.argv) > 1:
        output_path = sys.argv[1]
    make_placeholder(output_path)
