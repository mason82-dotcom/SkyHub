"""Dependency-free contract tests: no YOLO download, no camera, no S3 access."""
import importlib.util
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
from io import StringIO

FILE = Path(__file__).resolve().parents[1] / "backend/workers/vision_yolo11_offline.py"
SPEC = importlib.util.spec_from_file_location("vision_yolo11_offline", FILE)
vision = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(vision)


class Prediction:
    def __init__(self, shape=(32, 48), rows=None, names=None):
        self.orig_shape = shape
        rows = rows if rows is not None else [([1, 2, 20, 22], 0.9, 0)]
        self.boxes = type("Boxes", (), {
            "xyxy": [x for x, _, _ in rows],
            "conf": [x for _, x, _ in rows],
            "cls": [x for _, _, x in rows],
        })()
        self.names = names if names is not None else {0: "pv_crack"}


class FakeDetector:
    def __init__(self, result):
        self.result = result
        self.options = None

    def predict(self, **kwargs):
        self.options = kwargs
        return [self.result]


class OfflineVisionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.image = root / "image.jpg"
        self.image.write_bytes(b"fake image checked by injected image probe")
        self.model = root / "model.onnx"
        self.model.write_bytes(b"fake ONNX checked by injected model factory")

    def run_report(self, prediction=None, **opts):
        detector = FakeDetector(prediction or Prediction())
        output = vision.analyze(
            str(self.image), str(self.model),
            image_probe=lambda _path: (48, 32),
            model_factory=lambda _path, task: detector,
            **opts,
        )
        return output, detector

    def test_bounded_redacted_contract(self):
        report, detector = self.run_report()
        self.assertEqual(report["status"], "ok")
        self.assertEqual(report["schema"], "skyhub-vision-yolo11-preview-v1")
        self.assertEqual(report["detectionCount"], 1)
        self.assertEqual(report["detections"][0]["className"], "pv_crack")
        self.assertEqual(report["detections"][0]["bboxXYXY"], [1.0, 2.0, 20.0, 22.0])
        self.assertFalse(report["defectVerified"])
        self.assertFalse(report["geolocationVerified"])
        self.assertFalse(report["multispectralReady"])
        self.assertFalse(report["flightControlReady"])
        self.assertEqual(detector.options["device"], "cpu")
        self.assertEqual(detector.options["max_det"], vision.MAX_DETECTIONS)
        payload = json.dumps(report)
        self.assertNotIn(str(self.tmp.name), payload)
        self.assertNotIn("image.jpg", payload)
        self.assertNotIn("model.onnx", payload)

    def test_custom_label_cannot_inject_private_strings(self):
        report, _ = self.run_report(Prediction(names={0: "GPS 49.23 SECRET"}))
        self.assertEqual(report["detections"][0]["className"], "class_0")

    def test_confidence_threshold_filters(self):
        result = Prediction(rows=[
            ([1, 2, 20, 22], 0.60, 0),
            ([1, 2, 20, 22], 0.25, 0),
        ])
        report, _ = self.run_report(result, confidence=0.5)
        self.assertEqual(report["detectionCount"], 1)

    def test_reject_symlink_image_and_model(self):
        target = self.image
        shortcut = target.with_name("linked.jpg")
        shortcut.symlink_to(target)
        self.image = shortcut
        with self.assertRaises(vision.InvalidInput):
            self.run_report()
        self.image = target
        other = self.model.with_name("linked.onnx")
        other.symlink_to(self.model)
        self.model = other
        with self.assertRaises(vision.InvalidInput):
            self.run_report()

    def test_reject_multispectral_tiff_and_untrusted_pt(self):
        self.image = self.image.with_suffix(".tif")
        self.image.write_bytes(b"fake spectral")
        with self.assertRaises(vision.InvalidInput):
            self.run_report()
        self.image = self.image.with_suffix(".jpg")
        self.image.write_bytes(b"RGB")
        self.model = self.model.with_suffix(".pt")
        self.model.write_bytes(b"untrusted pickle")
        with self.assertRaises(vision.InvalidInput):
            self.run_report()
        report, _ = self.run_report(allow_pt=True)
        self.assertEqual(report["modelFormat"], "pt")

    def test_reject_relative_missing_and_oversized_file(self):
        for filename in ["image.jpg", str(Path(self.tmp.name) / "missing.jpg")]:
            with self.assertRaises(vision.InvalidInput):
                vision.local_file(filename, {".jpg"}, vision.MAX_IMAGE_BYTES)
        with self.assertRaises(vision.InvalidInput):
            vision.local_file(str(self.image), {".jpg"}, 3)

    def test_malformed_model_output_fails_closed(self):
        for pred in [
            Prediction(shape=(40, 50)),
            Prediction(rows=[([1, 2, float("nan"), 22], 0.9, 0)]),
            Prediction(rows=[([5, 10, 5, 12], 0.9, 0)]),
            Prediction(rows=[([1, 2, 20, 22], 1.1, 0)]),
            Prediction(rows=[([1, 2, 20, 22], 0.8, 0.3)]),
            Prediction(rows=[([1, 2, 20, 22], 0.8, -1)]),
            Prediction(rows=[([1, 2, 20, 22], 0.8, 0)] * 101),
        ]:
            with self.subTest(pred=repr(pred)):
                with self.assertRaises(vision.InvalidInput):
                    self.run_report(pred)

    def test_finite_confidence_enforced(self):
        for invalid in [float("nan"), float("inf"), 0.001, 0.99]:
            with self.assertRaises(vision.InvalidInput):
                self.run_report(confidence=invalid)

    def test_image_dimensions_bounded_before_predict(self):
        hits = []
        with self.assertRaises(vision.InvalidInput):
            vision.analyze(str(self.image), str(self.model),
                image_probe=lambda _: (100_000, 100_000),
                model_factory=lambda *a, **k: hits.append(True))
        self.assertEqual(hits, [])
        for dims in [(400_000, 32), (32, 400_000)]:
            with self.subTest(dims=dims), self.assertRaises(vision.InvalidInput):
                vision.analyze(str(self.image), str(self.model),
                    image_probe=lambda _, xy=dims: xy,
                    model_factory=lambda *a, **k: hits.append(True))
        self.assertEqual(hits, [])

    def test_cli_errors_do_not_leak_inputs(self):
        secret_path = str(self.image) + "-PRIVATE"
        with patch.object(vision, "analyze", side_effect=RuntimeError(secret_path)):
            out = StringIO()
            with redirect_stdout(out):
                code = vision.main(["--image", str(self.image),
                                    "--model", str(self.model)])
        self.assertEqual(code, 2)
        result = json.loads(out.getvalue())
        self.assertEqual(result, {"schema": vision.SCHEMA,
                                  "status": "unavailable",
                                  "detections": [], "detectionCount": 0})
        self.assertNotIn("PRIVATE", out.getvalue())


if __name__ == "__main__":
    unittest.main()
