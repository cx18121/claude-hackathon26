"""
Smoke test for export_onnx.py — end-to-end via subprocess.

Builds a randomly-initialised PunchTCN, saves a checkpoint shaped like
what train.py emits, and runs the actual CLI. Goal: catch import-order
bugs, missing ckpt keys, or ONNX export regressions before they ship.
"""

import os
import subprocess
import sys
import tempfile
import unittest

import onnx
import torch

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SCRIPTS_DIR = os.path.join(REPO_ROOT, "ml", "scripts")
sys.path.insert(0, SCRIPTS_DIR)

from train import PunchTCN  # noqa: E402


def _write_fake_checkpoint(path: str, temperature: float) -> None:
    torch.save(
        {
            "model_state_dict": PunchTCN().state_dict(),
            "classes": ["jab", "cross", "hook_l", "hook_r", "guard"],
            "epoch": 1,
            "val_acc": 0.42,
            "temperature": temperature,
        },
        path,
    )


def _run_export(ckpt_path: str, out_path: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            sys.executable,
            os.path.join(SCRIPTS_DIR, "export_onnx.py"),
            "--checkpoint", ckpt_path,
            "--output", out_path,
        ],
        capture_output=True,
        text=True,
        check=False,
    )


class ExportOnnxSmoke(unittest.TestCase):
    def _assert_export_round_trip(self, temperature: float) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ckpt = os.path.join(tmp, "fake.pt")
            out = os.path.join(tmp, "fake.onnx")
            _write_fake_checkpoint(ckpt, temperature)

            result = _run_export(ckpt, out)
            self.assertEqual(
                result.returncode, 0,
                msg=f"export_onnx.py exited {result.returncode}\n"
                    f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
            )
            self.assertTrue(os.path.isfile(out), "no ONNX file produced")

            model = onnx.load(out)
            onnx.checker.check_model(model)
            output_names = [o.name for o in model.graph.output]
            self.assertEqual(output_names, ["logits", "features"])

    def test_export_with_calibrated_temperature(self):
        # Hits the _TemperatureScaledExport branch — the one that broke.
        self._assert_export_round_trip(temperature=1.5)

    def test_export_with_default_temperature(self):
        self._assert_export_round_trip(temperature=1.0)


if __name__ == "__main__":
    unittest.main()
