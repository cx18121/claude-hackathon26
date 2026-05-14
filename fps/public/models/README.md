# fps/public/models/

This directory contains the ONNX model served by Vite at /models/.

## punch_classifier_int8.onnx

~155KB INT8 quantized temporal MLP for punch classification.

CURRENT STATE: PLACEHOLDER (uniform-output model, all weights zero).
Replace with the real trained model after running the ml/ training pipeline:

  cd ml && pip install -r requirements.txt
  # Collect training data (see ml/README.md)
  python scripts/train.py --data-dir data/extracted --output-dir models
  python scripts/export_onnx.py --checkpoint models/best.pt --output models/punch_classifier.onnx
  python scripts/quantize.py --input models/punch_classifier.onnx --output models/punch_classifier_int8.onnx
  cp models/punch_classifier_int8.onnx ../fps/public/models/punch_classifier_int8.onnx

The placeholder ensures usePunchClassifier loads without a 404 error during development.
It will always output type: null (confidence < 0.7 threshold) until replaced with real weights.
